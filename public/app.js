/**
 * FastReport Web Editor - Frontend Application (Bootstrap 5)
 * -------------------------------------------------------------
 * Manages reports table, new format modal, metadata editing,
 * soft deletion, and ephemeral streaming session lifecycle.
 */

import RFB from '/novnc/core/rfb.js';
import { apiFetch, ensureAuthenticated, clearSession, getCurrentUser } from './auth.js';

// DOM Elements: Navigation & Auth
// const tokenInput = document.getElementById('token-input');
const userDisplayPill = document.getElementById('user-display-pill');
// const userRoleBadge = document.getElementById('user-role-badge');
const btnLogout = document.getElementById('btn-logout');
// const statusBadge = document.getElementById('status-badge');
const sessionControls = document.getElementById('session-controls');
const lobbyAuth = document.getElementById('lobby-auth');
const sessionReportPill = document.getElementById('session-report-pill');

// DOM Elements: Views
const lobbyView = document.getElementById('lobby-view');
const streamView = document.getElementById('stream-view');
const vncContainer = document.getElementById('vnc-container');
const streamLoading = document.getElementById('stream-loading');
const loadingDetails = document.getElementById('loading-details');
const reportsTableBody = document.getElementById('reports-table-body');
const sessionsTableBody = document.getElementById('sessions-table-body');
const badgeSessionsCount = document.getElementById('badge-sessions-count');
const btnRefreshSessions = document.getElementById('btn-refresh-sessions');

// DOM Elements: Toolbar buttons
const btnRefreshReports = document.getElementById('btn-refresh-reports');
const btnNewFormat = document.getElementById('btn-new-format');
const btnFullscreen = document.getElementById('btn-fullscreen');
// const btnTestUrl = document.getElementById('btn-test-url');
const btnDownloadFrx = document.getElementById('btn-download-frx');
const btnSessionMockPdf = document.getElementById('btn-session-mock-pdf');
const btnCloseEditor = document.getElementById('btn-close-editor');
const btnLoadFormatSession = document.getElementById('btn-load-format-session');

// DOM Elements: Recovery Offcanvas
const btnRecoveryPanel = document.getElementById("btn-recovery-panel");
const badgeRecoveryCount = document.getElementById('badge-recovery-count');
const recoveryItemsContainer = document.getElementById('recovery-items-container');
const offcanvasRecoveryEl = document.getElementById('offcanvas-recovery');
const offcanvasRecovery = offcanvasRecoveryEl ? new bootstrap.Offcanvas(offcanvasRecoveryEl) : null;

// DOM Elements: Modal Cambios Pendientes Detectados
const modalPendingRecoveryEl = document.getElementById('modal-pending-recovery');
const modalPendingRecovery = modalPendingRecoveryEl ? new bootstrap.Modal(modalPendingRecoveryEl) : null;
const pendingReportName = document.getElementById('pending-report-name');
const pendingReportDetails = document.getElementById('pending-report-details');
const pendingBadgeStatus = document.getElementById('pending-badge-status');
const btnPendingContinueEdit = document.getElementById('btn-pending-continue-edit');
const btnPendingDownloadAndOpen = document.getElementById('btn-pending-download-and-open');
const btnPendingOpenClean = document.getElementById('btn-pending-open-clean');
const btnPendingDiscardAndOpen = document.getElementById('btn-pending-discard-and-open');

// DOM Elements: Modal Cargar Formato en Sesion
const modalSessionLoadFormatEl = document.getElementById('modal-session-load-format');
const modalSessionLoadFormat = new bootstrap.Modal(modalSessionLoadFormatEl);
const optSessionUpload = document.getElementById('opt-session-upload');
const optSessionExisting = document.getElementById('opt-session-existing');
const sessionUploadContainer = document.getElementById('session-upload-container');
const sessionFileUploadInput = document.getElementById('session-file-upload-input');
const sessionExistingContainer = document.getElementById('session-existing-container');
const selectSessionExistingFormat = document.getElementById('select-session-existing-format');
const btnConfirmSessionLoadFormat = document.getElementById('btn-confirm-session-load-format');

// DOM Elements: Modal Nuevo Formato
const modalNewFormatEl = document.getElementById('modal-new-format');
const modalNewFormat = new bootstrap.Modal(modalNewFormatEl);
const newFormatNameInput = document.getElementById('new-format-name');
const optBlank = document.getElementById('opt-blank');
const optExisting = document.getElementById('opt-existing');
const optUpload = document.getElementById('opt-upload');
const existingFormatContainer = document.getElementById('existing-format-container');
const selectExistingFormat = document.getElementById('select-existing-format');
const uploadFormatContainer = document.getElementById('upload-format-container');
const fileUploadFormat = document.getElementById('file-upload-format');
const btnConfirmNewFormat = document.getElementById('btn-confirm-new-format');

// DOM Elements: Modal Editar Registro
const modalEditRecordEl = document.getElementById('modal-edit-record');
const modalEditRecord = new bootstrap.Modal(modalEditRecordEl);
const editRecordIdInput = document.getElementById('edit-record-id');
const editRecordNameInput = document.getElementById('edit-record-name-input');
const editRecordFilenameSpan = document.getElementById('edit-record-filename');
const editRecordDateSpan = document.getElementById('edit-record-date');
const btnSaveRecordChanges = document.getElementById('btn-save-record-changes');

// DOM Elements: Modal Eliminar Registro
const modalDeleteRecordEl = document.getElementById('modal-delete-record');
const modalDeleteRecord = new bootstrap.Modal(modalDeleteRecordEl);
const deleteRecordIdInput = document.getElementById('delete-record-id');
const deleteRecordNameSpan = document.getElementById('delete-record-name-span');
const btnConfirmDeleteAction = document.getElementById('btn-confirm-delete-action');

// DOM Elements: Modal Cerrar Editor
const modalCloseEditorEl = document.getElementById('modal-close-editor');
const modalCloseEditor = new bootstrap.Modal(modalCloseEditorEl);
const closeSaveReportNameInput = document.getElementById('close-save-report-name');
const closeSaveReportCommentInput = document.getElementById('close-save-report-comment');
const btnConfirmSaveClose = document.getElementById('btn-confirm-save-close');
const btnConfirmDiscardClose = document.getElementById('btn-confirm-discard-close');

// DOM Elements: Modal Historial de Modificaciones
const modalHistoryEl = document.getElementById('modal-history');
const modalHistory = modalHistoryEl ? new bootstrap.Modal(modalHistoryEl) : null;
const historyModalSubtitle = document.getElementById('history-modal-subtitle');
const historyItemsContainer = document.getElementById('history-items-container');

// Toast notifications
const toastEl = document.getElementById('app-toast');
const toastBody = document.getElementById('toast-message');
const appToast = new bootstrap.Toast(toastEl, { delay: 5000 });

// Application State
let currentSession = null;
let rfbClient = null;
let sseSource = null;
let heartbeatInterval = null;
let cachedReports = [];
let isVncConnected = false;
let vncRetryTimer = null;

