using FastReport.WebEditor.Backend.Repositories.Interfaces;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FastReport.WebEditor.Backend.Services;

public class StandbyMonitorHostedService : BackgroundService
{
    private readonly IDockerOrchestratorService _orchestrator;
    private readonly IRecoveryRepository _recoveryRepository;
    private readonly ILogger<StandbyMonitorHostedService> _logger;

    public StandbyMonitorHostedService(
        IDockerOrchestratorService orchestrator,
        IRecoveryRepository recoveryRepository,
        ILogger<StandbyMonitorHostedService> logger)
    {
        _orchestrator = orchestrator;
        _recoveryRepository = recoveryRepository;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[STANDBY MONITOR] Servicio de supervisión de sesiones y auto-guardado iniciado.");
        var lastPurgeTime = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // 1. Revisar desconexiones y expiraciones de standby cada 5 segundos
                await _orchestrator.CheckStandbySessionsAsync();

                // 2. Depuración horaria de documentos recuperados vencidos (> 7 días)
                if ((DateTime.UtcNow - lastPurgeTime).TotalHours >= 1)
                {
                    var purged = await _recoveryRepository.PurgeOlderThanDaysAsync(7);
                    if (purged > 0)
                    {
                        _logger.LogInformation("[STANDBY MONITOR] Depurados {Count} documentos recuperados con más de 7 días.", purged);
                    }
                    lastPurgeTime = DateTime.UtcNow;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[STANDBY MONITOR] Error en ciclo de supervisión.");
            }

            await Task.Delay(5000, stoppingToken);
        }
    }
}
