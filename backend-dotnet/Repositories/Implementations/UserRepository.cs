using Dapper;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;

namespace FastReport.WebEditor.Backend.Repositories.Implementations;

public class UserRepository : IUserRepository
{
    private readonly IDbConnectionFactory _connectionFactory;

    public UserRepository(IDbConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<User?> GetByIdAsync(string id)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Id = @Id", new { Id = id });
    }

    public async Task<User?> GetByUsernameAsync(string username)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @Username COLLATE NOCASE", new { Username = username });
    }

    public async Task<User?> GetByEmailAsync(string email)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Email = @Email COLLATE NOCASE", new { Email = email });
    }

    public async Task<bool> CreateAsync(User user)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO Users (Id, Username, Email, PasswordHash, Role, CreatedAt)
            VALUES (@Id, @Username, @Email, @PasswordHash, @Role, @CreatedAt);";
        var rows = await db.ExecuteAsync(sql, user);
        return rows > 0;
    }

    public async Task<IEnumerable<User>> GetAllAsync()
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QueryAsync<User>("SELECT * FROM Users ORDER BY CreatedAt DESC");
    }

    public async Task<bool> SaveRefreshTokenAsync(RefreshToken token)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO RefreshTokens (Id, UserId, Token, ExpiresAt, IsRevoked, CreatedAt)
            VALUES (@Id, @UserId, @Token, @ExpiresAt, @IsRevoked, @CreatedAt);";
        var rows = await db.ExecuteAsync(sql, token);
        return rows > 0;
    }

    public async Task<RefreshToken?> GetRefreshTokenAsync(string token)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<RefreshToken>(
            "SELECT * FROM RefreshTokens WHERE Token = @Token AND IsRevoked = 0", new { Token = token });
    }

    public async Task<bool> RevokeRefreshTokenAsync(string token)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync(
            "UPDATE RefreshTokens SET IsRevoked = 1 WHERE Token = @Token", new { Token = token });
        return rows > 0;
    }

    public async Task<bool> RevokeAllUserTokensAsync(string userId)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync(
            "UPDATE RefreshTokens SET IsRevoked = 1 WHERE UserId = @UserId", new { UserId = userId });
        return rows > 0;
    }
}
