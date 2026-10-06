using FastReport.WebEditor.Backend.Models;

namespace FastReport.WebEditor.Backend.Repositories.Interfaces;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(string id);
    Task<User?> GetByUsernameAsync(string username);
    Task<User?> GetByEmailAsync(string email);
    Task<bool> CreateAsync(User user);
    Task<IEnumerable<User>> GetAllAsync();
    Task<bool> SaveRefreshTokenAsync(RefreshToken token);
    Task<RefreshToken?> GetRefreshTokenAsync(string token);
    Task<bool> RevokeRefreshTokenAsync(string token);
    Task<bool> RevokeAllUserTokensAsync(string userId);
}
