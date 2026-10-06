using FastReport.WebEditor.Backend.Repositories.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace FastReport.WebEditor.Backend.Endpoints;

public static class RecoveryEndpoints
{
    public static RouteGroupBuilder MapRecoveryEndpoints(this RouteGroupBuilder group)
    {
        // 1. List recovered uncommitted documents (retention 7 days)
        group.MapGet("/", async (IRecoveryRepository repository) =>
        {
            var list = await repository.GetAllActiveAsync();
            return Results.Ok(new { count = list.Count(), recovered = list });
        });

        // 2. Download recovered document
        group.MapGet("/{id}/download", async (string id, IRecoveryRepository repository) =>
        {
            var item = await repository.GetByIdAsync(id);
            if (item == null)
            {
                return Results.NotFound(new { error = "Documento recuperado no encontrado." });
            }

            var filePath = Path.Combine("wwwroot", "recovery", item.Filename);
            if (!File.Exists(filePath))
            {
                var legacyPath = Path.Combine("storage", "recovery", item.Filename);
                if (File.Exists(legacyPath))
                {
                    filePath = legacyPath;
                }
                else
                {
                    return Results.NotFound(new { error = "El archivo físico no se encuentra en disco." });
                }
            }

            var downloadName = (item.Name.EndsWith(".frx", StringComparison.OrdinalIgnoreCase) ? item.Name.Replace(".frx", "") : item.Name) + "_recuperado.frx";
            return Results.File(filePath, "application/octet-stream", downloadName);
        });

        // 3. Discard recovered document
        group.MapDelete("/{id}", async (string id, IRecoveryRepository repository) =>
        {
            var item = await repository.GetByIdAsync(id);
            if (item == null)
            {
                return Results.NotFound(new { error = "Documento recuperado no encontrado." });
            }

            var filePath = Path.Combine("wwwroot", "recovery", item.Filename);
            if (File.Exists(filePath))
            {
                try { File.Delete(filePath); } catch {}
            }

            await repository.DeleteAsync(item.Id);
            return Results.Ok(new { success = true, message = $"Documento '{item.Name}' descartado." });
        });

        return group;
    }
}