function getAuthToken() {
  const user = getCurrentUser();
  if (user && user.username) return user.username;
  // return tokenInput ? tokenInput.value.trim() : 'admin';
}

function updateAuthUI(user) {
  if (!user) return;
  if (userDisplayPill) {
    userDisplayPill.textContent = `Usuario: ${user.username}`;
  }
  // if (userRoleBadge) {
  //   userRoleBadge.textContent = user.role || 'User';
  //   userRoleBadge.className = user.role === 'Admin' ? 'badge bg-danger font-monospace' : 'badge bg-info text-dark font-monospace';
  //   userRoleBadge.classList.remove('d-none');
  // }
  // if (tokenInput) {
  //   tokenInput.value = user.username;
  // }
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    clearSession();
    window.location.href = '/auth.html';
  });
}

function showToast(message) {
  toastBody.textContent = message;
  appToast.show();
}

// function updateStatus(status, text) {
//   statusBadge.className = 'badge';
//   if (status === 'connected') {
//     statusBadge.classList.add('bg-success');
//   } else if (status === 'connecting') {
//     statusBadge.classList.add('bg-warning', 'text-dark');
//   } else {
//     statusBadge.classList.add('bg-secondary');
//   }
//   statusBadge.textContent = text;
// }

// ==============================================================================
// ACTIVE / STANDBY SESSIONS MANAGEMENT
// ==============================================================================

async function loadActiveSessions() {
  if (!sessionsTableBody) return;
  try {
    const res = await apiFetch('/api/session/active');
    if (!res.ok) throw new Error('Error al consultar sesiones');
    const data = await res.json();
    const sessions = data.sessions || [];

    if (badgeSessionsCount) {
      badgeSessionsCount.textContent = `${sessions.length} abierta${sessions.length === 1 ? '' : 's'}`;
      badgeSessionsCount.className = sessions.length > 0
        ? 'badge rounded-pill bg-success ms-2'
        : 'badge rounded-pill bg-secondary ms-2';
    }

    renderSessionsTable(sessions);
  } catch (err) {
    console.warn('Error al cargar sesiones activas:', err);
    if (sessionsTableBody) {
      sessionsTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-3 text-secondary small">
            No se pudieron obtener las sesiones activas (${escapeHtml(err.message)})
          </td>
        </tr>
      `;
    }
  }
}

function renderSessionsTable(sessions) {
  if (!sessionsTableBody) return;

  if (!sessions || sessions.length === 0) {
    sessionsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-secondary">
          No hay sesiones abiertas en este momento.
        </td>
      </tr>
    `;
    return;
  }

  const currentUser = getCurrentUser();
  const currentUsername = (currentUser?.username || '').toLowerCase();

  sessionsTableBody.innerHTML = '';
  sessions.forEach((s) => {
    const sessionUser = s.username || s.userToken || 'Desconocido';
    const isOwn = sessionUser && currentUsername && sessionUser.toLowerCase() === currentUsername;
    const isStandby = s.status === 'standby';

    // Status Badge
    const statusBadge = isStandby
      ? `<span class="badge bg-warning text-dark"><span class="spinner-grow spinner-grow-sm me-1" style="width: 0.4rem; height: 0.4rem;" role="status"></span>Standby</span>`
      : `<span class="badge bg-success"><span class="spinner-grow spinner-grow-sm me-1" style="width: 0.4rem; height: 0.4rem;" role="status"></span>Activa</span>`;

    // User Badge
    const userBadge = isOwn
      ? `<span class="badge bg-primary font-monospace">${escapeHtml(sessionUser)} <span class="badge bg-light text-dark ms-1">Tú</span></span>`
      : `<span class="badge bg-secondary font-monospace">${escapeHtml(sessionUser)}</span>`;

    // Activity timestamp
    let activityText = 'Reciente';
    if (s.lastHeartbeat) {
      const diffSec = Math.max(0, Math.round((Date.now() - s.lastHeartbeat) / 1000));
      if (diffSec < 60) activityText = `Hace ${diffSec}s`;
      else activityText = `Hace ${Math.round(diffSec / 60)}m`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-3 fw-semibold text-light">
        ${escapeHtml(s.sourceReport || "Formato sin nombre")}
      
<!-- <div class="small text-secondary font-monospace">${escapeHtml(s.containerName || s.sessionId)}</div> -->
      </td>
      <td>${userBadge}</td>
      <td>${statusBadge}</td>
      <td class="text-secondary small">${activityText}</td>
      <td class="pe-3 text-end text-nowrap">
        <button class="btn btn-primary btn-sm me-1 btn-action-session-resume" data-id="${escapeHtml(s.sessionId)}" data-name="${escapeHtml(s.sourceReport || "")}" type="button">
          Reanudar
        </button>
        <button class="btn btn-outline-success btn-sm me-1 btn-action-session-pdf" data-id="${escapeHtml(s.sessionId)}" data-name="${escapeHtml(s.sourceReport || "")}" type="button">
          PDF
        </button>
        <button class="btn btn-outline-danger btn-sm btn-action-session-stop" data-id="${escapeHtml(s.sessionId)}" data-name="${escapeHtml(s.sourceReport || "")}" type="button">
          Terminar
        </button>
      </td>
    `;
    sessionsTableBody.appendChild(tr);
  });

  // Attach button events
  sessionsTableBody.querySelectorAll('.btn-action-session-resume').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sid = btn.getAttribute('data-id');
      btn.disabled = true;
      try {
        const res = await apiFetch(`/api/session/resume/${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (data.success && data.resumed) {
          attachToSession(data, true);
        } else {
          throw new Error(data.error || 'No se pudo reanudar la sesión.');
        }
      } catch (err) {
        alert('Error al reanudar sesión: ' + err.message);
        loadActiveSessions();
      } finally {
        btn.disabled = false;
      }
    });
  });

  sessionsTableBody.querySelectorAll('.btn-action-session-pdf').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sid = btn.getAttribute('data-id');
      const rName = btn.getAttribute('data-name') || 'reporte';
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>PDF...`;
      showToast(`Generando PDF con datos mock de la sesión...`);

      try {
        const res = await apiFetch(`/api/session/${encodeURIComponent(sid)}/generate-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ useMockData: true, mockRowCount: 25 })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || errData.error || 'Error al generar PDF');
        }

        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${rName}_preview.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        showToast('PDF generado exitosamente.');
      } catch (err) {
        alert('Error al generar PDF: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    });
  });

  sessionsTableBody.querySelectorAll('.btn-action-session-stop').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sid = btn.getAttribute('data-id');
      const rName = btn.getAttribute('data-name') || 'esta sesión';
      if (!confirm(`¿Deseas terminar y destruir el contenedor de "${rName}"?`)) return;

      btn.disabled = true;
      try {
        await apiFetch('/api/session/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, save: false })
        });
        showToast('Sesión finalizada.');
        loadActiveSessions();
      } catch (err) {
        alert('Error al finalizar sesión: ' + err.message);
      }
    });
  });
}

