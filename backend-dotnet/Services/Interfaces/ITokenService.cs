using FastReport.WebEditor.Backend.Models;

namespace FastReport.WebEditor.Backend.Services.Interfaces;

public interface ITokenService
{
    (string Token, int ExpiresInSeconds) GenerateAccessToken(User user);
    RefreshToken GenerateRefreshToken(string userId);
}
