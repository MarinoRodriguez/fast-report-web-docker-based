

namespace FastReport.WebEditor.Backend.Repositories.Interfaces;

using Report = FastReport.WebEditor.Backend.Models.Report;
public interface IReportRepository
{
    Task<IEnumerable<Report>> GetAllActiveAsync();
    Task<Report?> GetByIdAsync(string id);
    Task<Report?> GetByFilenameAsync(string filename);
    Task<bool> CreateAsync(Report report);
    Task<bool> UpdateAsync(Report report);
    Task<bool> SoftDeleteAsync(string id);
    Task<bool> HardDeleteAsync(string id);
}
