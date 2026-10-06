using System.Data;

namespace FastReport.WebEditor.Backend.Services.Interfaces;

public interface IMockDataEngine
{
    DataSet GenerateMockDataSetFromStream(Stream reportStream, int rowCount = 25);
    DataSet GenerateMockDataSetFromReportXml(string reportXmlContent, int rowCount = 25);
    DataSet GenerateMockDataSetFromReportFile(string reportFilePath, int rowCount = 25);
}
