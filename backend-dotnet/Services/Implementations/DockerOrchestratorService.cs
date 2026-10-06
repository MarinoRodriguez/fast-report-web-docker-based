using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
namespace FastReport.WebEditor.Backend.Services.Implementations;

using Report = FastReport.WebEditor.Backend.Models.Report;
public class DockerOrchestratorService : IDockerOrchestratorService
{
    private readonly IReportRepository _reportRepository;
    private readonly IHistoryRepository _historyRepository;
    private readonly IRecoveryRepository _recoveryRepository;
    private readonly IFileSecurityValidator _securityValidator;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DockerOrchestratorService> _logger;

    private readonly ConcurrentDictionary<string, ActiveSessionInfo> _activeSessions = new();
    private readonly ConcurrentDictionary<string, ConcurrentBag<Func<string, Task>>> _sseSubscribers = new();

    private readonly string _dockerImage;
    private readonly string _dockerPlatform;
    private readonly string _dockerNetwork;
    private readonly string _orchestratorUrl;
    private readonly int _ramTmpfsMb;
    private readonly int _vncStartPort;
    private readonly int _vncEndPort;
    private readonly int _standbyHeartbeatTimeoutSeconds;
    private readonly int _standbyGracePeriodMinutes;
    private readonly int _containerMaxMemoryMb;

    private const string DefaultBlankReportXml = """
<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp" ReportInfo.Created="10/05/2026 15:13:41" ReportInfo.Modified="10/05/2026 15:14:55" ReportInfo.CreatorVersion="2025.1.0.0">
  <Dictionary/>
  <ReportPage Name="Page1" Watermark.Font="Arial, 60pt">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Text1" Width="245.7" Height="28.35" Text="Blank Report" Font="Arial, 18pt, style=Bold"/>
    </ReportTitleBand>
    <PageHeaderBand Name="PageHeader1" Top="41.8" Width="718.2" Height="28.35"/>
    <DataBand Name="Data1" Top="74.15" Width="718.2" Height="75.6"/>
    <PageFooterBand Name="PageFooter1" Top="153.75" Width="718.2" Height="18.9"/>
  </ReportPage>
</Report>
""";

    public DockerOrchestratorService(
        IReportRepository reportRepository,
        IHistoryRepository historyRepository,
        IRecoveryRepository recoveryRepository,
        IFileSecurityValidator securityValidator,
        IConfiguration configuration,
        ILogger<DockerOrchestratorService> logger)
    {
        _reportRepository = reportRepository;
        _historyRepository = historyRepository;
        _recoveryRepository = recoveryRepository;
        _securityValidator = securityValidator;
        _configuration = configuration;
        _logger = logger;

        _dockerImage = _configuration["Orchestrator:DockerImage"] ?? "fastreport-stream:latest";
        _dockerPlatform = _configuration["Orchestrator:DockerPlatform"] ?? "";
        _dockerNetwork = _configuration["Orchestrator:DockerNetwork"] ?? "stream-net";
        _orchestratorUrl = _configuration["Orchestrator:Url"] ?? "http://fastreport_backend:3000";
        _ramTmpfsMb = int.TryParse(_configuration["Orchestrator:RamTmpfsMb"], out var ram) ? ram : 2;
        _vncStartPort = int.TryParse(_configuration["Orchestrator:VncStartPort"], out var sp) ? sp : 6081;
        _vncEndPort = int.TryParse(_configuration["Orchestrator:VncEndPort"], out var ep) ? ep : 6300;
        _standbyHeartbeatTimeoutSeconds = int.TryParse(_configuration["Orchestrator:StandbyHeartbeatTimeoutSeconds"], out var sb) ? sb : 40;
        _standbyGracePeriodMinutes = int.TryParse(_configuration["Orchestrator:StandbyGracePeriodMinutes"], out var sg) ? sg : 5;
        _containerMaxMemoryMb = int.TryParse(_configuration["Orchestrator:ContainerMaxMemoryMb"], out var cmm) ? cmm : 512;
    }

