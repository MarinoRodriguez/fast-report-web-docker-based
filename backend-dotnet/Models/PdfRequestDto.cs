namespace FastReport.WebEditor.Backend.Models;

public class GeneratePdfRequest
{
    public bool UseMockData { get; set; } = true;
    public int MockRowCount { get; set; } = 25;
    public string? CustomDataJson { get; set; }
}
