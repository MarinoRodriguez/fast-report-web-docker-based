using Dapper;
using FastReport.WebEditor.Backend.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace FastReport.WebEditor.Backend.Data;

public class DbInitializer
{
    private readonly IDbConnectionFactory _connectionFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DbInitializer> _logger;

    public DbInitializer(
        IDbConnectionFactory connectionFactory,
        IConfiguration configuration,
        ILogger<DbInitializer> logger)
    {
        _connectionFactory = connectionFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task InitializeAsync()
    {
        // 1. Ensure storage directories exist
        Directory.CreateDirectory("storage");
        Directory.CreateDirectory("wwwroot");
        Directory.CreateDirectory("wwwroot/reports");
        Directory.CreateDirectory("wwwroot/history");
        Directory.CreateDirectory("wwwroot/recovery");

        // Ensure default blank template exists on disk in wwwroot/reports/blank.frx
        var blankReportPath = Path.Combine("wwwroot", "reports", "blank.frx");
        if (!File.Exists(blankReportPath) || new FileInfo(blankReportPath).Length == 0)
        {
            const string defaultBlankXml = """
<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp" ReportInfo.Created="10/05/2026 15:13:41" ReportInfo.Modified="10/05/2026 15:14:55" ReportInfo.CreatorVersion="2025.1.0.0">
  <Dictionary/>
  <ReportPage Name="Page1" Watermark.Font="Arial, 60pt">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Text1" Width="245.7" Height="28.35" Text="Blank Report" Font="Arial, 18pt, style=Bold"/>
    </ReportTitleBand>
    <PageHeaderBand Name="PageHeader1" Top="41.8" Width="718.2" Height="28.35"/>
    <DataBand Name="Data1" Top="74.15" Width="718.2" Height="75.6"/>
    <PageFooterBand Name="PageFooter1" Top="153.75" Width="718.2" Height="18.9"/>
  </ReportPage>
</Report>
""";
            await File.WriteAllTextAsync(blankReportPath, defaultBlankXml);
            _logger.LogInformation("[DB INITIALIZER] Plantilla 'blank.frx' auto-generada exitosamente en wwwroot/reports.");
        }

        using var connection = _connectionFactory.CreateConnection();

        // 2. Create tables
        const string createTablesSql = @"
        CREATE TABLE IF NOT EXISTS Users (
            Id TEXT PRIMARY KEY,
            Username TEXT UNIQUE NOT NULL,
            Email TEXT UNIQUE NOT NULL,
            PasswordHash TEXT NOT NULL,
            Role TEXT NOT NULL DEFAULT 'User',
            CreatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS RefreshTokens (
            Id TEXT PRIMARY KEY,
            UserId TEXT NOT NULL,
            Token TEXT UNIQUE NOT NULL,
            ExpiresAt TEXT NOT NULL,
            IsRevoked INTEGER NOT NULL DEFAULT 0,
            CreatedAt TEXT NOT NULL,
            FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Reports (
            Id TEXT PRIMARY KEY,
            Name TEXT NOT NULL,
            Filename TEXT NOT NULL UNIQUE,
            SizeKb REAL NOT NULL,
            ModifiedAt TEXT NOT NULL,
            ModifiedTimestamp INTEGER NOT NULL,
            CreatedAt TEXT NOT NULL,
            IsDeleted INTEGER NOT NULL DEFAULT 0,
            DeletedAt TEXT NULL,
            CreatedByUserId TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS ReportHistory (
            Id TEXT PRIMARY KEY,
            ReportName TEXT NOT NULL,
            OriginalFilename TEXT NOT NULL,
            Version INTEGER NOT NULL,
            VersionLabel TEXT NOT NULL,
            Filename TEXT NOT NULL UNIQUE,
            UserToken TEXT NOT NULL,
            Comment TEXT NULL,
            Timestamp INTEGER NOT NULL,
            Date TEXT NOT NULL,
            SizeKb REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS RecoveryFiles (
            Id TEXT PRIMARY KEY,
            Name TEXT NOT NULL,
            Filename TEXT NOT NULL UNIQUE,
            OriginalFilename TEXT NULL,
            UserToken TEXT NOT NULL,
            SizeKb REAL NOT NULL,
            Timestamp INTEGER NOT NULL,
            Date TEXT NOT NULL,
            SourceSession TEXT NOT NULL
        );
        ";

        await connection.ExecuteAsync(createTablesSql);
        _logger.LogInformation("[DB INITIALIZER] SQLite database schema initialized successfully.");

        // 3. Seed default Admin user
        var adminUsername = _configuration["AdminUser:Username"] ?? "admin";
        var adminEmail = _configuration["AdminUser:Email"] ?? "admin@fastreport.local";
        var adminPassword = _configuration["AdminUser:Password"] ?? "AdminPassword123!";

        var existingAdmin = await connection.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @Username LIMIT 1",
            new { Username = adminUsername }
        );

        if (existingAdmin == null)
        {
            var adminUser = new User
            {
                Id = "usr_" + Guid.NewGuid().ToString("N")[..12],
                Username = adminUsername,
                Email = adminEmail,
                PasswordHash = PasswordHasher.HashPassword(adminPassword),
                Role = "Admin",
                CreatedAt = DateTime.UtcNow.ToString("o")
            };

            await connection.ExecuteAsync(
                @"INSERT INTO Users (Id, Username, Email, PasswordHash, Role, CreatedAt)
                  VALUES (@Id, @Username, @Email, @PasswordHash, @Role, @CreatedAt)",
                adminUser
            );

            _logger.LogInformation("[DB INITIALIZER] Seeded default admin user '{AdminUsername}' successfully.", adminUsername);
        }

        // 4. Seed initial formats from wwwroot/reports if table is empty
        var reportCount = await connection.ExecuteScalarAsync<int>("SELECT COUNT(1) FROM Reports");
        if (reportCount == 0 && Directory.Exists("wwwroot/reports"))
        {
            var files = Directory.GetFiles("wwwroot/reports", "*.frx");
            foreach (var filePath in files)
            {
                var fileInfo = new FileInfo(filePath);
                var filename = fileInfo.Name;
                var reportName = Path.GetFileNameWithoutExtension(filename).Replace("_", " ");
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                await connection.ExecuteAsync(
                    @"INSERT INTO Reports (Id, Name, Filename, SizeKb, ModifiedAt, ModifiedTimestamp, CreatedAt, IsDeleted)
                      VALUES (@Id, @Name, @Filename, @SizeKb, @ModifiedAt, @ModifiedTimestamp, @CreatedAt, 0)",
                    new
                    {
                        Id = "rep_" + Guid.NewGuid().ToString("N")[..12],
                        Name = reportName,
                        Filename = filename,
                        SizeKb = Math.Round(fileInfo.Length / 1024.0, 1),
                        ModifiedAt = DateTime.UtcNow.ToString("g"),
                        ModifiedTimestamp = now,
                        CreatedAt = DateTime.UtcNow.ToString("o")
                    }
                );
            }
            _logger.LogInformation("[DB INITIALIZER] Seeded {Count} initial formats from wwwroot/reports into SQLite.", files.Length);
        }
    }
}