// ==============================================================================
// REPORTS CRUD & TABLE RENDERING
// ==============================================================================

async function loadReports() {
  try {
    reportsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-secondary">Cargando formatos...</td>
      </tr>
    `;

    const res = await apiFetch('/api/reports');
    const data = await res.json();
    cachedReports = data.reports || [];

    renderReportsTable(cachedReports);
    populateExistingFormatsSelect(cachedReports);
  } catch (err) {
    console.error('Error al cargar reportes:', err);
    reportsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-danger">Error al cargar formatos: ${err.message}</td>
      </tr>
    `;
  }
}

function renderReportsTable(reports) {
  if (!reports || reports.length === 0) {
    reportsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-secondary">
          No hay formatos registrados. Haz clic en "Nuevo Formato" para comenzar.
        </td>
      </tr>
    `;
    return;
  }

  reportsTableBody.innerHTML = '';
  reports.forEach((rep) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-3 fw-semibold text-light">${escapeHtml(rep.name)}</td>
      <td class="text-secondary font-monospace small">${escapeHtml(rep.filename)}</td>
      <td class="text-secondary small">${rep.sizeKb} KB</td>
      <td class="text-secondary small">${rep.modifiedAt || 'Desconocido'}</td>
      <td class="pe-3 text-end text-nowrap">
        <button class="btn btn-primary btn-sm me-1 btn-action-edit-format" data-filename="${escapeHtml(rep.filename)}" data-name="${escapeHtml(rep.name)}" type="button">
          Editar Formato
        </button>
        <button class="btn btn-outline-success btn-sm me-1 btn-action-mock-pdf" data-id="${rep.id}" data-name="${escapeHtml(rep.name)}" type="button" title="Generar PDF de prueba con datos simulados">
          PDF
        </button>
        <button class="btn btn-outline-info btn-sm me-1 btn-action-history" data-filename="${escapeHtml(rep.filename)}" data-name="${escapeHtml(rep.name)}" type="button" title="Historial de versiones">
          <i class="bi bi-clock-history"></i>
        </button>
        <button class="btn btn-outline-secondary btn-sm me-1 btn-action-edit-record" data-id="${rep.id}" type="button" title="Editar registro">
          <i class="bi bi-pencil-square"></i>
        </button>
        <button class="btn btn-outline-danger btn-sm btn-action-delete" data-id="${rep.id}" data-name="${escapeHtml(rep.name)}" type="button" title="Eliminar formato">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    `;
    reportsTableBody.appendChild(tr);
  });

  // Attach row button events
  document.querySelectorAll('.btn-action-edit-format').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filename = btn.getAttribute('data-filename');
      const name = btn.getAttribute('data-name');
      requestOpenExistingFormat(filename, name);
    });
  });

  document.querySelectorAll('.btn-action-mock-pdf').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      btn.disabled = true;
      showToast(`Generando PDF con datos mock para "${name}"...`);

      try {
        const res = await apiFetch(`/api/reports/${encodeURIComponent(id)}/generate-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ useMockData: true, mockRowCount: 25 })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || errData.error || 'Error al generar PDF');
        }

        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${name}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        showToast(`PDF generado exitosamente.`);
      } catch (err) {
        alert('Error al generar PDF con FastReport: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.btn-action-history').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filename = btn.getAttribute('data-filename');
      const name = btn.getAttribute('data-name');
      openHistoryModal(filename, name);
    });
  });

  document.querySelectorAll('.btn-action-edit-record').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openEditRecordModal(id);
    });
  });

  document.querySelectorAll('.btn-action-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      openDeleteModal(id, name);
    });
  });
}

function populateExistingFormatsSelect(reports) {
  selectExistingFormat.innerHTML = '<option value="">Selecciona un formato base...</option>';
  reports.forEach((rep) => {
    const opt = document.createElement('option');
    opt.value = rep.filename;
    opt.textContent = `${rep.name} (${rep.filename})`;
    selectExistingFormat.appendChild(opt);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

// ==============================================================================
// MODAL: NUEVO FORMATO
// ==============================================================================

btnNewFormat.addEventListener('click', () => {
  newFormatNameInput.value = '';
  optBlank.checked = true;
  existingFormatContainer.classList.add('d-none');
  uploadFormatContainer.classList.add('d-none');
  fileUploadFormat.value = '';
  modalNewFormat.show();
});

// Radio option toggles
function updateNewFormatRadioVisibility() {
  if (optExisting.checked) {
    existingFormatContainer.classList.remove('d-none');
    uploadFormatContainer.classList.add('d-none');
  } else if (optUpload.checked) {
    uploadFormatContainer.classList.remove('d-none');
    existingFormatContainer.classList.add('d-none');
  } else {
    existingFormatContainer.classList.add('d-none');
    uploadFormatContainer.classList.add('d-none');
  }
}

optBlank.addEventListener('change', updateNewFormatRadioVisibility);
optExisting.addEventListener('change', updateNewFormatRadioVisibility);
optUpload.addEventListener('change', updateNewFormatRadioVisibility);

// Auto-fill format name when selecting an existing format or uploading a file
selectExistingFormat.addEventListener('change', () => {
  if (selectExistingFormat.value && !newFormatNameInput.value.trim()) {
    const selected = cachedReports.find((r) => r.filename === selectExistingFormat.value);
    if (selected) {
      newFormatNameInput.value = `${selected.name} (Copia)`;
    }
  }
});

fileUploadFormat.addEventListener('change', () => {
  const file = fileUploadFormat.files[0];
  if (file && !newFormatNameInput.value.trim()) {
    newFormatNameInput.value = file.name.replace(/\.frx$/i, '');
  }
});

btnConfirmNewFormat.addEventListener('click', async () => {
  const name = newFormatNameInput.value.trim() || 'Nuevo Formato';

  if (optExisting.checked && !selectExistingFormat.value) {
    alert('Por favor selecciona un formato base existente de la lista.');
    return;
  }

  if (optUpload.checked && (!fileUploadFormat.files || fileUploadFormat.files.length === 0)) {
    alert('Por favor selecciona un archivo .frx desde tu computadora.');
    return;
  }

  modalNewFormat.hide();

  if (optUpload.checked) {
    const file = fileUploadFormat.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      startSession({
        startType: 'upload',
        reportName: name,
        uploadedContent: content
      });
    };
    reader.readAsText(file);
  } else if (optExisting.checked) {
    requestOpenExistingFormat(selectExistingFormat.value, name);
  } else {
    startSession({
      startType: 'blank',
      reportName: name
    });
  }
});

// ==============================================================================
// MODAL: EDITAR REGISTRO
// ==============================================================================

function openEditRecordModal(id) {
  const item = cachedReports.find((r) => r.id === id);
  if (!item) return;

  editRecordIdInput.value = item.id;
  editRecordNameInput.value = item.name;
  editRecordFilenameSpan.textContent = item.filename;
  editRecordDateSpan.textContent = item.modifiedAt || 'Desconocido';

  modalEditRecord.show();
}

btnSaveRecordChanges.addEventListener('click', async () => {
  const id = editRecordIdInput.value;
  const newName = editRecordNameInput.value.trim();
  if (!newName) {
    alert('El nombre del formato no puede estar vacío.');
    return;
  }

  btnSaveRecordChanges.disabled = true;
  try {
    const res = await apiFetch('/api/reports/rename', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, newName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar registro');

    modalEditRecord.hide();
    showToast(`Registro actualizado a "${newName}".`);
    loadReports();
  } catch (err) {
    alert(err.message);
  } finally {
    btnSaveRecordChanges.disabled = false;
  }
});

// ==============================================================================
// MODAL: ELIMINAR REGISTRO
// ==============================================================================

function openDeleteModal(id, name) {
  deleteRecordIdInput.value = id;
  deleteRecordNameSpan.textContent = name;
  modalDeleteRecord.show();
}

btnConfirmDeleteAction.addEventListener('click', async () => {
  const id = deleteRecordIdInput.value;
  btnConfirmDeleteAction.disabled = true;

  try {
    const res = await apiFetch(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');

    modalDeleteRecord.hide();
    showToast(data.message || 'Registro eliminado de la lista (archivo conservado en servidor).');
    loadReports();
  } catch (err) {
    alert(err.message);
  } finally {
    btnConfirmDeleteAction.disabled = false;
  }
});

// ==============================================================================
// MODAL: HISTORIAL DE MODIFICACIONES (VERSIONADO)
// ==============================================================================

async function openHistoryModal(filename, name) {
  if (!modalHistory) return;

  historyModalSubtitle.textContent = `Formato: ${name} (${filename})`;
  historyItemsContainer.innerHTML = '<div class="text-center py-4 text-secondary small">Cargando historial de cambios...</div>';
  modalHistory.show();

  try {
    const res = await apiFetch(`/api/history?filename=${encodeURIComponent(filename)}&reportName=${encodeURIComponent(name || '')}`);
    if (!res.ok) throw new Error('Error al consultar historial');
    const data = await res.json();
    const historyList = data.history || [];

    if (historyList.length === 0) {
      historyItemsContainer.innerHTML = `
        <div class="text-center py-4 text-secondary small">
          No hay versiones históricas registradas para este formato todavía.
          <div class="mt-2 text-muted">Cada vez que guardes cambios al cerrar el editor, se generará una versión aquí.</div>
        </div>
      `;
      return;
    }

    historyItemsContainer.innerHTML = '';
    historyList.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card bg-secondary-subtle border-secondary p-3';
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="badge bg-info text-dark font-monospace fw-bold">v${item.version}</span>
              <h6 class="mb-0 fw-bold text-light">${escapeHtml(item.reportName)}</h6>
            </div>
            <div class="small text-secondary font-monospace">
              Autor: <strong class="text-info-emphasis">${escapeHtml(item.userToken || 'Desconocido')}</strong> • ${escapeHtml(item.date)} • ${item.sizeKb} KB
            </div>
          </div>
          <span class="badge bg-secondary font-monospace small">${escapeHtml(item.filename || item.snapshotFilename)}</span>
        </div>
        ${item.comment ? `<div class="bg-dark bg-opacity-50 p-2 rounded small text-light mb-2 border border-secondary border-opacity-25 fst-italic">💬 "${escapeHtml(item.comment)}"</div>` : ''}
        <div class="d-flex justify-content-end gap-2 mt-2">
          <a href="/api/history/${encodeURIComponent(item.id)}/download" class="btn btn-outline-light btn-sm" download>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-download me-1" viewBox="0 0 16 16">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/>
            </svg>
            Descargar
          </a>
          <button type="button" class="btn btn-outline-warning btn-sm btn-restore-history" data-id="${item.id}" data-version="${item.version}">
            Restaurar como actual
          </button>
          <button type="button" class="btn btn-primary btn-sm btn-open-history-editor" data-snapshot="${escapeHtml(item.filename || item.snapshotFilename)}" data-name="${escapeHtml(item.reportName)}" data-original="${escapeHtml(item.originalFilename || filename)}">
            Abrir en Editor
          </button>
        </div>
      `;
      historyItemsContainer.appendChild(card);
    });

    // Attach listeners for history cards
    historyItemsContainer.querySelectorAll('.btn-restore-history').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        const ver = btn.getAttribute('data-version');
        if (!confirm(`¿Confirmas restaurar la versión v${ver} como el formato principal de "${name}"?`)) return;

        btn.disabled = true;
        try {
          const rRes = await apiFetch(`/api/history/${encodeURIComponent(id)}/restore`, {
            method: 'POST'
          });
          const rData = await rRes.json();
          if (!rRes.ok) throw new Error(rData.error || 'Error al restaurar versión');

          showToast(`Formato restaurado con éxito a la versión v${ver}.`);
          loadReports();
          openHistoryModal(filename, name);
        } catch (err) {
          alert('Error al restaurar: ' + err.message);
          btn.disabled = false;
        }
      });
    });

    historyItemsContainer.querySelectorAll('.btn-open-history-editor').forEach((btn) => {
      btn.addEventListener('click', () => {
        const snapshot = btn.getAttribute('data-snapshot');
        const rName = btn.getAttribute('data-name');
        const origFile = btn.getAttribute('data-original');
        modalHistory.hide();
        startSession({
          startType: 'history',
          sourceFilename: snapshot,
          reportName: rName,
          originalFilename: origFile
        });
      });
    });

  } catch (err) {
    historyItemsContainer.innerHTML = `<div class="text-center py-4 text-danger small">Error al cargar historial: ${err.message}</div>`;
  }
}

