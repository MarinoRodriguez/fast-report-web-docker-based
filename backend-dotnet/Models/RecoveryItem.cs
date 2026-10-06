namespace FastReport.WebEditor.Backend.Models;

public class RecoveryItem
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Filename { get; set; } = string.Empty;
    public string? OriginalFilename { get; set; }
    public string UserToken { get; set; } = string.Empty;
    public double SizeKb { get; set; }
    public long Timestamp { get; set; }
    public string Date { get; set; } = string.Empty;
    public string SourceSession { get; set; } = string.Empty;
}
