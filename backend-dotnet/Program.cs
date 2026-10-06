using System.Text;
using FastReport.WebEditor.Backend.Data;
using FastReport.WebEditor.Backend.Endpoints;
using FastReport.WebEditor.Backend.Repositories.Implementations;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services;
using FastReport.WebEditor.Backend.Services.Implementations;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// 1. Configure Port 3000 for Nginx Gateway compatibility
builder.WebHost.UseUrls("http://0.0.0.0:3000");

// 2. Database & Repositories (SQLite + Dapper)
builder.Services.AddSingleton<IDbConnectionFactory, DbConnectionFactory>();
builder.Services.AddScoped<DbInitializer>();
builder.Services.AddSingleton<IUserRepository, UserRepository>();
builder.Services.AddSingleton<IReportRepository, ReportRepository>();
builder.Services.AddSingleton<IHistoryRepository, HistoryRepository>();
builder.Services.AddSingleton<IRecoveryRepository, RecoveryRepository>();

// 3. Domain Services
builder.Services.AddSingleton<ITokenService, JwtTokenService>();
builder.Services.AddSingleton<IFileSecurityValidator, FileSecurityValidator>();
builder.Services.AddSingleton<IMockDataEngine, MockDataEngine>();
builder.Services.AddSingleton<IFastReportPdfService, FastReportPdfService>();
builder.Services.AddSingleton<IDockerOrchestratorService, DockerOrchestratorService>();

// 4. Background Workers
builder.Services.AddHostedService<StandbyMonitorHostedService>();

// 5. JWT Authentication & Authorization
var secretKey = builder.Configuration["Jwt:SecretKey"] 
    ?? "SuperSecretKeyForFastReportWebEditorStreamPoc2026!MustBeAtLeast32BytesLong";
var keyBytes = Encoding.UTF8.GetBytes(secretKey);

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = false;
    options.SaveToken = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(keyBytes),
        ValidateIssuer = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "FastReport.WebEditor.Backend",
        ValidateAudience = true,
        ValidAudience = builder.Configuration["Jwt:Audience"] ?? "FastReport.WebEditor.Client",
        ClockSkew = TimeSpan.Zero
    };

    // Allow JWT passed via query param (e.g. for SSE or iframe downloads)
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"].FirstOrDefault();
            if (!string.IsNullOrEmpty(accessToken))
            {
                context.Token = accessToken;
            }
            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("Admin"));
});

// 6. CORS for testinglab.local & localhost
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

// 7. Initialize Database (Schema & Admin Seeding)
using (var scope = app.Services.CreateScope())
{
    var initializer = scope.ServiceProvider.GetRequiredService<DbInitializer>();
    await initializer.InitializeAsync();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// 8. Map Minimal API Endpoint Groups
app.MapGroup("/api/auth").MapAuthEndpoints();
app.MapGroup("/api/reports").RequireAuthorization().MapReportsEndpoints();
app.MapGroup("/api/history").RequireAuthorization().MapHistoryEndpoints();
app.MapGroup("/api/recovery").RequireAuthorization().MapRecoveryEndpoints();
app.MapGroup("/api/session").MapSessionEndpoints();

app.Run();
