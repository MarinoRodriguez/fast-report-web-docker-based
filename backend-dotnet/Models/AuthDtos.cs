namespace FastReport.WebEditor.Backend.Models;

public record LoginRequest(string Username, string Password);

public record RegisterRequest(string Username, string Email, string Password);

public record RefreshTokenRequest(string RefreshToken);

public record UserDto(string Id, string Username, string Email, string Role, string CreatedAt);

public record AuthResponse(
    string AccessToken,
    string RefreshToken,
    int ExpiresInSeconds,
    UserDto User
);

public record CheckTokenResponse(bool IsValid, UserDto? User);
