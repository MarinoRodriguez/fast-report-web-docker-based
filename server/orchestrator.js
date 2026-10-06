/**
 * FastReport Cloud Stream - Orchestrator & Backend Server
 * --------------------------------------------------------
 * Manages the lifecycle of ephemeral Wine+Docker containers,
 * allocates dynamic ports for Websockify and Bridge Server,
 * enforces dummy authentication, and handles report file persistence.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { exec, execSync, spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DOCKER_IMAGE = process.env.DOCKER_IMAGE || 'fastreport-stream:latest';
const DUMMY_TOKEN = process.env.DUMMY_TOKEN || 'demo-user-123';

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const STORAGE_DIR = path.join(__dirname, 'storage');
const SAVED_REPORTS_DIR = path.join(STORAGE_DIR, 'saved_reports');
const ARCHIVE_REPORTS_DIR = path.join(STORAGE_DIR, 'archived_reports');
const RECOVERY_REPORTS_DIR = path.join(STORAGE_DIR, 'recovery');
const HISTORY_REPORTS_DIR = path.join(STORAGE_DIR, 'history');
const SESSIONS_DIR = path.join(STORAGE_DIR, 'sessions');
const REGISTRY_FILE = path.join(STORAGE_DIR, 'reports_registry.json');
const RECOVERY_REGISTRY_FILE = path.join(STORAGE_DIR, 'recovery_registry.json');
const HISTORY_REGISTRY_FILE = path.join(STORAGE_DIR, 'history_registry.json');
const TEMPLATE_REPORT = path.join(ROOT_DIR, 'docker', 'default_report.frx');
const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days retention

// Ensure required storage directories exist
[STORAGE_DIR, SAVED_REPORTS_DIR, ARCHIVE_REPORTS_DIR, RECOVERY_REPORTS_DIR, HISTORY_REPORTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Loads the reports metadata registry from JSON file
 */
function loadRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

/**
 * Persists the reports metadata registry to disk
 */
function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * Loads the recovery registry from JSON file
 */
