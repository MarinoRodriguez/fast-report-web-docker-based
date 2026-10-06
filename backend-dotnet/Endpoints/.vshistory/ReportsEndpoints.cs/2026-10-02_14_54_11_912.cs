using System.Security.Claims;
using System.Text;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace FastReport.WebEditor.Backend.Endpoints;

public static class ReportsEndpoints
{
    public static RouteGroupBuilder MapReportsEndpoints(this RouteGroupBuilder group)
    {
        // 1. List active reports
        group.MapGet("/", async (IReportRepository repository) =>
        {
            var list = await repository.GetAllActiveAsync();
            return Results.Ok(new { reports = list });
        });

        // 2. Upload and register new report format with Triple Security Check
        group.MapPost("/upload", async (
            IFormFile file,
            string? name,
            IReportRepository repository,
            IFileSecurityValidator validator,
            ClaimsPrincipal userPrincipal) =>
        {
            if (file == null || file.Length == 0)
            {
                return Results.BadRequest(new { error = "No se ha proporcionado ningún archivo para subir." });
            }

            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var fileBytes = ms.ToArray();

            // Triple security check (extension, mime, magic bytes & XML root)
            if (!validator.ValidateFrx(fileBytes, file.FileName, file.ContentType, out var errorMsg))
            {
                return Results.BadRequest(new { error = errorMsg });
            }

            var cleanName = string.IsNullOrWhiteSpace(name)
                ? Path.GetFileNameWithoutExtension(file.FileName)
                : name.Trim();

            var safeFilename = cleanName
                .Replace("/", "_")
                .Replace("\\", "_")
                .Replace(" ", "_") + ".frx";

            var targetPath = Path.Combine("wwwroot", "reports", safeFilename);
            await File.WriteAllBytesAsync(targetPath, fileBytes);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var dateStr = DateTime.UtcNow.ToString("g");
            var userToken = userPrincipal.FindFirstValue(ClaimTypes.Name) ?? "admin";

            var existing = await repository.GetByFilenameAsync(safeFilename);
            Models.Report reportItem;

            if (existing == null)
            {
                reportItem = new Models.Report
                {
                    Id = "rep_" + Guid.NewGuid().ToString("N")[..12],
                    Name = cleanName,
                    Filename = safeFilename,
                    SizeKb = Math.Round(fileBytes.Length / 1024.0, 1),
                    ModifiedAt = dateStr,
                    ModifiedTimestamp = now,
                    CreatedAt = DateTime.UtcNow.ToString("o"),
                    CreatedByUserId = userToken,
                    IsDeleted = false
                };
                await repository.CreateAsync(reportItem);
            }
            else
            {
                existing.Name = cleanName;
                existing.SizeKb = Math.Round(fileBytes.Length / 1024.0, 1);
                existing.ModifiedAt = dateStr;
                existing.ModifiedTimestamp = now;
                existing.IsDeleted = false;
                await repository.UpdateAsync(existing);
                reportItem = existing;
            }

            return Results.Ok(new { success = true, report = reportItem });
        }).DisableAntiforgery();

        // 3. Rename report record
        group.MapPost("/rename", async (
            RenameReportRequest request,
            IReportRepository repository) =>
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.NewName))
            {
                return Results.BadRequest(new { error = "El identificador y el nuevo nombre son obligatorios." });
            }

            var report = await repository.GetByIdAsync(request.Id);
            if (report == null)
            {
                return Results.NotFound(new { error = "Registro de formato no encontrado." });
            }

            report.Name = request.NewName.Trim();
            report.ModifiedAt = DateTime.UtcNow.ToString("g");
            report.ModifiedTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await repository.UpdateAsync(report);

            return Results.Ok(new { success = true, report });
        });

        // 4. Download report file (.frx)
        group.MapGet("/{id}/download", async (string id, IReportRepository repository) =>
        {
            var report = await repository.GetByIdAsync(id);
            var filename = report?.Filename ?? (id.EndsWith(".frx", StringComparison.OrdinalIgnoreCase) ? id : id + ".frx");
            var filePath = Path.Combine("wwwroot", "reports", filename);

            if (!File.Exists(filePath))
            {
                var legacyPath = Path.Combine("storage", "saved_reports", filename);
                if (File.Exists(legacyPath))
                {
                    filePath = legacyPath;
                }
                else
                {
                    return Results.NotFound(new { error = "Archivo de formato no encontrado en el servidor." });
                }
            }

            var downloadName = report != null ? $"{report.Name}.frx" : filename;
            return Results.File(filePath, "application/octet-stream", downloadName);
        });

        // 5. Delete report (Admin role required)
        group.MapDelete("/{id}", async (string id, IReportRepository repository) =>
        {
            var report = await repository.GetByIdAsync(id);
            if (report == null)
            {
                return Results.NotFound(new { error = "Formato no encontrado." });
            }

            await repository.SoftDeleteAsync(report.Id);
            return Results.Ok(new { success = true, message = $"Formato '{report.Name}' eliminado de la lista (archivo conservado en el servidor)." });
        }).RequireAuthorization(policy => policy.RequireRole("Admin"));

        // 6. Generate PDF with FastReport & Mock Data Option
        group.MapPost("/{id}/generate-pdf", async (
            string id,
            GeneratePdfRequest? pdfRequest,
            IReportRepository repository,
            IFastReportPdfService pdfService) =>
        {
            var report = await repository.GetByIdAsync(id);
            var filename = report?.Filename ?? (id.EndsWith(".frx", StringComparison.OrdinalIgnoreCase) ? id : id + ".frx");
            var filePath = Path.Combine("wwwroot", "reports", filename);

            if (!File.Exists(filePath))
            {
                var legacyPath = Path.Combine("storage", "saved_reports", filename);
                if (File.Exists(legacyPath))
                {
                    filePath = legacyPath;
                }
                else
                {
                    return Results.NotFound(new { error = $"El archivo de formato '{filename}' no existe en el servidor." });
                }
            }

            try
            {
                var req = pdfRequest ?? new GeneratePdfRequest();
                byte[] pdfBytes;

                if (req.UseMockData)
                {
                    pdfBytes = pdfService.GeneratePdfWithMockData(filePath, req.MockRowCount > 0 ? req.MockRowCount : 25);
                }
                else
                {
                    pdfBytes = pdfService.GeneratePdf(filePath, null);
                }

                var outputName = (report?.Name ?? Path.GetFileNameWithoutExtension(filename)) + ".pdf";
                return Results.File(pdfBytes, "application/pdf", outputName);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    detail: ex.Message,
                    title: "Error al generar PDF con FastReport",
                    statusCode: StatusCodes.Status500InternalServerError
                );
            }
        });

        return group;
    }
}
