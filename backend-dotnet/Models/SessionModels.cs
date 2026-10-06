namespace FastReport.WebEditor.Backend.Models;

public class StartSessionRequest
{
    public string? ReportName { get; set; }
    public string? SourceFilename { get; set; }
    public string? OriginalFilename { get; set; }
    public string? StartType { get; set; } // "upload" | "history" | "recovery" | "existing" | "blank"
    public string? UploadedContent { get; set; }
    public string? Mode { get; set; }
}

public class SessionResponse
{
    public bool Success { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public string ContainerName { get; set; } = string.Empty;
    public int VncPort { get; set; }
    public string VncUrl { get; set; } = string.Empty;
    public string EventsUrl { get; set; } = string.Empty;
    public string ReportName { get; set; } = string.Empty;
    public string AppMode { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string UserToken => Username;
    public bool Resumed { get; set; }
}

public class StopSessionRequest
{
    public string SessionId { get; set; } = string.Empty;
    public bool Save { get; set; }
    public string? ReportName { get; set; }
    public string? Comment { get; set; }
}

public class HeartbeatRequest
{
    public string SessionId { get; set; } = string.Empty;
}

public class LoadFormatRequest
{
    public string SessionId { get; set; } = string.Empty;
    public string FormatType { get; set; } = string.Empty; // "upload" | "existing"
    public string? SourceFilename { get; set; }
    public string? UploadedContent { get; set; }
    public string? ReportName { get; set; }
}

public class ActiveSessionInfo
{
    public string SessionId { get; set; } = string.Empty;
    public string ContainerName { get; set; } = string.Empty;
    public int VncPort { get; set; }
    public string AppMode { get; set; } = string.Empty;
    public string SourceReport { get; set; } = string.Empty;
    public string? OriginalFilename { get; set; }
    public string Username { get; set; } = string.Empty;
    public string UserToken => Username;
    public string Status { get; set; } = "active"; // "active" | "standby"
    public long StartTime { get; set; }
    public long LastHeartbeat { get; set; }
    public long? StandbyStartedAt { get; set; }
    public long UptimeSeconds => Math.Max(0, (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - StartTime) / 1000);
}
