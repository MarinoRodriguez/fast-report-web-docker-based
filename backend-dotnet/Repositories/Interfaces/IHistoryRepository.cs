using FastReport.WebEditor.Backend.Models;

namespace FastReport.WebEditor.Backend.Repositories.Interfaces;

public interface IHistoryRepository
{
    Task<IEnumerable<ReportHistoryItem>> GetHistoryForReportAsync(string? filename, string? reportName);
    Task<ReportHistoryItem?> GetByIdAsync(string id);
    Task<int> GetNextVersionNumberAsync(string reportName, string originalFilename);
    Task<bool> CreateAsync(ReportHistoryItem item);
}