function loadRecoveryRegistry() {
  if (!fs.existsSync(RECOVERY_REGISTRY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(RECOVERY_REGISTRY_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

/**
 * Persists the recovery registry to disk
 */
function saveRecoveryRegistry(items) {
  fs.writeFileSync(RECOVERY_REGISTRY_FILE, JSON.stringify(items, null, 2), 'utf8');
}

/**
 * Loads the history registry from JSON file
 */
function loadHistoryRegistry() {
  if (!fs.existsSync(HISTORY_REGISTRY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(HISTORY_REGISTRY_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

/**
 * Persists the history registry to disk
 */
function saveHistoryRegistry(items) {
  fs.writeFileSync(HISTORY_REGISTRY_FILE, JSON.stringify(items, null, 2), 'utf8');
}

/**
 * Purges auto-saved recovered files older than 7 days
 */
function purgeOldRecoveryFiles() {
  const registry = loadRecoveryRegistry();
  const now = Date.now();
  const remaining = [];

  for (const item of registry) {
    const isExpired = now - (item.timestamp || 0) > RECOVERY_MAX_AGE_MS;
    const filePath = path.join(RECOVERY_REPORTS_DIR, item.filename);
    if (isExpired || item.deleted) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    } else {
      if (fs.existsSync(filePath)) {
        remaining.push(item);
      }
    }
  }

  saveRecoveryRegistry(remaining);
  return remaining;
}

/**
 * Synchronizes physical files on disk with the metadata registry
 */
function syncRegistryWithDisk() {
  const registry = loadRegistry();
  const diskFiles = fs.readdirSync(SAVED_REPORTS_DIR).filter((f) => f.endsWith('.frx'));

  let modified = false;
  for (const file of diskFiles) {
    const existing = registry.find((r) => r.filename === file);
    const filePath = path.join(SAVED_REPORTS_DIR, file);
    const stats = fs.statSync(filePath);

    if (!existing) {
      registry.push({
        id: 'rep_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        name: file.replace(/\.frx$/i, '').replace(/_/g, ' '),
        filename: file,
        sizeKb: (stats.size / 1024).toFixed(1),
        modifiedAt: stats.mtime.toLocaleString(),
        modifiedTimestamp: stats.mtimeMs,
        createdAt: new Date().toISOString(),
        deleted: false
      });
      modified = true;
    } else if (!existing.deleted) {
      existing.sizeKb = (stats.size / 1024).toFixed(1);
      existing.modifiedAt = stats.mtime.toLocaleString();
      existing.modifiedTimestamp = stats.mtimeMs;
    }
  }

  if (modified) {
    saveRegistry(registry);
  }
  return registry;
}
syncRegistryWithDisk();

// Active sessions memory store
// Key: sessionId, Value: sessionData
const activeSessions = new Map();

/**
 * Checks if a specific TCP port is available on the host
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, '0.0.0.0');
  });
}

/**
 * Finds an available TCP port in the specified range, ensuring it's not currently
 * assigned to another active session in memory or in TCP TIME_WAIT.
 */
async function findAvailablePort(startPort, endPort) {
  const busyPorts = new Set();
  for (const session of activeSessions.values()) {
    if (session.vncPort) busyPorts.add(session.vncPort);
    if (session.bridgePort) busyPorts.add(session.bridgePort);
  }

  for (let port = startPort; port <= endPort; port++) {
    if (busyPorts.has(port)) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${endPort}`);
}

/**
 * Executes a shell command as a Promise
 */
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`${err.message} (stderr: ${stderr})`));
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Waits until an HTTP endpoint responds with a 2xx or 3xx status code
 * ensuring the containerized services (websockify / bridge) are live before frontend connects.
 */
function waitForHttpEndpoint(url, timeoutMs = 20000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let resolved = false;

    function probe() {
      if (resolved) return;

      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolved = true;
          return resolve(true);
        }
        scheduleRetry();
      });

      req.on('error', () => scheduleRetry());
      req.setTimeout(1000, () => {
        req.destroy();
        scheduleRetry();
      });
    }

    let retryTimer = null;
    function scheduleRetry() {
      if (resolved) return;
      if (retryTimer) return;

      if (Date.now() - startTime > timeoutMs) {
        resolved = true;
        return reject(new Error(`Timeout esperando que el servicio en ${url} esté listo`));
      }

      retryTimer = setTimeout(() => {
        retryTimer = null;
        probe();
      }, 300);
    }

    probe();
  });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(PUBLIC_DIR));

// Serve noVNC client module directly from node_modules if present
const novncPath = path.join(__dirname, 'node_modules', '@novnc', 'novnc');
if (fs.existsSync(novncPath)) {
  app.use('/novnc', express.static(novncPath));
}

/**
 * Dummy Authentication Middleware
 */
function authMiddleware(req, res, next) {
  const token =
    req.headers['x-auth-token'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.query.token ||
    req.body?.token;

  if (!token || typeof token !== 'string' || token.trim().length < 2) {
    return res.status(401).json({
      error: 'Acceso no autorizado. Token inválido o ausente.',
      hint: `Indica un token identificador de usuario (ej: demo-user-123, user-A, user-B)`
    });
  }
  req.userToken = token.trim();
  next();
}

// ==============================================================================
// SERVER-SENT EVENTS (SSE) & URL INTERCEPTION (MANAGED BY ORCHESTRATOR)
// ==============================================================================
const sessionSseClients = new Map(); // sessionId -> Set of res objects

/**
 * GET /events/:sessionId - Browser subscribes to real-time events for this session
 */
app.get('/events/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  if (!sessionSseClients.has(sessionId)) {
    sessionSseClients.set(sessionId, new Set());
  }
  sessionSseClients.get(sessionId).add(res);

  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE Connected to Orchestrator', sessionId, time: Date.now() })}\n\n`);

  const keepAliveTimer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    if (sessionSseClients.has(sessionId)) {
      sessionSseClients.get(sessionId).delete(res);
      if (sessionSseClients.get(sessionId).size === 0) {
        sessionSseClients.delete(sessionId);
      }
    }
  });
});

/**
 * POST /api/session/:sessionId/open-url - Intercepted URL from Wine via url-redirector.sh
 */
app.post('/api/session/:sessionId/open-url', (req, res) => {
  const { sessionId } = req.params;
  const { url, source } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  console.log(`[ORCHESTRATOR SSE] Intercepted URL from Wine for session ${sessionId}: ${url}`);

  const clients = sessionSseClients.get(sessionId);
  if (clients && clients.size > 0) {
    const payload = JSON.stringify({ url, source: source || 'wine', timestamp: Date.now() });
    for (const client of clients) {
      try {
        client.write(`event: open_url\ndata: ${payload}\n\n`);
      } catch (_) {}
    }
  }

  res.json({ success: true, url });
});

// ==============================================================================
// REST API ROUTES
// ==============================================================================

/**
 * GET /api/reports - Lists all active format records from the registry
 */
app.get("/api/reports", authMiddleware, (req, res) => {
  try {
    const registry = syncRegistryWithDisk();
    const activeReports = registry
      .filter((r) => !r.deleted)
      .sort((a, b) => (b.modifiedTimestamp || 0) - (a.modifiedTimestamp || 0));

    res.json({ reports: activeReports });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al listar reportes", details: err.message });
  }
});

/**
 * POST /api/reports/rename - Renames a report record
 */
app.post('/api/reports/rename', authMiddleware, (req, res) => {
  try {
    const { id, newName } = req.body;
    if (!id || !newName || !newName.trim()) {
      return res.status(400).json({ error: 'El identificador y el nuevo nombre son obligatorios.' });
    }

    const registry = syncRegistryWithDisk();
    const item = registry.find((r) => r.id === id || r.filename === id);
    if (!item) {
      return res.status(404).json({ error: 'Registro de formato no encontrado.' });
    }

    item.name = newName.trim();
    item.modifiedAt = new Date().toLocaleString();
    item.modifiedTimestamp = Date.now();
    saveRegistry(registry);

    res.json({ success: true, report: item });
  } catch (err) {
    res.status(500).json({ error: 'Error al renombrar registro', details: err.message });
  }
});

/**
 * POST /api/reports/upload - Uploads and registers a new format file (.frx)
 */
app.post('/api/reports/upload', authMiddleware, (req, res) => {
  try {
    const { name, filename, contentText, contentBase64 } = req.body;
    if (!name || (!contentText && !contentBase64)) {
      return res.status(400).json({ error: 'Nombre del formato y contenido son requeridos.' });
    }

    const safeBase = (filename || name).replace(/[^a-zA-Z0-9_\-\. ]/g, '_').replace(/\.frx$/i, '') + '.frx';
    const filePath = path.join(SAVED_REPORTS_DIR, safeBase);

    if (contentText) {
      fs.writeFileSync(filePath, contentText, 'utf8');
    } else {
      const buf = Buffer.from(contentBase64.replace(/^data:.*?;base64,/, ''), 'base64');
      fs.writeFileSync(filePath, buf);
    }

    const stats = fs.statSync(filePath);
    const registry = syncRegistryWithDisk();
    let item = registry.find((r) => r.filename === safeBase);
    if (item) {
      item.name = name.trim();
      item.deleted = false;
      item.sizeKb = (stats.size / 1024).toFixed(1);
      item.modifiedAt = stats.mtime.toLocaleString();
      item.modifiedTimestamp = stats.mtimeMs;
    } else {
      item = {
        id: 'rep_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        name: name.trim(),
        filename: safeBase,
        sizeKb: (stats.size / 1024).toFixed(1),
        modifiedAt: stats.mtime.toLocaleString(),
        modifiedTimestamp: stats.mtimeMs,
        createdAt: new Date().toISOString(),
        deleted: false
      };
      registry.push(item);
    }
    saveRegistry(registry);

    res.json({ success: true, report: item });
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar formato', details: err.message });
  }
});

/**
 * GET /api/reports/:id/download - Direct download of a saved .frx report
 */
app.get('/api/reports/:id/download', (req, res) => {
  const registry = loadRegistry();
  const item = registry.find((r) => r.id === req.params.id || r.filename === req.params.id);
  const targetFilename = item ? item.filename : path.basename(req.params.id).replace(/\.frx$/i, '') + '.frx';
  const filePath = path.join(SAVED_REPORTS_DIR, targetFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo de formato no encontrado en el servidor' });
  }
  res.download(filePath, item ? `${item.name}.frx` : targetFilename);
});

/**
 * DELETE /api/reports/:id - Deletes the registry record, keeping the physical format file on server
 */
app.delete('/api/reports/:id', authMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const registry = syncRegistryWithDisk();
    const item = registry.find((r) => r.id === id || r.filename === id || r.name === id);

    if (!item) {
      return res.status(404).json({ error: 'Registro de formato no encontrado' });
    }

    // 1. Mark as deleted in registry (soft-delete from UI)
    item.deleted = true;
    item.deletedAt = new Date().toISOString();
    saveRegistry(registry);

    // 2. Archive a persistent backup copy in archived_reports to ensure it remains on server
    const sourcePath = path.join(SAVED_REPORTS_DIR, item.filename);
    if (fs.existsSync(sourcePath)) {
      const archiveTarget = path.join(ARCHIVE_REPORTS_DIR, `${Date.now()}_${item.filename}`);
      fs.copyFileSync(sourcePath, archiveTarget);
    }

    res.json({
      success: true,
      message: `Registro '${item.name}' eliminado de la lista. El formato permanece respaldado en el servidor.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar eliminación', details: err.message });
  }
});

/**
 * GET /api/recovery - Lists all auto-saved uncommitted documents (7 days retention)
 */
app.get('/api/recovery', (req, res) => {
  try {
    const active = purgeOldRecoveryFiles().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({ count: active.length, recovered: active });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar documentos recuperados', details: err.message });
  }
});

/**
 * DELETE /api/recovery/:id - Discards an auto-saved recovered document
 */
app.delete('/api/recovery/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const registry = loadRecoveryRegistry();
    const item = registry.find((r) => r.id === id || r.filename === id);
    if (!item) {
      return res.status(404).json({ error: 'Documento recuperado no encontrado' });
    }

    const filePath = path.join(RECOVERY_REPORTS_DIR, item.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }

    const updated = registry.filter((r) => r.id !== id && r.filename !== id);
    saveRecoveryRegistry(updated);

    res.json({ success: true, message: `Documento '${item.name}' descartado.` });
  } catch (err) {
    res.status(500).json({ error: 'Error al descartar documento', details: err.message });
  }
});

/**
 * GET /api/session/resume/:sessionId - Checks if a session is alive in Standby and resumes it
 */
app.get('/api/session/resume/:sessionId', authMiddleware, (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada o ya expirada.' });
  }

  // Restore to active state and refresh heartbeat
  session.status = 'active';
  session.lastHeartbeat = Date.now();
  session.standbyStartedAt = null;
  console.log(`[ORCHESTRATOR] Session ${sessionId} resumed via API!`);

  const host = req.hostname || 'localhost';
  res.json({
    success: true,
    sessionId: session.sessionId,
    containerName: session.containerName,
    vncPort: session.vncPort,
    vncUrl: `ws://${host}:${session.vncPort}`,
    eventsUrl: `/events/${session.sessionId}`,
    reportName: session.sourceReport,
    appMode: session.appMode,
    resumed: true
  });
});

/**
 * Finds all active or standby sessions associated with a report
 */
function findActiveSessionsForReport(filename, reportName) {
  const cleanBase = (filename || '').replace(/\.frx$/i, '').trim().toLowerCase();
  const cleanName = (reportName || '').trim().toLowerCase();
  const matches = [];

  for (const session of activeSessions.values()) {
    const matchesOriginal = session.originalFilename && filename && session.originalFilename.toLowerCase() === filename.toLowerCase();
    const matchesReport = session.sourceReport && cleanName && session.sourceReport.toLowerCase() === cleanName;
    const matchesBase = session.sourceReport && cleanBase && session.sourceReport.toLowerCase().includes(cleanBase);

    if (matchesOriginal || matchesReport || matchesBase) {
      matches.push(session);
    }
  }
  return matches;
}

/**
 * Finds recovered uncommitted report files in recovery_registry.json
 */
function findPendingRecoveriesForReport(filename, reportName) {
  const cleanBase = (filename || '').replace(/\.frx$/i, '').trim().toLowerCase();
  const cleanName = (reportName || '').trim().toLowerCase();
  const recRegistry = purgeOldRecoveryFiles();

  return recRegistry.filter((item) => {
    if (item.deleted) return false;
    if (item.originalFilename && filename && item.originalFilename.toLowerCase() === filename.toLowerCase()) return true;
    if (item.name && cleanName && item.name.toLowerCase() === cleanName) return true;
    if (item.filename && cleanBase && item.filename.toLowerCase().includes(cleanBase)) return true;
    return false;
  });
}

/**
 * GET /api/session/check-pending - Checks if a report has pending uncommitted changes
 */
app.get('/api/session/check-pending', (req, res) => {
  const { filename, reportName } = req.query;
  const userToken = req.headers['x-auth-token'] || req.query.token || 'demo-user-123';

  if (!filename && !reportName) {
    return res.status(400).json({ error: 'Parámetros filename o reportName requeridos' });
  }

  const activeMatches = findActiveSessionsForReport(filename, reportName);
  const recoveryMatches = findPendingRecoveriesForReport(filename, reportName);

  // 1. Check if the CURRENT user has an active or standby session for this report
  const currentUserSession = activeMatches.find((s) => s.userToken === userToken);
  if (currentUserSession) {
    return res.json({
      hasPending: true,
      pendingType: 'session',
      isOwnSession: true,
      userToken: currentUserSession.userToken,
      sessionId: currentUserSession.sessionId,
      sessionStatus: currentUserSession.status,
      reportName: currentUserSession.sourceReport,
      timestamp: currentUserSession.lastHeartbeat || currentUserSession.startTime,
      date: new Date(currentUserSession.lastHeartbeat || currentUserSession.startTime).toLocaleString(),
      message: `Tienes una sesión previa (${currentUserSession.status}) con cambios recientes para este reporte.`
    });
  }

  // 2. Check if the CURRENT user has a recovered uncommitted file from an expired standby
  const currentUserRecovery = recoveryMatches.find((r) => r.userToken === userToken);
  if (currentUserRecovery) {
    return res.json({
      hasPending: true,
      pendingType: 'recovery',
      isOwnSession: true,
      userToken: currentUserRecovery.userToken || userToken,
      recoveryId: currentUserRecovery.id,
      recoveryFilename: currentUserRecovery.filename,
      reportName: currentUserRecovery.name,
      sizeKb: currentUserRecovery.sizeKb,
      timestamp: currentUserRecovery.timestamp,
      date: currentUserRecovery.date || new Date(currentUserRecovery.timestamp).toLocaleString(),
      message: `Se encontró una versión auto-guardada de una sesión anterior tuya que no fue guardada formalmente.`
    });
  }

  // 3. What if ANOTHER user currently has an active session on this report?
  // Multi-user concurrency: User B can open their own isolated session without interrupting User A!
  const otherUsers = activeMatches.filter((s) => s.userToken !== userToken);
  if (otherUsers.length > 0) {
    return res.json({
      hasPending: false,
      concurrentNotice: true,
      otherUsers: otherUsers.map((s) => s.userToken),
      message: `Aviso: El usuario "${otherUsers[0].userToken}" está editando este reporte. Se abrirá una sesión independiente en tu propia RAM sin interferir con la de él.`
    });
  }

  res.json({ hasPending: false });
});

/**
 * GET /api/recovery/:id/download - Downloads a recovered file directly to the client
 */
app.get('/api/recovery/:id/download', (req, res) => {
  const { id } = req.params;
  const registry = loadRecoveryRegistry();
  const item = registry.find((r) => r.id === id || r.filename === id);
  if (!item) {
    return res.status(404).json({ error: 'Documento recuperado no encontrado' });
  }
  const filePath = path.join(RECOVERY_REPORTS_DIR, item.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo físico no encontrado en disco' });
  }
  const downloadName = (item.name || 'reporte_recuperado').replace(/\.frx$/i, '') + '_recuperado.frx';
  res.download(filePath, downloadName);
});

/**
 * GET /api/session/:sessionId/download-ram - Extracts and downloads /workspace/report.frx from RAM tmpfs
 */
app.get('/api/session/:sessionId/download-ram', async (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no activa' });
  }
  try {
    const extractProcess = spawn('docker', ['exec', session.containerName, 'cat', '/workspace/report.frx']);
    const chunks = [];
    extractProcess.stdout.on('data', (d) => chunks.push(d));
    await new Promise((resolve, reject) => {
      extractProcess.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Exit code ' + code))));
      extractProcess.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    const downloadName = (session.sourceReport || 'reporte_sesion').replace(/\.frx$/i, '') + '_pendiente.frx';
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Error al extraer reporte de RAM', details: err.message });
  }
});

/**
 * GET /api/history - Lists modification history for a given report or all reports
 */
app.get('/api/history', (req, res) => {
  try {
    const { filename, reportName } = req.query;
    const all = loadHistoryRegistry();
    if (!filename && !reportName) {
      return res.json({ count: all.length, history: all });
    }

    const cleanBase = (filename || '').replace(/\.frx$/i, '').trim().toLowerCase();
    const cleanName = (reportName || '').trim().toLowerCase();

    const filtered = all
      .filter((h) => {
        if (filename && h.originalFilename && h.originalFilename.toLowerCase() === filename.toLowerCase()) return true;
        if (cleanName && h.reportName && h.reportName.toLowerCase() === cleanName) return true;
        if (cleanBase && h.filename && h.filename.toLowerCase().includes(cleanBase)) return true;
        return false;
      })
      .map((h) => ({
        ...h,
        snapshotFilename: h.filename
      }));

    res.json({ count: filtered.length, history: filtered });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar historial', details: err.message });
  }
});

/**
 * GET /api/history/:id/download - Downloads a historical .frx version snapshot
 */
app.get('/api/history/:id/download', (req, res) => {
  const { id } = req.params;
  const registry = loadHistoryRegistry();
  const item = registry.find((h) => h.id === id || h.filename === id);
  if (!item) {
    return res.status(404).json({ error: 'Registro de historial no encontrado' });
  }
  const filePath = path.join(HISTORY_REPORTS_DIR, item.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo físico no encontrado en disco' });
  }
  const downloadName = `${item.reportName || 'reporte'}_${item.versionLabel || 'v1'}.frx`;
  res.download(filePath, downloadName);
});

/**
 * POST /api/history/:id/restore - Restores a historical version as the current main report
 */
app.post('/api/history/:id/restore', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const historyRegistry = loadHistoryRegistry();
    const item = historyRegistry.find((h) => h.id === id || h.filename === id);
    if (!item) {
      return res.status(404).json({ error: 'Versión histórica no encontrada' });
    }

    const historyFilePath = path.join(HISTORY_REPORTS_DIR, item.filename);
    if (!fs.existsSync(historyFilePath)) {
      return res.status(404).json({ error: 'Archivo histórico físico no encontrado' });
    }

    const targetFilename = item.originalFilename || `${item.reportName}.frx`;
    const targetPath = path.join(SAVED_REPORTS_DIR, targetFilename);
    const restoredBuffer = fs.readFileSync(historyFilePath);

    // Overwrite the saved report
    fs.writeFileSync(targetPath, restoredBuffer);

    // Update main reports registry
    const reportsRegistry = syncRegistryWithDisk();
    const existingRep = reportsRegistry.find((r) => r.filename === targetFilename);
    if (existingRep) {
      existingRep.modifiedAt = new Date().toLocaleString();
      existingRep.modifiedTimestamp = Date.now();
      existingRep.sizeKb = (restoredBuffer.length / 1024).toFixed(1);
      saveRegistry(reportsRegistry);
    }

    // Add a new version in history indicating restoration
    const cleanReportKey = targetFilename.replace(/\.frx$/i, '').toLowerCase();
    const existingVersions = historyRegistry.filter((h) =>
      (h.originalFilename && h.originalFilename.toLowerCase() === targetFilename.toLowerCase()) ||
      (h.reportName && h.reportName.toLowerCase() === cleanReportKey)
    );
    const nextVerNum = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version || 1)) + 1
      : 1;
    const versionLabel = `v${nextVerNum}`;
    const newHistFilename = `hist_${Date.now()}_${targetFilename.replace(/\.frx$/i, '')}_${versionLabel}.frx`;
    const newHistPath = path.join(HISTORY_REPORTS_DIR, newHistFilename);

    fs.writeFileSync(newHistPath, restoredBuffer);

    const newHistEntry = {
      id: 'hist_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      reportName: item.reportName,
      originalFilename: targetFilename,
      version: nextVerNum,
      versionLabel,
      filename: newHistFilename,
      userToken: req.userToken || 'demo-user-123',
      comment: `Restaurado a partir de ${item.versionLabel} por ${req.userToken || 'usuario'}`,
      timestamp: Date.now(),
      date: new Date().toLocaleString(),
      sizeKb: (restoredBuffer.length / 1024).toFixed(1)
    };
    historyRegistry.unshift(newHistEntry);
    saveHistoryRegistry(historyRegistry);

    res.json({
      success: true,
      message: `El reporte '${targetFilename}' fue restaurado exitosamente a la versión ${item.versionLabel} (generada como ${versionLabel}).`,
      newVersion: versionLabel
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al restaurar versión histórica', details: err.message });
  }
});

/**
 * POST /api/session/start - Spawns a new ephemeral streaming container in RAM tmpfs
 */
app.post('/api/session/start', authMiddleware, async (req, res) => {
  const { reportName, sourceFilename, startType, uploadedContent, mode } = req.body;
  const appMode = mode === 'test' ? 'test' : 'fastreport';
  const userToken = req.userToken || 'demo-user-123';

  // 1. Prepare initial report buffer strictly based on startType.
  // NO SILENT FALLBACKS: If a specific report file or snapshot is requested and missing, FAIL FAST with 404/400.
  let initialReportBuffer = null;
  let sourceReportUsed = reportName || 'En Blanco';
  let originalFilename = null;

  try {
    if (startType === 'upload') {
      if (!uploadedContent) {
        return res.status(400).json({ error: 'No se recibió el contenido del archivo .frx para cargar.' });
      }
      initialReportBuffer = Buffer.from(uploadedContent, 'utf8');
      sourceReportUsed = reportName || 'Formato Cargado';

    } else if (startType === 'history') {
      if (!sourceFilename || sourceFilename === 'undefined') {
        return res.status(400).json({ error: 'No se especificó la versión histórica a cargar.' });
      }
      const sanitizedSource = path.basename(sourceFilename);
      const histReg = loadHistoryRegistry();
      const histItem = histReg.find((h) => h.filename === sanitizedSource || h.id === sanitizedSource || (h.versionLabel && sanitizedSource.includes(h.versionLabel)));
      const targetFilename = histItem ? histItem.filename : sanitizedSource;
      const historyPath = path.join(HISTORY_REPORTS_DIR, targetFilename);

      if (!fs.existsSync(historyPath)) {
        return res.status(404).json({ error: `La versión histórica "${sourceFilename}" no se encuentra en el servidor.` });
      }
      initialReportBuffer = fs.readFileSync(historyPath);
      sourceReportUsed = reportName || (histItem ? histItem.reportName : targetFilename.replace(/^hist_\d+_/, '').replace(/\.frx$/i, ''));
      originalFilename = (histItem && histItem.originalFilename) || req.body.originalFilename || null;
      console.log(`[ORCHESTRATOR] Loaded historical version ${targetFilename} (${initialReportBuffer.length} bytes)`);

    } else if (startType === 'recovery') {
      if (!sourceFilename || sourceFilename === 'undefined') {
        return res.status(400).json({ error: 'No se especificó el documento recuperado a abrir.' });
      }
      const sanitizedSource = path.basename(sourceFilename);
      const recoveryPath = path.join(RECOVERY_REPORTS_DIR, sanitizedSource);

      if (!fs.existsSync(recoveryPath)) {
        return res.status(404).json({ error: `El documento recuperado "${sourceFilename}" no existe o ya expiró.` });
      }
      initialReportBuffer = fs.readFileSync(recoveryPath);
      sourceReportUsed = reportName || sanitizedSource.replace(/^rec_\d+_/, '').replace(/\.frx$/i, '');
      const recReg = loadRecoveryRegistry();
      const recItem = recReg.find((r) => r.filename === sanitizedSource || r.id === sanitizedSource);
      if (recItem && recItem.originalFilename) {
        originalFilename = recItem.originalFilename;
      }

    } else if (startType === 'existing') {
      if (!sourceFilename || sourceFilename === 'undefined') {
        return res.status(400).json({ error: 'No se especificó el archivo de formato a abrir.' });
      }
      const sanitizedSource = path.basename(sourceFilename).replace(/\.frx$/i, '') + '.frx';
      const existingReport = path.join(SAVED_REPORTS_DIR, sanitizedSource);

      if (!fs.existsSync(existingReport)) {
        return res.status(404).json({ error: `El archivo de formato guardado "${sanitizedSource}" no existe en el servidor.` });
      }
      initialReportBuffer = fs.readFileSync(existingReport);
      sourceReportUsed = reportName || sanitizedSource;
      originalFilename = sanitizedSource;

    } else if (startType === 'blank') {
      // User explicitly asked for a blank new template
      if (!fs.existsSync(TEMPLATE_REPORT)) {
        return res.status(500).json({ error: 'La plantilla base en blanco del servidor no está disponible.' });
      }
      initialReportBuffer = fs.readFileSync(TEMPLATE_REPORT);
      sourceReportUsed = reportName || 'Nuevo Formato';

    } else if (sourceFilename && sourceFilename !== 'undefined') {
      // Legacy or direct parameter with filename provided
      const sanitizedSource = path.basename(sourceFilename).replace(/\.frx$/i, '') + '.frx';
      const existingReport = path.join(SAVED_REPORTS_DIR, sanitizedSource);

      if (!fs.existsSync(existingReport)) {
        return res.status(404).json({ error: `El archivo de formato "${sanitizedSource}" no existe en el servidor.` });
      }
      initialReportBuffer = fs.readFileSync(existingReport);
      sourceReportUsed = reportName || sanitizedSource;
      originalFilename = sanitizedSource;

    } else {
      // Only when startType is not provided and NO filename was requested, default to blank
      if (!fs.existsSync(TEMPLATE_REPORT)) {
        return res.status(500).json({ error: 'La plantilla base en blanco del servidor no está disponible.' });
      }
      initialReportBuffer = fs.readFileSync(TEMPLATE_REPORT);
      sourceReportUsed = reportName || 'En Blanco';
    }

    if (!initialReportBuffer || initialReportBuffer.length === 0) {
      return res.status(400).json({ error: 'El archivo de formato está vacío o no pudo ser procesado.' });
    }

    // 2. Allocate dynamic port for VNC (websockify) ONLY AFTER verifying the file exists
    const vncPort = await findAvailablePort(6081, 6300);
    const sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const containerName = `fastreport_${sessionId}`;

    console.log(`[ORCHESTRATOR] Starting container ${containerName} (User: ${userToken}, Mode: ${appMode}, VNC: ${vncPort}, RAM tmpfs: 2MB)...`);

    // 3. Resolve live script mounts for instant on-the-fly execution without docker build
    const openboxRcPath = path.resolve(ROOT_DIR, 'docker', 'openbox_rc.xml');
    const entrypointPath = path.resolve(ROOT_DIR, 'docker', 'entrypoint.sh');
    const redirectorPath = path.resolve(ROOT_DIR, 'docker', 'url-redirector.sh');

    const mounts = [
      fs.existsSync(openboxRcPath) ? `-v "${openboxRcPath}:/etc/xdg/openbox/rc.xml:ro"` : '',
      fs.existsSync(entrypointPath) ? `-v "${entrypointPath}:/app/entrypoint.sh:ro"` : '',
      fs.existsSync(redirectorPath) ? `-v "${redirectorPath}:/usr/local/bin/winebrowser:ro"` : ''
    ].filter(Boolean).join(' ');

    // 4. Run ephemeral container via Docker CLI with volatile in-RAM tmpfs (2MB)
    const dockerCmd = `docker run -d --name ${containerName} --network stream-net -p 127.0.0.1:${vncPort}:6080 --tmpfs /workspace:rw,size=2m ${mounts} -e SESSION_ID=${sessionId} -e ORCHESTRATOR_URL=http://host.docker.internal:3000 -e APP_MODE=${appMode} ${DOCKER_IMAGE}`;
    await runCommand(dockerCmd);

    // 5. Inject initial report directly into container RAM tmpfs
    const injectProcess = spawn('docker', ['exec', '-i', containerName, 'sh', '-c', 'cat > /workspace/report.frx']);
    injectProcess.stdin.write(initialReportBuffer);
    injectProcess.stdin.end();
    await new Promise((resolve, reject) => {
      injectProcess.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Failed to inject report into RAM (exit ${code})`))));
      injectProcess.on('error', reject);
    });

    // 6. Wait until Websockify (VNC) is live inside the container
    console.log(`[ORCHESTRATOR] Container ${containerName} started. Waiting for VNC service...`);
    await waitForHttpEndpoint(`http://127.0.0.1:${vncPort}/`, 20000);
    console.log(`[ORCHESTRATOR] Container ${containerName} VNC is live and ready!`);

    // 7. Record active session
    const sessionData = {
      sessionId,
      containerName,
      vncPort,
      bridgePort: null,
      appMode,
      sourceReport: sourceReportUsed,
      originalFilename,
      userToken,
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'active' // 'active' | 'standby'
    };
    activeSessions.set(sessionId, sessionData);

    const host = req.hostname || 'localhost';
    res.json({
      success: true,
      sessionId,
      containerName,
      vncPort,
      vncUrl: `ws://${host}:${vncPort}`,
      eventsUrl: `/events/${sessionId}`,
      reportName: sourceReportUsed,
      appMode,
      userToken
    });
  } catch (err) {
    console.error(`[ORCHESTRATOR] Failed to start container for session ${sessionId}:`, err);
    try { await runCommand(`docker rm -f ${containerName}`); } catch (_) {}
    res.status(500).json({
      error: 'Error al iniciar el contenedor del diseñador',
      details: err.message
    });
  }
});

/**
 * POST /api/session/stop - Stops and destroys the ephemeral container
 * Handles user decision to save the working report from RAM or discard it.
 */
app.post('/api/session/stop', async (req, res) => {
  const { sessionId, save, reportName, comment } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Falta el parámetro sessionId' });
  }

  const session = activeSessions.get(sessionId);
  const containerName = session ? session.containerName : `fastreport_${sessionId}`;

  let savedName = null;

  try {
    // 1. If user requested saving the report, extract directly from container RAM tmpfs
    if (save === true || save === 'true') {
      let finalName = (reportName || 'Reporte_' + new Date().toISOString().slice(0, 10)).trim();
      finalName = finalName.replace(/[^a-zA-Z0-9_\-\. ]/g, '_').replace(/\.frx$/i, '') + '.frx';

      try {
        const reportContent = execSync(`docker exec ${containerName} cat /workspace/report.frx`);
        const targetPath = path.join(SAVED_REPORTS_DIR, finalName);
        fs.writeFileSync(targetPath, reportContent);
        savedName = finalName;
        console.log(`[ORCHESTRATOR] Session ${sessionId} report extracted from RAM and saved: ${targetPath}`);

        // Update / activate in registry
        const stats = fs.statSync(targetPath);
        const registry = syncRegistryWithDisk();
        const displayName = (reportName || finalName.replace(/\.frx$/i, '')).trim();
        let item = registry.find((r) => r.filename === finalName);
        if (item) {
          item.name = displayName;
          item.deleted = false;
          item.sizeKb = (stats.size / 1024).toFixed(1);
          item.modifiedAt = stats.mtime.toLocaleString();
          item.modifiedTimestamp = stats.mtimeMs;
        } else {
          registry.push({
            id: 'rep_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
            name: displayName,
            filename: finalName,
            sizeKb: (stats.size / 1024).toFixed(1),
            modifiedAt: stats.mtime.toLocaleString(),
            modifiedTimestamp: stats.mtimeMs,
            createdAt: new Date().toISOString(),
            deleted: false
          });
        }
        saveRegistry(registry);

        // Save historical modification snapshot in storage/history/
        const histRegistry = loadHistoryRegistry();
        const baseKey = finalName.replace(/\.frx$/i, '').toLowerCase();
        const existingVersions = histRegistry.filter((h) =>
          (h.originalFilename && h.originalFilename.toLowerCase() === finalName.toLowerCase()) ||
          (h.reportName && h.reportName.toLowerCase() === baseKey)
        );
        const nextVerNum = existingVersions.length > 0
          ? Math.max(...existingVersions.map((v) => v.version || 1)) + 1
          : 1;
        const versionLabel = `v${nextVerNum}`;
        const histFilename = `hist_${Date.now()}_${finalName.replace(/\.frx$/i, '')}_${versionLabel}.frx`;
        const histPath = path.join(HISTORY_REPORTS_DIR, histFilename);

        fs.writeFileSync(histPath, reportContent);

        const histEntry = {
          id: 'hist_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
          reportName: displayName,
          originalFilename: finalName,
          version: nextVerNum,
          versionLabel,
          filename: histFilename,
          userToken: session ? session.userToken : 'demo-user-123',
          comment: (comment && comment.trim()) ? comment.trim() : `Guardado por ${session ? session.userToken : 'usuario'}`,
          timestamp: Date.now(),
          date: new Date().toLocaleString(),
          sizeKb: (reportContent.length / 1024).toFixed(1)
        };
        histRegistry.unshift(histEntry);
        saveHistoryRegistry(histRegistry);
        console.log(`[ORCHESTRATOR] Saved version ${versionLabel} in history for ${finalName} by ${histEntry.userToken}`);

        // Clean up any pending recovery record for this report since it is now officially saved
        const recRegistry = loadRecoveryRegistry();
        const updatedRec = recRegistry.filter((r) => {
          const matchesOriginal = session.originalFilename && r.originalFilename && r.originalFilename.toLowerCase() === session.originalFilename.toLowerCase();
          const matchesName = r.name && r.name.toLowerCase() === savedName.replace(/\.frx$/i, '').toLowerCase();
          if (matchesOriginal || matchesName) {
            const recPath = path.join(RECOVERY_REPORTS_DIR, r.filename);
            if (fs.existsSync(recPath)) {
              try { fs.unlinkSync(recPath); } catch (_) {}
            }
            return false;
          }
          return true;
        });
        saveRecoveryRegistry(updatedRec);
      } catch (extractErr) {
        console.warn(`[ORCHESTRATOR] Warning: Could not extract report from RAM:`, extractErr.message);
      }
    } else {
      console.log(`[ORCHESTRATOR] Session ${sessionId} discarded by user without saving.`);
    }

    // 2. Stop and remove Docker container immediately (clearing all RAM tmpfs)
    try {
      console.log(`[ORCHESTRATOR] Destroying container ${containerName}...`);
      await runCommand(`docker rm -f ${containerName}`);
    } catch (dockerErr) {
      console.warn(`[ORCHESTRATOR] Notice: Container ${containerName} cleanup:`, dockerErr.message);
    }

    // 3. Clean up SSE client connections
    sessionSseClients.delete(sessionId);

    // 4. Remove from active sessions
    activeSessions.delete(sessionId);

    res.json({
      success: true,
      sessionId,
      saved: !!savedName,
      savedReportName: savedName,
      message: savedName
        ? `Reporte '${savedName}' guardado exitosamente y contenedor destruido.`
        : 'Sesión finalizada y contenedor efímero destruido.'
    });
  } catch (err) {
    console.error(`[ORCHESTRATOR] Error stopping session ${sessionId}:`, err);
    res.status(500).json({ error: 'Error al finalizar sesión', details: err.message });
  }
});

/**
 * POST /api/session/load-format - Loads a new format into an active session workspace (RAM tmpfs)
 */
app.post('/api/session/load-format', authMiddleware, async (req, res) => {
  const { sessionId, formatType, sourceFilename, uploadedContent, reportName } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Falta el parámetro sessionId' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'La sesión especificada no está activa' });
  }

  let newBuffer = null;
  let displayName = reportName || 'Nuevo Formato';

  try {
    if (formatType === 'upload' && uploadedContent) {
      newBuffer = Buffer.from(uploadedContent, 'utf8');
      displayName = reportName || 'Formato Cargado';
    } else if (formatType === 'existing' && sourceFilename) {
      const sanitizedSource = path.basename(sourceFilename).replace(/\.frx$/i, '') + '.frx';
      const existingReport = path.join(SAVED_REPORTS_DIR, sanitizedSource);
      if (!fs.existsSync(existingReport)) {
        return res.status(404).json({ error: 'El archivo base no existe en el servidor' });
      }
      newBuffer = fs.readFileSync(existingReport);
      displayName = reportName || sanitizedSource;
    } else {
      return res.status(400).json({ error: 'Datos de formato insuficientes o inválidos' });
    }

    // Inject directly into container RAM tmpfs
    const injectProcess = spawn('docker', ['exec', '-i', session.containerName, 'sh', '-c', 'cat > /workspace/report.frx']);
    injectProcess.stdin.write(newBuffer);
    injectProcess.stdin.end();
    await new Promise((resolve, reject) => {
      injectProcess.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Failed to update report in RAM'))));
      injectProcess.on('error', reject);
    });

    session.sourceReport = displayName;

    res.json({
      success: true,
      sessionId,
      reportName: displayName,
      message: `Formato '${displayName}' cargado con éxito en la memoria RAM del contenedor.`
    });
  } catch (err) {
    console.error(`[ORCHESTRATOR] Error loading format into session ${sessionId}:`, err);
    res.status(500).json({ error: 'Error al cargar formato en la sesión', details: err.message });
  }
});

/**
 * POST /api/session/heartbeat - Keeps session alive
 */
app.post('/api/session/heartbeat', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && activeSessions.has(sessionId)) {
    const s = activeSessions.get(sessionId);
    s.lastHeartbeat = Date.now();
    if (s.status === 'standby') {
      console.log(`[ORCHESTRATOR] Session ${sessionId} resumed from standby via heartbeat.`);
      s.status = 'active';
      s.standbyStartedAt = null;
    }
    return res.json({ ok: true, status: s.status });
  }
  res.status(404).json({ error: 'Sesión no activa' });
});

