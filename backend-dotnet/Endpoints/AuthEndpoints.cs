using System.Security.Claims;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace FastReport.WebEditor.Backend.Endpoints;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuthEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/login", async (
            LoginRequest request,
            IUserRepository userRepository,
            ITokenService tokenService) =>
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.BadRequest(new { error = "El usuario y la contraseña son requeridos." });
            }

            var user = await userRepository.GetByUsernameAsync(request.Username.Trim());
            if (user == null || !PasswordHasher.VerifyPassword(request.Password, user.PasswordHash))
            {
                return Results.Unauthorized();
            }

            var (accessToken, expiresIn) = tokenService.GenerateAccessToken(user);
            var refreshToken = tokenService.GenerateRefreshToken(user.Id);
            await userRepository.SaveRefreshTokenAsync(refreshToken);

            var userDto = new UserDto(user.Id, user.Username, user.Email, user.Role, user.CreatedAt);
            return Results.Ok(new AuthResponse(accessToken, refreshToken.Token, expiresIn, userDto));
        });

        group.MapPost("/register", async (
            RegisterRequest request,
            IUserRepository userRepository,
            ITokenService tokenService) =>
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password) || string.IsNullOrWhiteSpace(request.Email))
            {
                return Results.BadRequest(new { error = "Nombre de usuario, correo y contraseña son obligatorios." });
            }

            var existingUser = await userRepository.GetByUsernameAsync(request.Username.Trim());
            if (existingUser != null)
            {
                return Results.Conflict(new { error = $"El nombre de usuario '{request.Username}' ya está registrado." });
            }

            var existingEmail = await userRepository.GetByEmailAsync(request.Email.Trim());
            if (existingEmail != null)
            {
                return Results.Conflict(new { error = $"El correo '{request.Email}' ya está registrado." });
            }

            var newUser = new User
            {
                Id = "usr_" + Guid.NewGuid().ToString("N")[..12],
                Username = request.Username.Trim(),
                Email = request.Email.Trim().ToLowerInvariant(),
                PasswordHash = PasswordHasher.HashPassword(request.Password),
                Role = "User",
                CreatedAt = DateTime.UtcNow.ToString("o")
            };

            await userRepository.CreateAsync(newUser);

            var (accessToken, expiresIn) = tokenService.GenerateAccessToken(newUser);
            var refreshToken = tokenService.GenerateRefreshToken(newUser.Id);
            await userRepository.SaveRefreshTokenAsync(refreshToken);

            var userDto = new UserDto(newUser.Id, newUser.Username, newUser.Email, newUser.Role, newUser.CreatedAt);
            return Results.Created($"/api/auth/me", new AuthResponse(accessToken, refreshToken.Token, expiresIn, userDto));
        });

        group.MapPost("/refresh", async (
            RefreshTokenRequest request,
            IUserRepository userRepository,
            ITokenService tokenService) =>
        {
            if (string.IsNullOrWhiteSpace(request.RefreshToken))
            {
                return Results.BadRequest(new { error = "El token de refresco es requerido." });
            }

            var token = await userRepository.GetRefreshTokenAsync(request.RefreshToken.Trim());
            if (token == null || token.IsRevoked)
            {
                return Results.Unauthorized();
            }

            if (DateTime.TryParse(token.ExpiresAt, out var expires) && expires < DateTime.UtcNow)
            {
                await userRepository.RevokeRefreshTokenAsync(token.Token);
                return Results.Unauthorized();
            }

            var user = await userRepository.GetByIdAsync(token.UserId);
            if (user == null)
            {
                return Results.Unauthorized();
            }

            // Rotación de tokens de refresco
            await userRepository.RevokeRefreshTokenAsync(token.Token);
            var (newAccessToken, expiresIn) = tokenService.GenerateAccessToken(user);
            var newRefreshToken = tokenService.GenerateRefreshToken(user.Id);
            await userRepository.SaveRefreshTokenAsync(newRefreshToken);

            var userDto = new UserDto(user.Id, user.Username, user.Email, user.Role, user.CreatedAt);
            return Results.Ok(new AuthResponse(newAccessToken, newRefreshToken.Token, expiresIn, userDto));
        });

        group.MapGet("/check", (ClaimsPrincipal user) =>
        {
            var isAuth = user.Identity?.IsAuthenticated ?? false;
            if (!isAuth)
            {
                return Results.Unauthorized();
            }

            var userDto = new UserDto(
                user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "",
                user.FindFirstValue(ClaimTypes.Name) ?? "",
                user.FindFirstValue(ClaimTypes.Email) ?? "",
                user.FindFirstValue(ClaimTypes.Role) ?? "User",
                ""
            );

            return Results.Ok(new CheckTokenResponse(true, userDto));
        }).RequireAuthorization();

        group.MapGet("/me", (ClaimsPrincipal user) =>
        {
            var userDto = new UserDto(
                user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "",
                user.FindFirstValue(ClaimTypes.Name) ?? "",
                user.FindFirstValue(ClaimTypes.Email) ?? "",
                user.FindFirstValue(ClaimTypes.Role) ?? "User",
                ""
            );
            return Results.Ok(userDto);
        }).RequireAuthorization();

        return group;
    }
}
