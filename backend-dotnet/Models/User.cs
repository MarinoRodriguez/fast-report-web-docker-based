namespace FastReport.WebEditor.Backend.Models;

public class User
{
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "User"; // "Admin" | "User"
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("o");
}