/**
 * POST /api/session/test-expire - For automated testing of the 5-minute standby expiration
 */
app.post('/api/session/test-expire', authMiddleware, (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && activeSessions.has(sessionId)) {
    const s = activeSessions.get(sessionId);
    s.status = 'standby';
    s.standbyStartedAt = Date.now() - (6 * 60 * 1000);
    return res.json({ ok: true, message: `Session ${sessionId} marked as expired standby` });
  }
  res.status(404).json({ error: 'Sesión no activa' });
});

/**
 * GET /api/session/active - Lists all currently running sessions
 */
app.get('/api/session/active', (req, res) => {
  res.json({
    count: activeSessions.size,
    sessions: Array.from(activeSessions.values()).map((s) => ({
      sessionId: s.sessionId,
      containerName: s.containerName,
      vncPort: s.vncPort,
      bridgePort: s.bridgePort,
      appMode: s.appMode,
      sourceReport: s.sourceReport,
      status: s.status,
      uptimeSeconds: Math.floor((Date.now() - s.startTime) / 1000)
    }))
  });
});

// Standby Monitor & Recovery Loop (checks every 5 seconds)
setInterval(async () => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    // 1. Detect disconnected client: after 40s without heartbeat, transition to standby
    if (session.status === 'active' && (now - session.lastHeartbeat > 40000)) {
      session.status = 'standby';
      session.standbyStartedAt = now;
      console.log(`[ORCHESTRATOR] Session ${id} entered STANDBY mode (no heartbeat for 40s). Preserving RAM state for 5 minutes...`);
    }

    // 2. Standby grace period expired (> 5 minutes without reconnect)
    if (session.status === 'standby' && (now - session.standbyStartedAt > 5 * 60 * 1000)) {
      console.log(`[ORCHESTRATOR] Standby expired (5m) for session ${id}. Extracting auto-saved report from RAM tmpfs...`);
      try {
        const extractProcess = spawn('docker', ['exec', session.containerName, 'cat', '/workspace/report.frx']);
        const chunks = [];
        extractProcess.stdout.on('data', (d) => chunks.push(d));

        await new Promise((resolve) => {
          extractProcess.on('close', resolve);
          extractProcess.on('error', resolve);
        });

        const reportBuffer = Buffer.concat(chunks);
        if (reportBuffer.length > 50) {
          const timestamp = Date.now();
          const cleanReportName = (session.sourceReport || 'documento')
            .replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]/g, '')
            .replace(/\s+/g, '_');
          const recoveryFilename = `rec_${timestamp}_${cleanReportName}.frx`;
          const recoveryPath = path.join(RECOVERY_REPORTS_DIR, recoveryFilename);

          fs.writeFileSync(recoveryPath, reportBuffer);

          const recRegistry = loadRecoveryRegistry();
          recRegistry.unshift({
            id: 'rec_' + timestamp.toString(36),
            name: session.sourceReport || 'Documento sin guardar',
            filename: recoveryFilename,
            originalFilename: session.originalFilename || null,
            userToken: session.userToken || 'demo-user-123',
            sizeKb: (reportBuffer.length / 1024).toFixed(1),
            timestamp,
            date: new Date(timestamp).toLocaleString(),
            sourceSession: id
          });
          saveRecoveryRegistry(recRegistry);
          console.log(`[ORCHESTRATOR] Successfully preserved recovered report: ${recoveryFilename} (${(reportBuffer.length / 1024).toFixed(1)} KB)`);
        } else {
          console.warn(`[ORCHESTRATOR] Report in RAM for session ${id} was empty or missing. Skipping recovery file.`);
        }
      } catch (err) {
        console.error(`[ORCHESTRATOR] Failed to extract report during standby expiration for ${id}:`, err);
      } finally {
        try {
          await runCommand(`docker rm -f ${session.containerName}`);
          console.log(`[ORCHESTRATOR] Destroyed ephemeral container ${session.containerName}`);
        } catch (_) {}
        sessionSseClients.delete(id);
        activeSessions.delete(id);
      }
    }
  }
}, 5000);

// Hourly cleanup for recovered files older than 7 days
setInterval(() => {
  purgeOldRecoveryFiles();
}, 3600000);

// Graceful cleanup on server termination
function cleanupAllContainers() {
  console.log('\n[ORCHESTRATOR] Server shutting down. Cleaning up ephemeral containers...');
  for (const [id, session] of activeSessions.entries()) {
    try {
      execSync(`docker rm -f ${session.containerName}`, { stdio: 'ignore' });
    } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanupAllContainers);
process.on('SIGTERM', cleanupAllContainers);

async function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(` FastReport Cloud Stream Orchestrator running on http://localhost:${PORT}`);
    console.log(` Dummy Auth Token: ${DUMMY_TOKEN}`);
    console.log(` Storage Path:      ${STORAGE_DIR}`);
    console.log('================================================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ORCHESTRATOR] Port ${PORT} is temporarily in use or TIME_WAIT, retrying in 1s...`);
      server.close();
      setTimeout(startServer, 1000);
    } else {
      console.error('[ORCHESTRATOR] Server error:', err);
    }
  });
}

startServer();
