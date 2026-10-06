using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace FastReport.WebEditor.Backend.Services.Implementations;

public class JwtTokenService : ITokenService
{
    private readonly IConfiguration _configuration;
    private readonly byte[] _keyBytes;
    private readonly string _issuer;
    private readonly string _audience;
    private readonly int _accessTokenMinutes;
    private readonly int _refreshTokenDays;

    public JwtTokenService(IConfiguration configuration)
    {
        _configuration = configuration;
        var secret = _configuration["Jwt:SecretKey"] 
            ?? "SuperSecretKeyForFastReportWebEditorStreamPoc2026!MustBeAtLeast32BytesLong";
        _keyBytes = Encoding.UTF8.GetBytes(secret);
        _issuer = _configuration["Jwt:Issuer"] ?? "FastReport.WebEditor.Backend";
        _audience = _configuration["Jwt:Audience"] ?? "FastReport.WebEditor.Client";
        _accessTokenMinutes = int.TryParse(_configuration["Jwt:AccessTokenExpirationMinutes"], out var m) ? m : 60;
        _refreshTokenDays = int.TryParse(_configuration["Jwt:RefreshTokenExpirationDays"], out var d) ? d : 7;
    }

    public (string Token, int ExpiresInSeconds) GenerateAccessToken(User user)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Email, user.Email),
                new Claim(ClaimTypes.Role, user.Role),
                new Claim("token", user.Username) // Compatibilidad con userToken
            }),
            Expires = DateTime.UtcNow.AddMinutes(_accessTokenMinutes),
            Issuer = _issuer,
            Audience = _audience,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(_keyBytes),
                SecurityAlgorithms.HmacSha256Signature
            )
        };

        var securityToken = tokenHandler.CreateToken(tokenDescriptor);
        var tokenString = tokenHandler.WriteToken(securityToken);
        return (tokenString, _accessTokenMinutes * 60);
    }

    public RefreshToken GenerateRefreshToken(string userId)
    {
        var randomBytes = RandomNumberGenerator.GetBytes(64);
        var tokenString = Convert.ToBase64String(randomBytes)
            .Replace("+", "-")
            .Replace("/", "_")
            .TrimEnd('=');

        return new RefreshToken
        {
            Id = "rt_" + Guid.NewGuid().ToString("N")[..12],
            UserId = userId,
            Token = tokenString,
            ExpiresAt = DateTime.UtcNow.AddDays(_refreshTokenDays).ToString("o"),
            IsRevoked = false,
            CreatedAt = DateTime.UtcNow.ToString("o")
        };
    }
}
