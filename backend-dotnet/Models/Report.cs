namespace FastReport.WebEditor.Backend.Models;

public class Report
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Filename { get; set; } = string.Empty;
    public double SizeKb { get; set; }
    public string ModifiedAt { get; set; } = string.Empty;
    public long ModifiedTimestamp { get; set; }
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("o");
    public bool IsDeleted { get; set; }
    public string? DeletedAt { get; set; }
    public string? CreatedByUserId { get; set; }
}

public record RenameReportRequest(string Id, string NewName);
