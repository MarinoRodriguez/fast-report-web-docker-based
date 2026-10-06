using System.Security.Claims;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace FastReport.WebEditor.Backend.Endpoints;

public static class HistoryEndpoints
{
    public static RouteGroupBuilder MapHistoryEndpoints(this RouteGroupBuilder group)
    {
        // 1. List history versions
        group.MapGet("/", async (string? filename, string? reportName, IHistoryRepository repository) =>
        {
            var list = await repository.GetHistoryForReportAsync(filename, reportName);
            return Results.Ok(new { count = list.Count(), history = list });
        });

        // 2. Download historical version snapshot
        group.MapGet("/{id}/download", async (string id, IHistoryRepository repository) =>
        {
            var item = await repository.GetByIdAsync(id);
            if (item == null)
            {
                return Results.NotFound(new { error = "Registro de historial no encontrado." });
            }

            var filePath = Path.Combine("wwwroot", "history", item.Filename);
            if (!File.Exists(filePath))
            {
                var legacyPath = Path.Combine("storage", "history", item.Filename);
                if (File.Exists(legacyPath))
                {
                    filePath = legacyPath;
                }
                else
                {
                    return Results.NotFound(new { error = "El archivo físico de la versión histórica no existe en el servidor." });
                }
            }

            var downloadName = $"{item.ReportName}_{item.VersionLabel}.frx";
            return Results.File(filePath, "application/octet-stream", downloadName);
        });

        // 3. Restore historical version as current master report
        group.MapPost("/{id}/restore", async (
            string id,
            IHistoryRepository historyRepository,
            IReportRepository reportRepository,
            ClaimsPrincipal userPrincipal) =>
        {
            var item = await historyRepository.GetByIdAsync(id);
            if (item == null)
            {
                return Results.NotFound(new { error = "Versión histórica no encontrada." });
            }

            var sourcePath = Path.Combine("wwwroot", "history", item.Filename);
            if (!File.Exists(sourcePath))
            {
                var legacyPath = Path.Combine("storage", "history", item.Filename);
                if (File.Exists(legacyPath))
                {
                    sourcePath = legacyPath;
                }
                else
                {
                    return Results.NotFound(new { error = "El archivo físico de la versión histórica no existe." });
                }
            }

            var reportBytes = await File.ReadAllBytesAsync(sourcePath);
            var targetReportPath = Path.Combine("wwwroot", "reports", item.OriginalFilename);
            await File.WriteAllBytesAsync(targetReportPath, reportBytes);

            var username = userPrincipal.FindFirstValue(ClaimTypes.Name);
            if (string.IsNullOrWhiteSpace(username))
            {
                return Results.Unauthorized();
            }
            var userToken = username;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var dateStr = DateTime.UtcNow.ToString("g");

            // Update master report in SQLite
            var existingRep = await reportRepository.GetByFilenameAsync(item.OriginalFilename);
            if (existingRep != null)
            {
                existingRep.SizeKb = Math.Round(reportBytes.Length / 1024.0, 1);
                existingRep.ModifiedAt = dateStr;
                existingRep.ModifiedTimestamp = now;
                await reportRepository.UpdateAsync(existingRep);
            }

            // Generate new audit version in ReportHistory
            var nextVer = await historyRepository.GetNextVersionNumberAsync(item.ReportName, item.OriginalFilename);
            var versionLabel = $"v{nextVer}";
            var newHistFilename = $"hist_{now}_{item.OriginalFilename.Replace(".frx", "")}_{versionLabel}.frx";
            var newHistPath = Path.Combine("wwwroot", "history", newHistFilename);
            await File.WriteAllBytesAsync(newHistPath, reportBytes);

            var auditEntry = new ReportHistoryItem
            {
                Id = "hist_" + Guid.NewGuid().ToString("N")[..12],
                ReportName = item.ReportName,
                OriginalFilename = item.OriginalFilename,
                Version = nextVer,
                VersionLabel = versionLabel,
                Filename = newHistFilename,
                UserToken = userToken,
                Comment = $"Restaurado a partir de {item.VersionLabel} por {userToken}",
                Timestamp = now,
                Date = dateStr,
                SizeKb = Math.Round(reportBytes.Length / 1024.0, 1)
            };
            await historyRepository.CreateAsync(auditEntry);

            return Results.Ok(new
            {
                success = true,
                message = $"El reporte '{item.OriginalFilename}' fue restaurado exitosamente a la versión {item.VersionLabel} (registrada como {versionLabel}).",
                newVersion = versionLabel
            });
        });

        return group;
    }
}