    public async Task<SessionResponse> StartSessionAsync(StartSessionRequest request, string username)
    {
        var startType = (request.StartType ?? "blank").ToLowerInvariant();
        byte[]? initialReportBytes = null;
        string sourceReportName = request.ReportName ?? "En Blanco";
        string? originalFilename = null;

        // 1. Strict File Resolution & Validation - NO SILENT FALLBACKS
        if (startType == "upload")
        {
            if (string.IsNullOrWhiteSpace(request.UploadedContent))
            {
                throw new ArgumentException("No se recibió el contenido del archivo .frx para cargar.");
            }
            initialReportBytes = Encoding.UTF8.GetBytes(request.UploadedContent);
            if (!_securityValidator.ValidateFrx(initialReportBytes, "upload.frx", "application/xml", out var err))
            {
                throw new InvalidOperationException($"Archivo subido no válido: {err}");
            }
            sourceReportName = request.ReportName ?? "Formato Cargado";
        }
        else if (startType == "history")
        {
            if (string.IsNullOrWhiteSpace(request.SourceFilename) || request.SourceFilename == "undefined")
            {
                throw new ArgumentException("No se especificó la versión histórica a cargar.");
            }

            var cleanSource = Path.GetFileName(request.SourceFilename);
            var histItem = await _historyRepository.GetByIdAsync(cleanSource);
            var targetFile = histItem?.Filename ?? cleanSource;
            var historyPath = Path.Combine("wwwroot", "history", targetFile);

            if (!File.Exists(historyPath))
            {
                // Fallback check to legacy directory if present
                var legacyHistoryPath = Path.Combine("storage", "history", targetFile);
                if (File.Exists(legacyHistoryPath))
                {
                    historyPath = legacyHistoryPath;
                }
                else
                {
                    throw new FileNotFoundException($"La versión histórica '{cleanSource}' no se encuentra en el servidor.");
                }
            }

            initialReportBytes = await File.ReadAllBytesAsync(historyPath);
            sourceReportName = request.ReportName ?? (histItem?.ReportName ?? targetFile.Replace(".frx", ""));
            originalFilename = histItem?.OriginalFilename ?? request.OriginalFilename;
        }
        else if (startType == "recovery")
        {
            if (string.IsNullOrWhiteSpace(request.SourceFilename) || request.SourceFilename == "undefined")
            {
                throw new ArgumentException("No se especificó el documento recuperado a abrir.");
            }

            var cleanSource = Path.GetFileName(request.SourceFilename);
            var recoveryPath = Path.Combine("wwwroot", "recovery", cleanSource);

            if (!File.Exists(recoveryPath))
            {
                var legacyRecoveryPath = Path.Combine("storage", "recovery", cleanSource);
                if (File.Exists(legacyRecoveryPath))
                {
                    recoveryPath = legacyRecoveryPath;
                }
                else
                {
                    throw new FileNotFoundException($"El documento recuperado '{cleanSource}' no existe o ya expiró.");
                }
            }

            initialReportBytes = await File.ReadAllBytesAsync(recoveryPath);
            var recItem = await _recoveryRepository.GetByIdAsync(cleanSource);
            sourceReportName = request.ReportName ?? (recItem?.Name ?? cleanSource.Replace(".frx", ""));
            originalFilename = recItem?.OriginalFilename;
        }
        else if (startType == "blank")
        {
            var templatePath = Path.Combine("wwwroot", "reports", "blank.frx");
            if (File.Exists(templatePath) && new FileInfo(templatePath).Length > 0)
            {
                initialReportBytes = await File.ReadAllBytesAsync(templatePath);
            }
            else
            {
                initialReportBytes = Encoding.UTF8.GetBytes(DefaultBlankReportXml);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(templatePath)!);
                    await File.WriteAllBytesAsync(templatePath, initialReportBytes);
                }
                catch { }
            }
            sourceReportName = request.ReportName ?? "Nuevo Formato";
        }
        else // Existing
        {
            var searchName = request.SourceFilename ?? request.ReportName;
            if (string.IsNullOrWhiteSpace(searchName) || searchName == "undefined")
            {
                throw new ArgumentException("No se especificó el formato de reporte a abrir.");
            }

            var cleanFile = Path.GetFileName(searchName).EndsWith(".frx", StringComparison.OrdinalIgnoreCase) 
                ? Path.GetFileName(searchName) 
                : Path.GetFileName(searchName) + ".frx";

            var reportPath = Path.Combine("wwwroot", "reports", cleanFile);
            if (!File.Exists(reportPath))
            {
                // Also check database record or legacy directory
                var rep = await _reportRepository.GetByFilenameAsync(cleanFile);
                if (rep != null && File.Exists(Path.Combine("storage", "saved_reports", rep.Filename)))
                {
                    reportPath = Path.Combine("storage", "saved_reports", rep.Filename);
                }
                else
                {
                    throw new FileNotFoundException($"El archivo de formato guardado '{cleanFile}' no existe en el servidor.");
                }
            }

            initialReportBytes = await File.ReadAllBytesAsync(reportPath);
            sourceReportName = request.ReportName ?? cleanFile.Replace(".frx", "");
            originalFilename = cleanFile;
        }

        if (initialReportBytes == null || initialReportBytes.Length == 0)
        {
            throw new InvalidOperationException("El archivo de formato está vacío o no pudo ser leído.");
        }

        // 2. Allocate Dynamic Port
        var vncPort = await FindAvailablePortAsync(_vncStartPort, _vncEndPort);
        var sessionId = "sess_" + Guid.NewGuid().ToString("N")[..12];
        var containerName = $"fastreport_{sessionId}";
        var appMode = request.Mode == "test" ? "test" : "fastreport";

        _logger.LogInformation("[ORCHESTRATOR] Iniciando contenedor {ContainerName} (Puerto: {Port}, RAM: {Ram}MB)...",
            containerName, vncPort, _ramTmpfsMb);

        // 3. Mounts
        var rootDir = Directory.GetCurrentDirectory();
        var parentDir = Directory.GetParent(rootDir)?.FullName ?? rootDir;
        var openboxRcPath = Path.Combine(parentDir, "docker", "openbox_rc.xml");
        var entrypointPath = Path.Combine(parentDir, "docker", "entrypoint.sh");
        var redirectorPath = Path.Combine(parentDir, "docker", "url-redirector.sh");

        var mounts = new StringBuilder();
        if (File.Exists(openboxRcPath)) mounts.Append($"-v \"{openboxRcPath}:/etc/xdg/openbox/rc.xml:ro\" ");
        if (File.Exists(entrypointPath)) mounts.Append($"-v \"{entrypointPath}:/app/entrypoint.sh:ro\" ");
        if (File.Exists(redirectorPath)) mounts.Append($"-v \"{redirectorPath}:/usr/local/bin/winebrowser:ro\" ");

        // 4. Run Docker Container
        var platformFlag = string.IsNullOrWhiteSpace(_dockerPlatform) ? "" : $"--platform {_dockerPlatform} ";
        var memoryFlag = _containerMaxMemoryMb > 0 ? $"--memory {_containerMaxMemoryMb}m " : "";
        var dockerCmd = $"run -d --name {containerName} {platformFlag}{memoryFlag}--network {_dockerNetwork} -p 127.0.0.1:{vncPort}:6080 --tmpfs /workspace:rw,size={_ramTmpfsMb}m {mounts}-e SESSION_ID={sessionId} -e WINEDLLOVERRIDES=dwmapi=n -e ORCHESTRATOR_URL={_orchestratorUrl} -e APP_MODE={appMode} {_dockerImage}";
        await RunCliCommandAsync("docker", dockerCmd);

        // 5. Inject report into RAM tmpfs
        await InjectReportToContainerRamAsync(containerName, initialReportBytes);

        // 6. Save Active Session State
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var sessionInfo = new ActiveSessionInfo
        {
            SessionId = sessionId,
            ContainerName = containerName,
            VncPort = vncPort,
            AppMode = appMode,
            SourceReport = sourceReportName,
            OriginalFilename = originalFilename,
            Username = username,
            Status = "active",
            StartTime = now,
            LastHeartbeat = now
        };

        _activeSessions[sessionId] = sessionInfo;

        return new SessionResponse
        {
            Success = true,
            SessionId = sessionId,
            ContainerName = containerName,
            VncPort = vncPort,
            VncUrl = $"ws://localhost:{vncPort}",
            EventsUrl = $"/api/session/events/{sessionId}",
            ReportName = sourceReportName,
            AppMode = appMode,
            Username = username
        };
    }

    public async Task<SessionResponse?> ResumeSessionAsync(string sessionId, string username)
    {
        if (!_activeSessions.TryGetValue(sessionId, out var session))
        {
            return null;
        }

        session.Status = "active";
        session.LastHeartbeat = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        session.StandbyStartedAt = null;

        _logger.LogInformation("[ORCHESTRATOR] Sesión {SessionId} reanudada con éxito.", sessionId);

        return new SessionResponse
        {
            Success = true,
            SessionId = session.SessionId,
            ContainerName = session.ContainerName,
            VncPort = session.VncPort,
            VncUrl = $"ws://localhost:{session.VncPort}",
            EventsUrl = $"/api/session/events/{session.SessionId}",
            ReportName = session.SourceReport,
            AppMode = session.AppMode,
            Username = session.Username,
            Resumed = true
        };
    }

    public async Task<(bool Success, string? SavedReportName, string Message)> StopSessionAsync(StopSessionRequest request, string username)
    {
        _activeSessions.TryGetValue(request.SessionId, out var session);
        string containerName = session?.ContainerName ?? $"fastreport_{request.SessionId}";
        string? savedReportName = null;

        try
        {
            if (request.Save)
            {
                var cleanName = (request.ReportName ?? session?.SourceReport ?? "Reporte")
                    .Trim()
                    .Replace("/", "_")
                    .Replace("\\", "_");
                var finalFilename = cleanName.EndsWith(".frx", StringComparison.OrdinalIgnoreCase)
                    ? cleanName
                    : cleanName + ".frx";

                var reportBytes = await ExtractReportFromContainerRamAsync(containerName);

                if (reportBytes != null && reportBytes.Length > 50)
                {
                    // 1. Guardar en wwwroot/reports/
                    var targetPath = Path.Combine("wwwroot", "reports", finalFilename);
                    await File.WriteAllBytesAsync(targetPath, reportBytes);

                    // 2. Registrar en base de datos SQLite
                    var existingRep = await _reportRepository.GetByFilenameAsync(finalFilename);
                    var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    var dateStr = DateTime.UtcNow.ToString("g");

                    if (existingRep == null)
                    {
                        var newRep = new Report
                        {
                            Id = "rep_" + Guid.NewGuid().ToString("N")[..12],
                            Name = cleanName.Replace(".frx", ""),
                            Filename = finalFilename,
                            SizeKb = Math.Round(reportBytes.Length / 1024.0, 1),
                            ModifiedAt = dateStr,
                            ModifiedTimestamp = now,
                            CreatedAt = DateTime.UtcNow.ToString("o"),
                            CreatedByUserId = username
                        };
                        await _reportRepository.CreateAsync(newRep);
                    }
                    else
                    {
                        existingRep.SizeKb = Math.Round(reportBytes.Length / 1024.0, 1);
                        existingRep.ModifiedAt = dateStr;
                        existingRep.ModifiedTimestamp = now;
                        existingRep.IsDeleted = false;
                        await _reportRepository.UpdateAsync(existingRep);
                    }

                    // 3. Registrar versión inmutable en ReportHistory
                    var nextVer = await _historyRepository.GetNextVersionNumberAsync(cleanName.Replace(".frx", ""), finalFilename);
                    var histFilename = $"hist_{now}_{finalFilename.Replace(".frx", "")}_v{nextVer}.frx";
                    var histPath = Path.Combine("wwwroot", "history", histFilename);
                    await File.WriteAllBytesAsync(histPath, reportBytes);

                    var histItem = new ReportHistoryItem
                    {
                        Id = "hist_" + Guid.NewGuid().ToString("N")[..12],
                        ReportName = cleanName.Replace(".frx", ""),
                        OriginalFilename = finalFilename,
                        Version = nextVer,
                        VersionLabel = $"v{nextVer}",
                        Filename = histFilename,
                        // UserToken = userToken,
                        Comment = request.Comment?.Trim(),
                        Timestamp = now,
                        Date = dateStr,
                        SizeKb = Math.Round(reportBytes.Length / 1024.0, 1)
                    };
                    await _historyRepository.CreateAsync(histItem);

                    savedReportName = finalFilename;
                    _logger.LogInformation("[ORCHESTRATOR] Reporte '{FinalFilename}' guardado y versionado como v{NextVer}.", finalFilename, nextVer);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ORCHESTRATOR] Error guardando reporte de sesión {SessionId}.", request.SessionId);
        }
        finally
        {
            // Destruir contenedor efímero
            try
            {
                await RunCliCommandAsync("docker", $"rm -f {containerName}");
            }
            catch  { }

            _activeSessions.TryRemove(request.SessionId, out _);
            _sseSubscribers.TryRemove(request.SessionId, out _);
        }

        return (
            true,
            savedReportName,
            savedReportName != null
                ? $"Reporte '{savedReportName}' guardado exitosamente y contenedor destruido."
                : "Sesión finalizada y contenedor efímero destruido."
        );
    }

    public bool UpdateHeartbeat(string sessionId, string username)
    {
        if (_activeSessions.TryGetValue(sessionId, out var session))
        {
            session.LastHeartbeat = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (!string.IsNullOrWhiteSpace(username))
            {
                session.Username = username;
            }
            if (session.Status == "standby")
            {
                session.Status = "active";
                session.StandbyStartedAt = null;
            }
            return true;
        }
        return false;
    }

    public async Task<bool> LoadFormatIntoSessionAsync(LoadFormatRequest request)
    {
        if (!_activeSessions.TryGetValue(request.SessionId, out var session))
        {
            return false;
        }

        byte[]? reportBytes = null;
        if (request.FormatType == "upload" && !string.IsNullOrWhiteSpace(request.UploadedContent))
        {
            reportBytes = Encoding.UTF8.GetBytes(request.UploadedContent);
        }
        else if (request.FormatType == "existing" && !string.IsNullOrWhiteSpace(request.SourceFilename))
        {
            var clean = Path.GetFileName(request.SourceFilename);
            var p = Path.Combine("wwwroot", "reports", clean);
            if (File.Exists(p))
            {
                reportBytes = await File.ReadAllBytesAsync(p);
            }
        }

        if (reportBytes == null || reportBytes.Length == 0) return false;

        await InjectReportToContainerRamAsync(session.ContainerName, reportBytes);
        if (!string.IsNullOrWhiteSpace(request.ReportName))
        {
            session.SourceReport = request.ReportName;
        }
        return true;
    }

    public ActiveSessionInfo? GetSession(string sessionId)
    {
        _activeSessions.TryGetValue(sessionId, out var session);
        return session;
    }

    public IEnumerable<ActiveSessionInfo> GetActiveSessions()
    {
        return _activeSessions.Values;
    }

    public async Task<byte[]> DownloadRamReportAsync(string sessionId)
    {
        if (!_activeSessions.TryGetValue(sessionId, out var session))
        {
            throw new KeyNotFoundException("Sesión no encontrada o inactiva.");
        }

        // Flush current designer state into /workspace/report.frx
        try
        {
            await RunCliCommandAsync("docker", $"exec {session.ContainerName} xdotool key --clearmodifiers ctrl+s");
            await Task.Delay(350);
        }
        catch { }

        return await ExtractReportFromContainerRamAsync(session.ContainerName);
    }

    public void BroadcastUrlToSession(string sessionId, string url, string source)
    {
        if (_sseSubscribers.TryGetValue(sessionId, out var subscribers))
        {
            var payload = JsonSerializer.Serialize(new { url, source, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            foreach (var sendAsync in subscribers)
            {
                try { sendAsync(payload); } catch { }
            }
        }
    }

    public void RegisterSseClient(string sessionId, HttpResponse response, CancellationToken cancellationToken)
    {
        var bag = _sseSubscribers.GetOrAdd(sessionId, _ => new ConcurrentBag<Func<string, Task>>());
        bag.Add(async (payload) =>
        {
            try
            {
                await response.WriteAsync($"event: open_url\ndata: {payload}\n\n", cancellationToken);
                await response.Body.FlushAsync(cancellationToken);
            }
            catch { }
        });
    }

    public async Task CheckStandbySessionsAsync()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        foreach (var (id, session) in _activeSessions)
        {
            // 1. Detect disconnected client (no heartbeat for 40s)
            if (session.Status == "active" && (now - session.LastHeartbeat > _standbyHeartbeatTimeoutSeconds * 1000))
            {
                session.Status = "standby";
                session.StandbyStartedAt = now;
                _logger.LogInformation("[ORCHESTRATOR] Sesión {SessionId} en STANDBY (sin heartbeat por 40s). Preservando RAM por 5m...", id);
            }

            // 2. Standby grace period expired (> 5 minutes)
            if (session.Status == "standby" && (now - session.StandbyStartedAt > _standbyGracePeriodMinutes * 60 * 1000))
            {
                _logger.LogInformation("[ORCHESTRATOR] Standby expirado (5m) para sesión {SessionId}. Rescatando reporte de RAM tmpfs...", id);
                try
                {
                    var reportBytes = await ExtractReportFromContainerRamAsync(session.ContainerName);
                    if (reportBytes != null && reportBytes.Length > 50)
                    {
                        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        var cleanReportName = (session.SourceReport ?? "documento")
                            .Replace(" ", "_");
                        var recoveryFilename = $"rec_{timestamp}_{cleanReportName}.frx";
                        var recoveryPath = Path.Combine("wwwroot", "recovery", recoveryFilename);

                        await File.WriteAllBytesAsync(recoveryPath, reportBytes);

                        var recoveryItem = new RecoveryItem
                        {
                            Id = "rec_" + Guid.NewGuid().ToString("N")[..12],
                            Name = session.SourceReport ?? "Documento sin guardar",
                            Filename = recoveryFilename,
                            OriginalFilename = session.OriginalFilename,
                            UserToken = session.UserToken,
                            SizeKb = Math.Round(reportBytes.Length / 1024.0, 1),
                            Timestamp = timestamp,
                            Date = DateTime.UtcNow.ToString("g"),
                            SourceSession = id
                        };

                        await _recoveryRepository.CreateAsync(recoveryItem);
                        _logger.LogInformation("[ORCHESTRATOR] Reporte rescatado con éxito: {RecoveryFilename}", recoveryFilename);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[ORCHESTRATOR] Error rescatando reporte de RAM para {SessionId}.", id);
                }
                finally
                {
                    try { await RunCliCommandAsync("docker", $"rm -f {session.ContainerName}"); } catch { }
                    _activeSessions.TryRemove(id, out _);
                    _sseSubscribers.TryRemove(id, out _);
                }
            }
        }
    }

    private static async Task InjectReportToContainerRamAsync(string containerName, byte[] reportBytes)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = $"exec -i {containerName} sh -c \"cat > /workspace/report.frx\"",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("No se pudo iniciar docker exec.");
        await process.StandardInput.BaseStream.WriteAsync(reportBytes);
        await process.StandardInput.BaseStream.FlushAsync();
        process.StandardInput.Close();

        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            var err = await process.StandardError.ReadToEndAsync();
            throw new InvalidOperationException($"Error inyectando reporte en RAM: {err}");
        }
    }

    private static async Task<byte[]> ExtractReportFromContainerRamAsync(string containerName)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = $"exec {containerName} cat /workspace/report.frx",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("No se pudo ejecutar extracción de RAM.");
        using var ms = new MemoryStream();
        await process.StandardOutput.BaseStream.CopyToAsync(ms);
        await process.WaitForExitAsync();

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException("No se pudo extraer el reporte de la RAM del contenedor.");
        }

        return ms.ToArray();
    }

    private async Task<int> FindAvailablePortAsync(int startPort, int endPort)
    {
        // 1. Gather all ports in use by in-memory active sessions
        var usedPorts = _activeSessions.Values
            .Select(s => s.VncPort)
            .ToHashSet();

        // 2. Query docker ps on host to detect any containers bound to ports in our range
        try
        {
            var psOutput = await RunCliCommandAsync("docker", "ps --format \"{{.Ports}}\"");
            var matches = System.Text.RegularExpressions.Regex.Matches(psOutput, @":(\d+)->");
            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                if (int.TryParse(match.Groups[1].Value, out var p))
                {
                    usedPorts.Add(p);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[ORCHESTRATOR] Error consultando puertos ocupados en docker ps, continuando con puertos en memoria.");
        }

        // 3. Find the lowest unused port in range
        for (int port = startPort; port <= endPort; port++)
        {
            if (!usedPorts.Contains(port) && await IsPortAvailableAsync(port))
            {
                return port;
            }
        }
        throw new InvalidOperationException($"No hay puertos TCP disponibles en el rango {startPort}-{endPort}.");
    }

    private static Task<bool> IsPortAvailableAsync(int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
            listener.Stop();
            return Task.FromResult(true);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    private static async Task<string> RunCliCommandAsync(string command, string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = command,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException($"No se pudo ejecutar {command}.");
        var output = await process.StandardOutput.ReadToEndAsync();
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{command} fallo con código {process.ExitCode}: {error}");
        }

        return output.Trim();
    }
}