// ==============================================================================
// VERIFICACIÓN Y ALERTA DE SESIÓN PREVIA / CAMBIOS PENDIENTES
// ==============================================================================

async function requestOpenExistingFormat(filename, name) {
  try {
    const res = await apiFetch(`/api/session/check-pending?filename=${encodeURIComponent(filename)}&reportName=${encodeURIComponent(name || '')}`);
    if (res.ok) {
      const data = await res.json();
      if (data.hasPending) {
        openPendingRecoveryModal(data, filename, name);
        return;
      }
      if (data.concurrentNotice) {
        showToast(`Nota: El usuario "${data.otherUser}" también está editando este reporte en su propia sesión aislada.`);
      }
    }
  } catch (err) {
    console.warn('[PENDING CHECK] Warning checking pending changes:', err);
  }

  // Si no hay cambios pendientes, abrimos el formato oficial
  startSession({
    startType: 'existing',
    sourceFilename: filename,
    reportName: name
  });
}

function openPendingRecoveryModal(pendingData, originalFilename, originalName) {
  if (!modalPendingRecovery) return;

  const targetReportName = originalName || pendingData.reportName || originalFilename.replace(/\.frx$/i, '');
  pendingReportName.textContent = targetReportName;

  if (pendingData.pendingType === 'session') {
    pendingBadgeStatus.textContent = `Sesión activa (${pendingData.sessionStatus})`;
    pendingBadgeStatus.className = 'badge bg-warning text-dark px-2 py-1';
    pendingReportDetails.textContent = `Última actividad: ${pendingData.date} • Contenedor en segundo plano`;
  } else {
    pendingBadgeStatus.textContent = 'Auto-guardado pendiente';
    pendingBadgeStatus.className = 'badge bg-danger text-light px-2 py-1';
    pendingReportDetails.textContent = `Fecha de rescate: ${pendingData.date} • Tamaño: ${pendingData.sizeKb || '2.6'} KB`;
  }

  // 1. Botón: Seguir editando esta versión
  btnPendingContinueEdit.onclick = async () => {
    modalPendingRecovery.hide();
    if (pendingData.pendingType === 'session') {
      try {
        const resumeRes = await apiFetch(`/api/session/resume/${encodeURIComponent(pendingData.sessionId)}`);
        const resumeData = await resumeRes.json();
        if (resumeData.success && resumeData.resumed) {
          attachToSession(resumeData, true);
          return;
        }
      } catch (_) {}
    }
    // Si era recuperación o expiró resume, abrir la versión recuperada en RAM
    startSession({
      startType: 'recovery',
      sourceFilename: pendingData.recoveryFilename || originalFilename,
      reportName: targetReportName
    });
  };

  // 2. Botón: Descargar cambios pendientes y abrir original nuevo
  btnPendingDownloadAndOpen.onclick = () => {
    modalPendingRecovery.hide();
    showToast('Descargando versión pendiente y abriendo formato original...');

    const downloadUrl = pendingData.pendingType === 'session'
      ? `/api/session/${encodeURIComponent(pendingData.sessionId)}/download-ram`
      : `/api/recovery/${encodeURIComponent(pendingData.recoveryId)}/download`;

    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `${targetReportName}_pendiente.frx`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    // Abrir versión original limpia
    setTimeout(() => {
      startSession({
        startType: 'existing',
        sourceFilename: originalFilename,
        reportName: targetReportName
      });
    }, 500);
  };

  // 3. Botón: Abrir versión original guardada (sin descartar los pendientes)
  btnPendingOpenClean.onclick = () => {
    modalPendingRecovery.hide();
    showToast('Abriendo versión original oficial (cambios pendientes conservados)...');
    startSession({
      startType: 'existing',
      sourceFilename: originalFilename,
      reportName: targetReportName
    });
  };

  // 4. Botón: Descartar permanentemente pendientes y abrir original
  btnPendingDiscardAndOpen.onclick = async () => {
    if (!confirm(`¿Estás seguro de descartar permanentemente los cambios pendientes de "${targetReportName}"?`)) {
      return;
    }
    modalPendingRecovery.hide();

    try {
      if (pendingData.pendingType === 'session') {
        await apiFetch('/api/session/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: pendingData.sessionId, save: false })
        });
      } else if (pendingData.pendingType === 'recovery') {
        await apiFetch(`/api/recovery/${encodeURIComponent(pendingData.recoveryId)}`, {
          method: 'DELETE'
        });
      }
      loadRecoveredDocuments();
    } catch (_) {}

    startSession({
      startType: 'existing',
      sourceFilename: originalFilename,
      reportName: targetReportName
    });
  };

  modalPendingRecovery.show();
}

