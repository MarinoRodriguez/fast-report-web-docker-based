using System.Data;

namespace FastReport.WebEditor.Backend.Services.Interfaces;

public interface IFastReportPdfService
{
    byte[] GeneratePdf(string reportPath, DataSet? dataSet = null);
    byte[] GeneratePdfWithMockData(string reportPath, int mockRowCount = 25);
    byte[] GeneratePdfFromBytesWithMockData(byte[] reportBytes, int mockRowCount = 25);
}
