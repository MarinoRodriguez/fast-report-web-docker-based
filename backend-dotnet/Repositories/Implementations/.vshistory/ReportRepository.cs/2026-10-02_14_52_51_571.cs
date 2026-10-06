
using Dapper;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Repositories.Interfaces;

namespace FastReport.WebEditor.Backend.Repositories.Implementations;

public class ReportRepository : IReportRepository
{
    private readonly IDbConnectionFactory _connectionFactory;

    public ReportRepository(IDbConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<IEnumerable<Models.Report>> GetAllActiveAsync()
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QueryAsync<Models.Report>(
            "SELECT * FROM Reports WHERE IsDeleted = 0 ORDER BY ModifiedTimestamp DESC");
    }

    public async Task<Report?> GetByIdAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<Models.Report>(
            "SELECT * FROM Reports WHERE Id = @Id OR Filename = @Id", new { Id = id });
    }

    public async Task<Report?> GetByFilenameAsync(string filename)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<Models.Report>(
            "SELECT * FROM Reports WHERE Filename = @Filename COLLATE NOCASE", new { Filename = filename });
    }

    public async Task<bool> CreateAsync(Report report)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO Reports (Id, Name, Filename, SizeKb, ModifiedAt, ModifiedTimestamp, CreatedAt, IsDeleted, DeletedAt, CreatedByUserId)
            VALUES (@Id, @Name, @Filename, @SizeKb, @ModifiedAt, @ModifiedTimestamp, @CreatedAt, @IsDeleted, @DeletedAt, @CreatedByUserId);";
        var rows = await db.ExecuteAsync(sql, report);
        return rows > 0;
    }

    public async Task<bool> UpdateAsync(Report report)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE Reports 
            SET Name = @Name, Filename = @Filename, SizeKb = @SizeKb, ModifiedAt = @ModifiedAt, ModifiedTimestamp = @ModifiedTimestamp, IsDeleted = @IsDeleted, DeletedAt = @DeletedAt
            WHERE Id = @Id;";
        var rows = await db.ExecuteAsync(sql, report);
        return rows > 0;
    }

    public async Task<bool> SoftDeleteAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE Reports 
            SET IsDeleted = 1, DeletedAt = @DeletedAt
            WHERE Id = @Id OR Filename = @Id;";
        var rows = await db.ExecuteAsync(sql, new { Id = id, DeletedAt = DateTime.UtcNow.ToString("o") });
        return rows > 0;
    }

    public async Task<bool> HardDeleteAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync("DELETE FROM Reports WHERE Id = @Id", new { Id = id });
        return rows > 0;
    }

}