// ==============================================================================
// SESSION LIFECYCLE & NO-VNC STREAMING
// ==============================================================================

function attachToSession(sessionData, isResumed = false) {
  currentSession = sessionData;
  sessionStorage.setItem('active_session_id', currentSession.sessionId);
  console.log('[SESSION] Attached to session:', currentSession);

  // Sync tab URL query params for multi-tab navigation
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('session', currentSession.sessionId);
  currentUrl.searchParams.set('token', getAuthToken());
  window.history.replaceState({}, '', currentUrl.toString());

  // Switch UI from Lobby to Streaming View
  lobbyView.classList.add('d-none');
  lobbyAuth.classList.add('d-none');
  streamView.classList.remove('d-none');
  sessionControls.classList.remove('d-none');

  sessionReportPill.textContent = `Formato: ${currentSession.reportName}`;

  // Allow DOM to layout streamView before initializing RFB
  requestAnimationFrame(() => {
    initNoVnc(currentSession.vncPort);
    if (currentSession.eventsUrl) {
      initSseStream(currentSession.eventsUrl);
    }
  });

  // Start heartbeat (every 12s to keep container active)
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(sendHeartbeat, 12000);

  if (isResumed) {
    showToast(`Sesión previa reanudada: "${currentSession.reportName}".`);
  }
}

