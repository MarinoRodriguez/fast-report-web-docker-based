using FastReport.WebEditor.Backend.Models;

namespace FastReport.WebEditor.Backend.Services.Interfaces;

public interface IDockerOrchestratorService
{
    Task<SessionResponse> StartSessionAsync(StartSessionRequest request, string username);
    Task<SessionResponse?> ResumeSessionAsync(string sessionId, string username);
    Task<(bool Success, string? SavedReportName, string Message)> StopSessionAsync(StopSessionRequest request, string username);
    bool UpdateHeartbeat(string sessionId, string username);
    Task<bool> LoadFormatIntoSessionAsync(LoadFormatRequest request);
    ActiveSessionInfo? GetSession(string sessionId);
    IEnumerable<ActiveSessionInfo> GetActiveSessions();
    Task<byte[]> DownloadRamReportAsync(string sessionId);
    void BroadcastUrlToSession(string sessionId, string url, string source);
    void RegisterSseClient(string sessionId, HttpResponse response, CancellationToken cancellationToken);
    Task CheckStandbySessionsAsync();
}
