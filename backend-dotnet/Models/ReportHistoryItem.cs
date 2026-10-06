namespace FastReport.WebEditor.Backend.Models;

public class ReportHistoryItem
{
    public string Id { get; set; } = string.Empty;
    public string ReportName { get; set; } = string.Empty;
    public string OriginalFilename { get; set; } = string.Empty;
    public int Version { get; set; }
    public string VersionLabel { get; set; } = string.Empty;
    public string Filename { get; set; } = string.Empty;
    public string SnapshotFilename => Filename; // Alias for frontend compatibility
    public string UserToken { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public long Timestamp { get; set; }
    public string Date { get; set; } = string.Empty;
    public double SizeKb { get; set; }
}