async function startSession(options) {
  // updateStatus('connecting', 'Iniciando...');
  showToast('Iniciando contenedor efímero...');

  try {
    const res = await apiFetch('/api/session/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    attachToSession(data, false);
  } catch (err) {
    console.error('Error al iniciar sesión:', err);
    alert('Error al iniciar el diseñador: ' + err.message);
    // updateStatus('disconnected', 'Sin Sesión');
  }
}

function initNoVnc(port, attempt = 1) {
  if (vncRetryTimer) clearTimeout(vncRetryTimer);
  isVncConnected = false;
  streamLoading.classList.remove('d-none');
  loadingDetails.textContent = attempt === 1
    ? `Conectando con WebSocket VNC...`
    : `Estableciendo enlace de video con FastReport (intento ${attempt}/5)...`;

  vncContainer.innerHTML = '';
  vncContainer.appendChild(streamLoading);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const vncWsUrl = `${protocol}//${window.location.host}/stream/${currentSession.sessionId}/websockify`;

  console.log(`[noVNC] Connecting to ${vncWsUrl} (intento ${attempt})...`);

  try {
    rfbClient = new RFB(vncContainer, vncWsUrl, {
      shared: true,
      credentials: { password: '' }
    });

    rfbClient.scaleViewport = true;
    rfbClient.resizeSession = false;
    rfbClient.clipViewport = false;

    rfbClient.addEventListener('connect', () => {
      console.log('[noVNC] Connected to FastReport display!');
      isVncConnected = true;
      // updateStatus('connected', 'En Sesión (En Vivo)');
      streamLoading.classList.add('d-none');

      // Eliminate black screen: force canvas layout recalculation and redraw
      const forceRefresh = () => {
        if (!rfbClient) return;
        window.dispatchEvent(new Event('resize'));
        try {
          rfbClient.scaleViewport = false;
          rfbClient.scaleViewport = true;
          rfbClient.focus();
        } catch (_) {}
      };

      requestAnimationFrame(forceRefresh);
      setTimeout(forceRefresh, 100);
      setTimeout(forceRefresh, 300);
      setTimeout(forceRefresh, 700);
    });

    rfbClient.addEventListener('disconnect', (e) => {
      console.log('[noVNC] Disconnected:', e.detail.clean ? 'Clean' : 'Abrupt');
      if (!isVncConnected && attempt < 5 && currentSession) {
        console.warn(`[noVNC] Initial connection not ready yet. Retrying in 6s (${attempt}/5)...`);
        loadingDetails.textContent = `Iniciando entorno virtual de diseño (${attempt}/5)...`;
        vncRetryTimer = setTimeout(() => {
          if (currentSession && !isVncConnected) {
            initNoVnc(port, attempt + 1);
          }
        }, 6000);
        return;
      }
      if (currentSession && isVncConnected) {
        // updateStatus('disconnected', 'Desconectado');
      }
    });

    rfbClient.addEventListener('securityfailure', (e) => {
      console.error('[noVNC] Security failure:', e);
      loadingDetails.textContent = 'Fallo de autenticación en VNC';
    });

  } catch (err) {
    console.error('[noVNC] Initialization error:', err);
    loadingDetails.textContent = 'Error al conectar RFB: ' + err.message;
  }
}

function initSseStream(eventsUrl) {
  if (!eventsUrl) return;
  if (sseSource) {
    sseSource.close();
  }

  console.log(`[SSE] Subscribing to container bridge events at ${eventsUrl}...`);
  try {
    sseSource = new EventSource(eventsUrl);
  } catch (_) {
    return;
  }

  sseSource.addEventListener('connected', (e) => {
    console.log('[SSE] Handshake established with bridge server:', e.data);
  });

  sseSource.addEventListener('open_url', (e) => {
    try {
      const payload = JSON.parse(e.data);
      const url = payload.url;
      console.warn('[URL INTERCEPTOR] Web link intercepted from Wine:', url);

      showToast(`Enlace web interceptado: ${url} (abierto en tu navegador)`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[SSE] Error handling open_url:', err);
    }
  });

  sseSource.onerror = (err) => {
    console.warn('[SSE] EventSource reconnecting or error:', err);
  };
}

async function sendHeartbeat() {
  if (!currentSession) return;
  try {
    await apiFetch('/api/session/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSession.sessionId })
    });
  } catch (_) {}
}

// ==============================================================================
// IN-SESSION ACTIONS & CLOSE MODAL
// ==============================================================================

// In-Session Load Format workflow
btnLoadFormatSession.addEventListener('click', () => {
  if (!currentSession) return;

  // Populate existing formats select
  selectSessionExistingFormat.innerHTML = '<option value="">Selecciona un formato guardado...</option>';
  cachedReports.forEach((rep) => {
    const opt = document.createElement('option');
    opt.value = rep.filename;
    opt.textContent = `${rep.name} (${rep.filename})`;
    selectSessionExistingFormat.appendChild(opt);
  });

  // Default to upload
  optSessionUpload.checked = true;
  sessionUploadContainer.classList.remove('d-none');
  sessionExistingContainer.classList.add('d-none');
  sessionFileUploadInput.value = '';

  modalSessionLoadFormat.show();
});

optSessionUpload.addEventListener('change', () => {
  if (optSessionUpload.checked) {
    sessionUploadContainer.classList.remove('d-none');
    sessionExistingContainer.classList.add('d-none');
  }
});

optSessionExisting.addEventListener('change', () => {
  if (optSessionExisting.checked) {
    sessionExistingContainer.classList.remove('d-none');
    sessionUploadContainer.classList.add('d-none');
  }
});

btnConfirmSessionLoadFormat.addEventListener('click', async () => {
  if (!currentSession) return;

  btnConfirmSessionLoadFormat.disabled = true;
  const isUpload = optSessionUpload.checked;

  try {
    let payload = {
      sessionId: currentSession.sessionId,
      formatType: isUpload ? 'upload' : 'existing'
    };

    if (isUpload) {
      const file = sessionFileUploadInput.files[0];
      if (!file) throw new Error('Por favor selecciona un archivo .frx desde tu computadora.');
      if (!file.name.toLowerCase().endsWith('.frx')) throw new Error('El archivo debe tener extensión .frx');

      const content = await file.text();
      payload.uploadedContent = content;
      payload.reportName = file.name.replace(/\.frx$/i, '');
    } else {
      const selected = selectSessionExistingFormat.value;
      if (!selected) throw new Error('Por favor selecciona un formato de la lista.');
      payload.sourceFilename = selected;
      const found = cachedReports.find((r) => r.filename === selected);
      payload.reportName = found ? found.name : selected.replace(/\.frx$/i, '');
    }

    showToast('Cargando nuevo formato en el diseñador...');
    modalSessionLoadFormat.hide();

    // Store parameters for immediate seamless restart
    const oldSessionId = currentSession.sessionId;
    let nextStartOptions = {};

    if (isUpload) {
      nextStartOptions = {
        startType: 'upload',
        uploadedContent: payload.uploadedContent,
        reportName: payload.reportName
      };
    } else {
      nextStartOptions = {
        startType: 'existing',
        sourceFilename: payload.sourceFilename,
        reportName: payload.reportName
      };
    }

    // Disconnect stream & clean up previous session in the background
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (sseSource) sseSource.close();
    if (rfbClient) {
      try { rfbClient.disconnect(); } catch (_) {}
    }

    // Stop old container and wait for its ports to be released
    try {
      await apiFetch('/api/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId, save: false })
      });
    } catch (e) {
      console.warn('Old container cleanup:', e);
    }

    currentSession = null;

    // Start fresh container with the selected format immediately without leaving the stream view
    await startSession(nextStartOptions);
    showToast(`Formato "${nextStartOptions.reportName}" abierto en el diseñador.`);

  } catch (err) {
    alert(err.message);
  } finally {
    btnConfirmSessionLoadFormat.disabled = false;
  }
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    vncContainer.requestFullscreen().catch((err) => console.warn(err));
  } else {
    document.exitFullscreen().catch((err) => console.warn(err));
  }
});

// ==============================================================================
// SEAMLESS UNIDIRECTIONAL CLIPBOARD (HOST BROWSER -> VNC DESIGNER)
// ==============================================================================

const clipboardTrap = document.getElementById('clipboard-trap');
let lastSyncedClipboardText = null;

console.log('[CLIPBOARD] System initialized. isSecureContext:', window.isSecureContext, 'hasAsyncClipboard:', !!(navigator.clipboard && navigator.clipboard.readText));

