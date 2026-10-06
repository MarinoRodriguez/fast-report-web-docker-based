using System.Security.Claims;
using FastReport.WebEditor.Backend.Models;
using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace FastReport.WebEditor.Backend.Endpoints;

public static class SessionEndpoints
{
    public static RouteGroupBuilder MapSessionEndpoints(this RouteGroupBuilder group)
    {
        // 1. Start streaming session (Docker container with 2MB tmpfs RAM)
        group.MapPost("/start", async (
            StartSessionRequest request,
            IDockerOrchestratorService orchestrator,
            ClaimsPrincipal userPrincipal,
            HttpRequest httpRequest) =>
        {
            var userToken = userPrincipal.FindFirstValue(ClaimTypes.Name) 
                ?? httpRequest.Headers["x-auth-token"].FirstOrDefault() 
                ?? "demo-user-123";

            try
            {
                var response = await orchestrator.StartSessionAsync(request, userToken);
                return Results.Ok(response);
            }
            catch (ArgumentException aex)
            {
                return Results.BadRequest(new { error = aex.Message });
            }
            catch (FileNotFoundException fnf)
            {
                return Results.NotFound(new { error = fnf.Message });
            }
            catch (Exception ex)
            {
                return Results.Problem(detail: ex.Message, title: "Error al iniciar sesión en contenedor", statusCode: 500);
            }
        });

        // 2. Check pending / uncommitted changes for a report (User isolated)
        group.MapGet("/check-pending", async (
            string? filename,
            string? reportName,
            IDockerOrchestratorService orchestrator,
            IRecoveryRepository recoveryRepository,
            ClaimsPrincipal userPrincipal,
            HttpRequest httpRequest) =>
        {
            var userToken = userPrincipal.FindFirstValue(ClaimTypes.Name) 
                ?? httpRequest.Headers["x-auth-token"].FirstOrDefault() 
                ?? "demo-user-123";

            if (string.IsNullOrWhiteSpace(filename) && string.IsNullOrWhiteSpace(reportName))
            {
                return Results.BadRequest(new { error = "Parámetros filename o reportName requeridos." });
            }

            var activeSessions = orchestrator.GetActiveSessions().ToList();
            var cleanBase = (filename ?? "").Replace(".frx", "", StringComparison.OrdinalIgnoreCase).Trim();
            var cleanName = (reportName ?? "").Trim();

            var matchingSessions = activeSessions.Where(s =>
                (!string.IsNullOrEmpty(s.OriginalFilename) && !string.IsNullOrEmpty(filename) && s.OriginalFilename.Equals(filename, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(s.SourceReport) && !string.IsNullOrEmpty(cleanName) && s.SourceReport.Equals(cleanName, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(s.SourceReport) && !string.IsNullOrEmpty(cleanBase) && s.SourceReport.Contains(cleanBase, StringComparison.OrdinalIgnoreCase))
            ).ToList();

            // A. Check if the CURRENT user has an active session for this report
            var currentUserSession = matchingSessions.FirstOrDefault(s => s.UserToken.Equals(userToken, StringComparison.OrdinalIgnoreCase));
            if (currentUserSession != null)
            {
                return Results.Ok(new
                {
                    hasPending = true,
                    pendingType = "session",
                    isOwnSession = true,
                    userToken = currentUserSession.UserToken,
                    sessionId = currentUserSession.SessionId,
                    sessionStatus = currentUserSession.Status,
                    reportName = currentUserSession.SourceReport,
                    timestamp = currentUserSession.LastHeartbeat,
                    date = DateTimeOffset.FromUnixTimeMilliseconds(currentUserSession.LastHeartbeat).LocalDateTime.ToString("g"),
                    message = $"Tienes una sesión previa ({currentUserSession.Status}) con cambios recientes para este reporte."
                });
            }

            // B. Check if the CURRENT user has an uncommitted recovered file
            if (!string.IsNullOrEmpty(filename))
            {
                var userRecovery = await recoveryRepository.GetPendingForReportAndUserAsync(filename, reportName, userToken);
                if (userRecovery != null)
                {
                    return Results.Ok(new
                    {
                        hasPending = true,
                        pendingType = "recovery",
                        isOwnSession = true,
                        userToken = userRecovery.UserToken,
                        recoveryId = userRecovery.Id,
                        recoveryFilename = userRecovery.Filename,
                        reportName = userRecovery.Name,
                        sizeKb = userRecovery.SizeKb,
                        timestamp = userRecovery.Timestamp,
                        date = userRecovery.Date,
                        message = "Se encontró una versión auto-guardada de una sesión anterior tuya que no fue guardada formalmente."
                    });
                }
            }

            // C. Multi-user concurrency notice: if another user is editing, notify without blocking
            var otherUsers = matchingSessions
                .Where(s => !s.UserToken.Equals(userToken, StringComparison.OrdinalIgnoreCase))
                .Select(s => s.UserToken)
                .Distinct()
                .ToList();

            if (otherUsers.Any())
            {
                return Results.Ok(new
                {
                    hasPending = false,
                    concurrentNotice = true,
                    otherUsers,
                    message = $"Aviso: El usuario '{otherUsers.First()}' está editando este reporte en su propia sesión aislada."
                });
            }

            return Results.Ok(new { hasPending = false });
        });

        // 3. Resume session in standby
        group.MapGet("/resume/{sessionId}", async (
            string sessionId,
            IDockerOrchestratorService orchestrator,
            ClaimsPrincipal userPrincipal,
            HttpRequest httpRequest) =>
        {
            var userToken = userPrincipal.FindFirstValue(ClaimTypes.Name) 
                ?? httpRequest.Headers["x-auth-token"].FirstOrDefault() 
                ?? "demo-user-123";

            var session = await orchestrator.ResumeSessionAsync(sessionId, userToken);
            if (session == null)
            {
                return Results.NotFound(new { error = "Sesión no encontrada o ya expirada." });
            }

            return Results.Ok(session);
        });

        // 4. Stop session (save or discard report from RAM tmpfs, stop container)
        group.MapPost("/stop", async (
            StopSessionRequest request,
            IDockerOrchestratorService orchestrator,
            ClaimsPrincipal userPrincipal,
            HttpRequest httpRequest) =>
        {
            var userToken = userPrincipal.FindFirstValue(ClaimTypes.Name) 
                ?? httpRequest.Headers["x-auth-token"].FirstOrDefault() 
                ?? "demo-user-123";

            var result = await orchestrator.StopSessionAsync(request, userToken);
            return Results.Ok(new
            {
                success = result.Success,
                sessionId = request.SessionId,
                saved = request.Save,
                savedReportName = result.SavedReportName,
                message = result.Message
            });
        });

        // 5. Heartbeat
        group.MapPost("/heartbeat", (HeartbeatRequest request, IDockerOrchestratorService orchestrator) =>
        {
            var ok = orchestrator.UpdateHeartbeat(request.SessionId);
            return ok ? Results.Ok(new { success = true }) : Results.NotFound(new { error = "Sesión no encontrada." });
        });

        // 6. Load new format into running container RAM
        group.MapPost("/load-format", async (LoadFormatRequest request, IDockerOrchestratorService orchestrator) =>
        {
            var success = await orchestrator.LoadFormatIntoSessionAsync(request);
            if (!success)
            {
                return Results.BadRequest(new { error = "No se pudo cargar el formato en la sesión indicada." });
            }
            return Results.Ok(new { success = true, message = "Formato cargado en el espacio de trabajo del diseñador." });
        });

        // 7. Active sessions list
        group.MapGet("/active", (IDockerOrchestratorService orchestrator) =>
        {
            var sessions = orchestrator.GetActiveSessions();
            return Results.Ok(new { count = sessions.Count(), sessions });
        });

        // 8. Download report directly from RAM tmpfs
        group.MapGet("/{sessionId}/download-ram", async (string sessionId, IDockerOrchestratorService orchestrator) =>
        {
            try
            {
                var bytes = await orchestrator.DownloadRamReportAsync(sessionId);
                var session = orchestrator.GetSession(sessionId);
                var downloadName = (session?.SourceReport ?? "reporte_sesion") + "_pendiente.frx";
                return Results.File(bytes, "application/octet-stream", downloadName);
            }
            catch (Exception ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
        });

        // 9. Intercepted URL from Wine via url-redirector.sh
        group.MapPost("/{sessionId}/open-url", (
            string sessionId,
            HttpContext context,
            IDockerOrchestratorService orchestrator,
            OpenUrlPayload payload) =>
        {
            if (string.IsNullOrWhiteSpace(payload.Url))
            {
                return Results.BadRequest(new { error = "Falta el parámetro url." });
            }

            orchestrator.BroadcastUrlToSession(sessionId, payload.Url, payload.Source ?? "wine");
            return Results.Ok(new { success = true, url = payload.Url });
        });

        // 10. SSE Stream for session events
        group.MapGet("/events/{sessionId}", async (string sessionId, HttpContext context, IDockerOrchestratorService orchestrator) =>
        {
            context.Response.Headers.Append("Content-Type", "text/event-stream");
            context.Response.Headers.Append("Cache-Control", "no-cache");
            context.Response.Headers.Append("Connection", "keep-alive");

            await context.Response.WriteAsync($"event: connected\ndata: {{\"message\":\"SSE Conectado al Orquestador .NET 9\",\"sessionId\":\"{sessionId}\"}}\n\n");
            await context.Response.Body.FlushAsync();

            orchestrator.RegisterSseClient(sessionId, context.Response, context.RequestAborted);

            // Keep connection alive with pings
            while (!context.RequestAborted.IsCancellationRequested)
            {
                await Task.Delay(15000, context.RequestAborted);
                try
                {
                    await context.Response.WriteAsync(": ping\n\n", context.RequestAborted);
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                }
                catch (_) { break; }
            }
        });

        return group;
    }
}

public record OpenUrlPayload(string Url, string? Source);
