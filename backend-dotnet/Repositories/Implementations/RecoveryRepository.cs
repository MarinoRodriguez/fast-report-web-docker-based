using Dapper;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;

namespace FastReport.WebEditor.Backend.Repositories.Implementations;

public class RecoveryRepository : IRecoveryRepository
{
    private readonly IDbConnectionFactory _connectionFactory;

    public RecoveryRepository(IDbConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<IEnumerable<RecoveryItem>> GetAllActiveAsync()
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QueryAsync<RecoveryItem>(
            "SELECT * FROM RecoveryFiles ORDER BY Timestamp DESC;");
    }

    public async Task<RecoveryItem?> GetByIdAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<RecoveryItem>(
            "SELECT * FROM RecoveryFiles WHERE Id = @Id OR Filename = @Id;", new { Id = id });
    }

    public async Task<RecoveryItem?> GetPendingForReportAndUserAsync(string filename, string? reportName, string userToken)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT * FROM RecoveryFiles
            WHERE UserToken = @UserToken
              AND (
                  (OriginalFilename IS NOT NULL AND OriginalFilename = @Filename COLLATE NOCASE)
                  OR Filename LIKE '%' || @Filename || '%'
                  OR (@ReportName IS NOT NULL AND Name = @ReportName COLLATE NOCASE)
              )
            ORDER BY Timestamp DESC
            LIMIT 1;";
        return await db.QuerySingleOrDefaultAsync<RecoveryItem>(sql, new { Filename = filename, ReportName = reportName, UserToken = userToken });
    }

    public async Task<bool> CreateAsync(RecoveryItem item)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO RecoveryFiles (Id, Name, Filename, OriginalFilename, UserToken, SizeKb, Timestamp, Date, SourceSession)
            VALUES (@Id, @Name, @Filename, @OriginalFilename, @UserToken, @SizeKb, @Timestamp, @Date, @SourceSession);";
        var rows = await db.ExecuteAsync(sql, item);
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync("DELETE FROM RecoveryFiles WHERE Id = @Id OR Filename = @Id;", new { Id = id });
        return rows > 0;
    }

    public async Task<int> PurgeOlderThanDaysAsync(int days)
    {
        using var db = _connectionFactory.CreateConnection();
        var cutoff = DateTimeOffset.UtcNow.AddDays(-days).ToUnixTimeMilliseconds();
        return await db.ExecuteAsync("DELETE FROM RecoveryFiles WHERE Timestamp < @Cutoff;", new { Cutoff = cutoff });
    }
}