function executeVncPaste(text, source) {
  if (!rfbClient || !isVncConnected) {
    console.warn('[CLIPBOARD] Paste ignored: VNC not connected');
    return;
  }
  if (!text) {
    console.warn('[CLIPBOARD] Paste ignored: empty text');
    return;
  }

  console.log(`[CLIPBOARD] Sending ${text.length} characters to VNC (source: ${source})...`);
  lastSyncedClipboardText = text;

  // 1. Put text into remote X11 selection via x11vnc ClientCutText
  rfbClient.clipboardPasteFrom(text);

  // 2. Refocus VNC canvas so keypress lands on the active Wine control
  if (rfbClient.focus) {
    rfbClient.focus();
  }

  // 3. Send Ctrl+V keystrokes to Wine after small delay to let x11vnc apply the selection
  setTimeout(() => {
    try {
      // Keysyms: Control_L = 0xffe3, 'v' = 0x0076
      rfbClient.sendKey(0xffe3, 'ControlLeft', true);
      rfbClient.sendKey(0x0076, 'KeyV', true);
      rfbClient.sendKey(0x0076, 'KeyV', false);
      rfbClient.sendKey(0xffe3, 'ControlLeft', false);
      console.log('[CLIPBOARD] Sent Ctrl+V keystroke to Wine');
    } catch (err) {
      console.warn('[CLIPBOARD] Error dispatching Ctrl+V key to Wine:', err);
    }
  }, 75);
}

async function syncHostClipboardToVnc(force = false) {
  if (!rfbClient || !isVncConnected) return;
  if (!navigator.clipboard || !navigator.clipboard.readText) return;

  try {
    const text = await navigator.clipboard.readText();
    if (text && (force || text !== lastSyncedClipboardText)) {
      lastSyncedClipboardText = text;
      rfbClient.clipboardPasteFrom(text);
      console.log('[CLIPBOARD] Background sync to VNC:', text.length, 'characters');
    }
  } catch (err) {
    // Permission prompt dismissed or tab not focused; ignore silently in background sync
  }
}

// 1. Background sync on window focus or mouse hover/click (for Wine right-click -> Paste when in Secure Context)
window.addEventListener('focus', () => syncHostClipboardToVnc());

if (vncContainer) {
  vncContainer.addEventListener('pointerenter', () => syncHostClipboardToVnc());
  vncContainer.addEventListener('contextmenu', () => syncHostClipboardToVnc(true));
  vncContainer.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      syncHostClipboardToVnc(true);
    }
  });
}

// 2. Clipboard trap paste listener (for non-HTTPS / Insecure contexts like testinglab.local)
if (clipboardTrap) {
  clipboardTrap.addEventListener('paste', (e) => {
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : clipboardTrap.value;
    console.log('[CLIPBOARD] Captured paste event on trap:', (text || '').length, 'characters');
    if (text) {
      executeVncPaste(text, 'ClipboardTrap');
    }
    clipboardTrap.value = '';
  });
}

// 3. Native Ctrl+V / Cmd+V in capture phase
window.addEventListener('keydown', async (e) => {
  if (!rfbClient || !isVncConnected) return;

  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (activeTag === 'input' || (activeTag === 'textarea' && document.activeElement !== clipboardTrap)) {
    return; // Allow typing in regular UI modals
  }

  const isPaste = (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV');
  if (!isPaste) return;

  console.log('[CLIPBOARD] Ctrl+V detected on canvas. Processing paste...');

  // Pathway A: If Async Clipboard API is available (HTTPS or localhost)
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        executeVncPaste(text, 'AsyncClipboard');
        return;
      }
    } catch (err) {
      console.warn('[CLIPBOARD] Async Clipboard readText failed:', err.message);
    }
  }

  // Pathway B: Fallback via hidden clipboard trap for HTTP / insecure origins (testinglab.local)
  if (clipboardTrap) {
    console.log('[CLIPBOARD] Routing Ctrl+V through clipboard trap element...');
    clipboardTrap.value = '';
    clipboardTrap.focus();
    // Do NOT prevent default so the browser executes its native paste into clipboardTrap
  }
}, true);

// btnTestUrl.addEventListener('click', async () => {
//   if (!currentSession) return;
//   const testUrl = 'https://fast-report.com/en/';
//   try {
//     const res = await fetch(`${currentSession.bridgeUrl}/api/test-url`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ url: testUrl })
//     });
//     console.log('[TEST URL] Dispatched test URL:', await res.json());
//   } catch (err) {
//     console.error('Error sending test URL:', err);
//   }
// });

