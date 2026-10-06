using System.Data;
using FastReport.Export.PdfSimple;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace FastReport.WebEditor.Backend.Services.Implementations;

public class FastReportPdfService : IFastReportPdfService
{
    private readonly IMockDataEngine _mockEngine;
    private readonly ILogger<FastReportPdfService> _logger;

    public FastReportPdfService(IMockDataEngine mockEngine, ILogger<FastReportPdfService> logger)
    {
        _mockEngine = mockEngine;
        _logger = logger;
    }

    public byte[] GeneratePdfWithMockData(string reportPath, int mockRowCount = 25)
    {
        DataSet? dataSet = null;
        try
        {
            dataSet = _mockEngine.GenerateMockDataSetFromReportFile(reportPath, mockRowCount);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[PDF SERVICE] No se pudieron generar datos mock. Continuando sin datos.");
        }

        if (dataSet != null && dataSet.Tables.Count == 0)
        {
            dataSet = null;
        }

        return GeneratePdf(reportPath, dataSet);
    }

    public byte[] GeneratePdfFromBytesWithMockData(byte[] reportBytes, int mockRowCount = 25)
    {
        DataSet? dataSet = null;
        try
        {
            using var streamForMock = new MemoryStream(reportBytes);
            dataSet = _mockEngine.GenerateMockDataSetFromStream(streamForMock, mockRowCount);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[PDF SERVICE] No se pudieron generar datos mock. Continuando sin datos.");
        }

        if (dataSet != null && dataSet.Tables.Count == 0)
        {
            dataSet = null;
        }

        return CompilePdf(report =>
        {
            using var ms = new MemoryStream(reportBytes);
            report.Load(ms);
        }, dataSet);
    }

    public byte[] GeneratePdf(string reportPath, DataSet? dataSet = null)
    {
        if (!File.Exists(reportPath))
        {
            throw new FileNotFoundException($"El archivo de reporte no existe en la ruta: {reportPath}");
        }

        return CompilePdf(report => report.Load(reportPath), dataSet);
    }

    private byte[] CompilePdf(Action<global::FastReport.Report> loadAction, DataSet? dataSet)
    {
        using var report = new global::FastReport.Report();

        // 1. Load report template first
        loadAction(report);

        // 2. Register mock data if provided
        if (dataSet != null && dataSet.Tables.Count > 0)
        {
            // Gather all prefixes from existing TableDataSources (e.g. "NorthWind" from "NorthWind.Employees")
            var prefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var existingDataSources = report.Dictionary.DataSources.Cast<global::FastReport.Data.DataSourceBase>().ToList();
            foreach (var ds in existingDataSources)
            {
                if (ds is global::FastReport.Data.TableDataSource tableDs)
                {
                    if (!string.IsNullOrEmpty(tableDs.ReferenceName) && tableDs.ReferenceName.Contains('.'))
                    {
                        var prefix = tableDs.ReferenceName.Split('.')[0];
                        prefixes.Add(prefix);
                    }
                }
            }

            // Register DataSet under each prefix found in report definition
            foreach (var prefix in prefixes)
            {
                report.RegisterData(dataSet, prefix);
            }

            // Register DataSet by its own name
            if (!string.IsNullOrEmpty(dataSet.DataSetName))
            {
                report.RegisterData(dataSet, dataSet.DataSetName);
            }

            // Register individual tables
            foreach (DataTable table in dataSet.Tables)
            {
                report.RegisterData(table, table.TableName);
            }

            // Enable all data sources in dictionary
            foreach (var ds in report.Dictionary.DataSources.Cast<global::FastReport.Data.DataSourceBase>())
            {
                ds.Enabled = true;
            }
        }

        report.Prepare();

        using var ms = new MemoryStream();
        using var pdfExport = new PDFSimpleExport();
        pdfExport.Export(report, ms);

        _logger.LogInformation("[PDF SERVICE] Reporte compilado a PDF ({Bytes} bytes).", ms.Length);
        return ms.ToArray();
    }
}
