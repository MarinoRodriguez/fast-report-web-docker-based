using FastReport.WebEditor.Backend.Models;

namespace FastReport.WebEditor.Backend.Repositories.Interfaces;

public interface IRecoveryRepository
{
    Task<IEnumerable<RecoveryItem>> GetAllActiveAsync();
    Task<RecoveryItem?> GetByIdAsync(string id);
    Task<RecoveryItem?> GetPendingForReportAndUserAsync(string filename, string? reportName, string userToken);
    Task<bool> CreateAsync(RecoveryItem item);
    Task<bool> DeleteAsync(string id);
    Task<int> PurgeOlderThanDaysAsync(int days);
}