btnDownloadFrx.addEventListener('click', async () => {
  if (!currentSession) return;
  try {
    const res = await apiFetch(`/api/session/${encodeURIComponent(currentSession.sessionId)}/download-ram`);
    if (!res.ok) throw new Error('Error al descargar el archivo desde memoria');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const downloadName = (currentSession.reportName || 'reporte') + '.frx';
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch (err) {
    alert('Error al descargar: ' + err.message);
  }
});

if (btnSessionMockPdf) {
  btnSessionMockPdf.addEventListener('click', async () => {
    if (!currentSession) return;
    const origText = btnSessionMockPdf.innerHTML;
    btnSessionMockPdf.disabled = true;
    btnSessionMockPdf.innerHTML = `
      <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
      PDF...
    `;
    showToast(`Guardando lienzo y generando PDF de prueba...`);

    try {
      const res = await apiFetch(`/api/session/${encodeURIComponent(currentSession.sessionId)}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useMockData: true, mockRowCount: 25 })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || 'Error al generar PDF de la sesión');
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const downloadName = (currentSession.reportName || 'reporte_sesion') + '_preview.pdf';
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      showToast(`PDF de la sesión generado exitosamente.`);
    } catch (err) {
      alert('Error al generar PDF de la sesión con FastReport: ' + err.message);
    } finally {
      btnSessionMockPdf.disabled = false;
      btnSessionMockPdf.innerHTML = origText;
    }
  });
}

// Close Editor workflow
btnCloseEditor.addEventListener('click', () => {
  if (!currentSession) return;
  closeSaveReportNameInput.value = currentSession.reportName || 'Nuevo Formato';
  modalCloseEditor.show();
});

btnConfirmSaveClose.addEventListener('click', () => {
  const saveName = closeSaveReportNameInput.value.trim() || currentSession.reportName || 'Reporte';
  finalizeSession(true, saveName);
});

btnConfirmDiscardClose.addEventListener('click', () => {
  finalizeSession(false);
});

async function finalizeSession(saveReport, reportName = '') {
  if (!currentSession) return;
  modalCloseEditor.hide();

  const sessionId = currentSession.sessionId;
  const comment = closeSaveReportCommentInput ? closeSaveReportCommentInput.value.trim() : '';
  showToast(saveReport ? 'Guardando reporte y destruyendo contenedor...' : 'Finalizando sesión...');

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (sseSource) sseSource.close();
  if (rfbClient) {
    try { rfbClient.disconnect(); } catch (_) {}
  }

  try {
    const res = await apiFetch('/api/session/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        save: saveReport,
        reportName,
        comment
      })
    });
    const data = await res.json();
    console.log('[SESSION] Container stopped:', data);

    if (saveReport) {
      showToast(`Reporte guardado exitosamente como "${data.savedReportName}".`);
    } else {
      showToast('Sesión finalizada. Los cambios no guardados fueron descartados.');
    }
  } catch (err) {
    console.error('Error stopping session:', err);
  } finally {
    sessionStorage.removeItem('active_session_id');
    localStorage.removeItem('active_session_id');
    if (closeSaveReportCommentInput) closeSaveReportCommentInput.value = '';

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('session');
    window.history.replaceState({}, '', currentUrl.toString());

    currentSession = null;
    streamView.classList.add('d-none');
    sessionControls.classList.add('d-none');
    lobbyView.classList.remove('d-none');
    lobbyAuth.classList.remove('d-none');
    // updateStatus('disconnected', 'Sin Sesión');

    loadReports();
    loadRecoveredDocuments();
    loadActiveSessions();
  }
}

// ==============================================================================
// OFFCANVAS: DOCUMENTOS RECUPERADOS (STANDBY / AMNESIA)
// ==============================================================================

async function loadRecoveredDocuments() {
  try {
    const res = await apiFetch('/api/recovery');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.recovered || [];

    if (badgeRecoveryCount) {
      if (items.length > 0) {
        btnRecoveryPanel.classList.remove("d-none");
        badgeRecoveryCount.textContent = items.length;
        badgeRecoveryCount.classList.remove('d-none');
      } else {
        badgeRecoveryCount.classList.add('d-none');
        btnRecoveryPanel.classList.add("d-none");
      }
    }

    if (!recoveryItemsContainer) return;

    if (items.length === 0) {
      recoveryItemsContainer.innerHTML = `
        <div class="text-center py-4 text-secondary small">
          No hay documentos sin guardar pendientes de recuperación.
        </div>`;
      return;
    }

    recoveryItemsContainer.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card bg-secondary-subtle border-secondary p-3';
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <h6 class="mb-1 fw-bold text-light">${escapeHtml(item.name)}</h6>
            <div class="small text-secondary font-monospace">
              ${escapeHtml(item.date || '')} • ${item.sizeKb} KB
            </div>
          </div>
          <span class="badge bg-warning text-dark">Auto-guardado</span>
        </div>
        <div class="d-flex justify-content-end gap-2 mt-2">
          <button class="btn btn-outline-danger btn-sm btn-discard-recovery" data-id="${item.id}">Descartar</button>
          <button class="btn btn-primary btn-sm btn-restore-recovery" data-filename="${item.filename}" data-name="${escapeHtml(item.name)}">Restaurar en Editor</button>
        </div>
      `;
      recoveryItemsContainer.appendChild(card);
    });

    // Attach row button events
    recoveryItemsContainer.querySelectorAll('.btn-discard-recovery').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        btn.disabled = true;
        try {
          const delRes = await apiFetch(`/api/recovery/${encodeURIComponent(id)}`, {
            method: 'DELETE'
          });
          const delData = await delRes.json();
          if (!delRes.ok) throw new Error(delData.error || 'Error al descartar');
          showToast(delData.message || 'Documento descartado.');
          loadRecoveredDocuments();
        } catch (err) {
          alert('Error al descartar documento: ' + err.message);
          btn.disabled = false;
        }
      });
    });

    recoveryItemsContainer.querySelectorAll('.btn-restore-recovery').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const filename = e.target.getAttribute('data-filename');
        const name = e.target.getAttribute('data-name');
        if (offcanvasRecovery) {
          offcanvasRecovery.hide();
        }
        startSession({
          startType: 'recovery',
          sourceFilename: filename,
          reportName: name
        });
      });
    });
  } catch (err) {
    console.error('Error loading recovered documents:', err);
  }
}

if (offcanvasRecoveryEl) {
  offcanvasRecoveryEl.addEventListener('show.bs.offcanvas', loadRecoveredDocuments);
}

// Standby auto-resume and multi-tab query param handling on load
async function checkAndResumeSession() {
  const urlParams = new URLSearchParams(window.location.search);
  // const tokenFromUrl = urlParams.get('token');
  // if (tokenFromUrl && tokenInput) {
  //   tokenInput.value = tokenFromUrl.trim();
  // }

  // Keep token synced in URL when user changes it
  // tokenInput.addEventListener('change', () => {
  //   const u = new URL(window.location.href);
  //   u.searchParams.set('token', getAuthToken());
  //   window.history.replaceState({}, '', u.toString());
  // });

  const sessionFromUrl = urlParams.get('session');
  const savedSessionId = sessionFromUrl || sessionStorage.getItem('active_session_id');

  if (!savedSessionId) {
    loadReports();
    loadRecoveredDocuments();
    loadActiveSessions();

    // Check if URL has ?edit=... or ?report=... to open directly in a new tab
    const editParam = urlParams.get('edit') || urlParams.get('report');
    if (editParam) {
      const editName = urlParams.get('name') || editParam.replace(/\.frx$/i, '');
      requestOpenExistingFormat(editParam, editName);
    }
    return;
  }

  // updateStatus('connecting', 'Reanudando...');
  showToast('Comprobando sesión previa en standby...');

  try {
    const res = await apiFetch(`/api/session/resume/${encodeURIComponent(savedSessionId)}`);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.resumed) {
        console.log('[SESSION] Resumed active standby session:', data);
        attachToSession(data, true);
        return;
      }
    }
  } catch (err) {
    console.warn('[SESSION] Could not resume prior session:', err);
  }

  // If session is expired or not found, clean up
  sessionStorage.removeItem('active_session_id');
  localStorage.removeItem('active_session_id');
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('session');
  window.history.replaceState({}, '', cleanUrl.toString());

  // updateStatus('disconnected', 'Sin Sesión');
  loadReports();
  loadRecoveredDocuments();
  loadActiveSessions();
}

// Tab Close / Unload: We do not kill container immediately so Standby grace period (5 mins) protects user work
window.addEventListener('beforeunload', () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (sseSource) sseSource.close();
  if (rfbClient) {
    try { rfbClient.disconnect(); } catch (_) {}
  }
});

// Resize Observer
if (window.ResizeObserver && vncContainer) {
  const ro = new ResizeObserver(() => {
    if (rfbClient && isVncConnected) {
      window.dispatchEvent(new Event('resize'));
    }
  });
  ro.observe(vncContainer);
}

// Initial Setup
btnRefreshReports.addEventListener('click', () => {
  loadReports();
  loadRecoveredDocuments();
  loadActiveSessions();
});

if (btnRefreshSessions) {
  btnRefreshSessions.addEventListener('click', () => {
    loadActiveSessions();
    showToast('Sesiones actualizadas.');
  });
}

// Periodically refresh active sessions every 30 seconds while in lobby
setInterval(() => {
  if (!currentSession && !document.hidden) {
    loadActiveSessions();
  }
}, 30000);

async function initApplication() {
  const user = await ensureAuthenticated();
  if (!user) return; // redirects to /auth.html if invalid session
  updateAuthUI(user);
  await checkAndResumeSession();
}

initApplication();
