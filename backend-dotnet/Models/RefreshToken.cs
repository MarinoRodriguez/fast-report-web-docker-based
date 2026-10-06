namespace FastReport.WebEditor.Backend.Models;

public class RefreshToken
{
    public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
    public string ExpiresAt { get; set; } = string.Empty;
    public bool IsRevoked { get; set; }
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("o");
}
