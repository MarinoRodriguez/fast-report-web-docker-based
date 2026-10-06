using Dapper;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;

namespace FastReport.WebEditor.Backend.Repositories.Implementations;

public class HistoryRepository : IHistoryRepository
{
    private readonly IDbConnectionFactory _connectionFactory;

    public HistoryRepository(IDbConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<IEnumerable<ReportHistoryItem>> GetHistoryForReportAsync(string? filename, string? reportName)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT * FROM ReportHistory
            WHERE (@Filename IS NOT NULL AND (OriginalFilename = @Filename COLLATE NOCASE OR Filename = @Filename COLLATE NOCASE))
               OR (@ReportName IS NOT NULL AND ReportName = @ReportName COLLATE NOCASE)
            ORDER BY Version DESC;";
        return await db.QueryAsync<ReportHistoryItem>(sql, new { Filename = filename, ReportName = reportName });
    }

    public async Task<ReportHistoryItem?> GetByIdAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<ReportHistoryItem>(
            "SELECT * FROM ReportHistory WHERE Id = @Id OR Filename = @Id", new { Id = id });
    }

    public async Task<int> GetNextVersionNumberAsync(string reportName, string originalFilename)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT COALESCE(MAX(Version), 0) + 1 FROM ReportHistory
            WHERE ReportName = @ReportName COLLATE NOCASE 
               OR OriginalFilename = @OriginalFilename COLLATE NOCASE;";
        return await db.ExecuteScalarAsync<int>(sql, new { ReportName = reportName, OriginalFilename = originalFilename });
    }

    public async Task<bool> CreateAsync(ReportHistoryItem item)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO ReportHistory (Id, ReportName, OriginalFilename, Version, VersionLabel, Filename, UserToken, Comment, Timestamp, Date, SizeKb)
            VALUES (@Id, @ReportName, @OriginalFilename, @Version, @VersionLabel, @Filename, @UserToken, @Comment, @Timestamp, @Date, @SizeKb);";
        var rows = await db.ExecuteAsync(sql, item);
        return rows > 0;
    }
}
