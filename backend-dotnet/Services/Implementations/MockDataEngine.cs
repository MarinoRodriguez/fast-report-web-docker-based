using System.Data;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Bogus;
using FastReport.WebEditor.Backend.Services.Interfaces;
using Microsoft.Extensions.Logging;
using DataSet = System.Data.DataSet;
using DataTable = System.Data.DataTable;

namespace FastReport.WebEditor.Backend.Services.Implementations;

public class MockDataEngine : IMockDataEngine
{
    private readonly ILogger<MockDataEngine> _logger;
    private static readonly byte[] DefaultPlaceholderPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAIAAAACAAQMAAAD58POIAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAABlJREFUOMtjYBgFo2AUjIJRMApGwSigBwAETgAB52x2ZgAAAABJRU5ErkJggg=="
    ); // Minimal valid PNG byte stream (128x128)

    public MockDataEngine(ILogger<MockDataEngine> logger)
    {
        _logger = logger;
    }

    public DataSet GenerateMockDataSetFromReportFile(string reportFilePath, int rowCount = 25)
    {
        if (!File.Exists(reportFilePath))
        {
            throw new FileNotFoundException($"No se encontró el archivo de reporte en: {reportFilePath}");
        }

        using var fs = File.OpenRead(reportFilePath);
        return GenerateMockDataSetFromStream(fs, rowCount);
    }

    public DataSet GenerateMockDataSetFromReportXml(string reportXmlContent, int rowCount = 25)
    {
        if (string.IsNullOrWhiteSpace(reportXmlContent))
        {
            return new DataSet("ReportData");
        }

        var cleanXml = reportXmlContent.Trim().TrimStart('\uFEFF');
        using var ms = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(cleanXml));
        return GenerateMockDataSetFromStream(ms, rowCount);
    }

    public DataSet GenerateMockDataSetFromStream(Stream reportStream, int rowCount = 25)
    {
        var dataSet = new DataSet("ReportData");
        var faker = new Faker("es");

        XDocument doc;
        try
        {
            doc = XDocument.Load(reportStream);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[MOCK ENGINE] Error al parsear XML del reporte desde Stream.");
            throw new InvalidOperationException($"Error al parsear el XML del reporte para generar datos mock: {ex.Message}", ex);
        }

        // Buscar en el diccionario cualquier elemento que contenga "DataSource"
        var dictionaryNode = doc.Descendants().FirstOrDefault(e => e.Name.LocalName.Equals("Dictionary", StringComparison.OrdinalIgnoreCase));
        if (dictionaryNode == null)
        {
            throw new InvalidOperationException("La plantilla del reporte no contiene un nodo <Dictionary> válido para extraer orígenes de datos mock.");
        }

        var dataSourceNodes = dictionaryNode.Descendants()
            .Where(e => e.Name.LocalName.Contains("DataSource", StringComparison.OrdinalIgnoreCase)
                     || e.Elements().Any(c => c.Name.LocalName.Equals("Column", StringComparison.OrdinalIgnoreCase)))
            .ToList();

        foreach (var dsNode in dataSourceNodes)
        {
            var dsName = dsNode.Attribute("Name")?.Value;
            if (string.IsNullOrWhiteSpace(dsName)) continue;

            // Evitar duplicados si ya fue agregado al DataSet
            if (dataSet.Tables.Contains(dsName)) continue;

            var columnNodes = dsNode.Elements()
                .Where(e => e.Name.LocalName.Equals("Column", StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (!columnNodes.Any()) continue;

            var table = new DataTable(dsName);
            var columnDefinitions = new List<(string Name, Type DataType)>();

            foreach (var colNode in columnNodes)
            {
                var colName = colNode.Attribute("Name")?.Value;
                if (string.IsNullOrWhiteSpace(colName)) continue;

                var typeStr = colNode.Attribute("DataType")?.Value ?? "System.String";
                var colType = ResolveClrType(typeStr);

                if (!table.Columns.Contains(colName))
                {
                    table.Columns.Add(colName, colType);
                    columnDefinitions.Add((colName, colType));
                }
            }

            // Generar datos mock con Bogus para las filas solicitadas
            for (int i = 0; i < rowCount; i++)
            {
                var row = table.NewRow();
                foreach (var (colName, colType) in columnDefinitions)
                {
                    row[colName] = GenerateColumnValue(faker, colName, colType, i + 1);
                }
                table.Rows.Add(row);
            }

            dataSet.Tables.Add(table);
            _logger.LogInformation("[MOCK ENGINE] Generada tabla '{TableName}' con {ColumnCount} columnas y {RowCount} filas mock.",
                dsName, columnDefinitions.Count, rowCount);
        }

        if (dataSet.Tables.Count == 0)
        {
            throw new InvalidOperationException("No se encontró ningún origen de datos con columnas (<DataSource>/<Column>) en el diccionario del reporte para generar datos mock.");
        }

        return dataSet;
    }

    private static Type ResolveClrType(string typeName)
    {
        return typeName.ToLowerInvariant() switch
        {
            "system.int32" or "int32" or "int" => typeof(int),
            "system.int64" or "int64" or "long" => typeof(long),
            "system.decimal" or "decimal" => typeof(decimal),
            "system.double" or "double" => typeof(double),
            "system.single" or "float" => typeof(float),
            "system.datetime" or "datetime" => typeof(DateTime),
            "system.boolean" or "boolean" or "bool" => typeof(bool),
            "system.byte[]" or "byte[]" => typeof(byte[]),
            _ => typeof(string)
        };
    }

    private static object GenerateColumnValue(Faker faker, string colName, Type colType, int index)
    {
        var lower = colName.ToLowerInvariant();

        // 1. Arreglo de bytes (Imágenes, fotos, logos)
        if (colType == typeof(byte[]))
        {
            if (lower.Contains("photo") || lower.Contains("foto") || lower.Contains("avatar") ||
                lower.Contains("picture") || lower.Contains("image") || lower.Contains("logo") ||
                lower.Contains("perfil") || lower.Contains("img"))
            {
                return DefaultPlaceholderPngBytes;
            }
            return new byte[] { 0x01, 0x02, 0x03 };
        }

        // 2. Fechas
        if (colType == typeof(DateTime))
        {
            if (lower.Contains("birth") || lower.Contains("nac"))
                return faker.Date.Past(40, DateTime.UtcNow.AddYears(-20));
            if (lower.Contains("hire") || lower.Contains("ingreso") || lower.Contains("crea"))
                return faker.Date.Past(5);
            return faker.Date.Recent(30);
        }

        // 3. Enteros
        if (colType == typeof(int) || colType == typeof(long))
        {
            if (lower.EndsWith("id") || lower.Equals("id"))
                return index;
            if (lower.Contains("qty") || lower.Contains("cant") || lower.Contains("stock") || lower.Contains("unidades"))
                return faker.Random.Int(1, 150);
            if (lower.Contains("age") || lower.Contains("edad"))
                return faker.Random.Int(20, 65);
            if (lower.Contains("year") || lower.Contains("ano") || lower.Contains("anio"))
                return faker.Random.Int(2022, 2026);
            return faker.Random.Int(10, 500);
        }

        // 4. Decimales / Moneda
        if (colType == typeof(decimal) || colType == typeof(double) || colType == typeof(float))
        {
            if (lower.Contains("price") || lower.Contains("precio") || lower.Contains("cost") || lower.Contains("costo"))
                return (decimal)Math.Round(faker.Random.Double(5.50, 450.00), 2);
            if (lower.Contains("salary") || lower.Contains("salario") || lower.Contains("sueldo"))
                return (decimal)Math.Round(faker.Random.Double(1500.00, 8500.00), 2);
            if (lower.Contains("total") || lower.Contains("subtotal") || lower.Contains("monto") || lower.Contains("amount"))
                return (decimal)Math.Round(faker.Random.Double(20.00, 2500.00), 2);
            if (lower.Contains("tax") || lower.Contains("iva") || lower.Contains("impuesto"))
                return (decimal)Math.Round(faker.Random.Double(1.00, 50.00), 2);
            return (decimal)Math.Round(faker.Random.Double(1.00, 100.00), 2);
        }

        // 5. Booleanos
        if (colType == typeof(bool))
        {
            return faker.Random.Bool();
        }

        // 6. Cadenas de texto con correspondencia semántica inteligente
        if (lower.Contains("firstname") || lower.Contains("primer_nombre"))
            return faker.Name.FirstName();
        if (lower.Contains("lastname") || lower.Contains("apellido"))
            return faker.Name.LastName();
        if (lower.Contains("fullname") || (lower.Contains("name") && !lower.Contains("company") && !lower.Contains("file")))
            return faker.Name.FullName();
        if (lower.Contains("email") || lower.Contains("correo"))
            return faker.Internet.Email();
        if (lower.Contains("phone") || lower.Contains("tel") || lower.Contains("cel"))
            return faker.Phone.PhoneNumber();
        if (lower.Contains("address") || lower.Contains("direccion") || lower.Contains("dir"))
            return faker.Address.StreetAddress();
        if (lower.Contains("city") || lower.Contains("ciudad"))
            return faker.Address.City();
        if (lower.Contains("country") || lower.Contains("pais"))
            return faker.Address.Country();
        if (lower.Contains("postal") || lower.Contains("zip"))
            return faker.Address.ZipCode();
        if (lower.Contains("company") || lower.Contains("empresa"))
            return faker.Company.CompanyName();
        if (lower.Contains("title") || lower.Contains("cargo") || lower.Contains("puesto"))
            return faker.Name.JobTitle();
        if (lower.Contains("department") || lower.Contains("departamento") || lower.Contains("depto"))
            return faker.Commerce.Department();
        if (lower.Contains("product") || lower.Contains("producto") || lower.Contains("articulo"))
            return faker.Commerce.ProductName();
        if (lower.Contains("sku") || lower.Contains("codigo") || lower.Contains("code"))
            return faker.Commerce.Ean8();
        if (lower.Contains("extension") || lower.Contains("ext"))
            return faker.Random.Int(100, 999).ToString();
        if (lower.Contains("status") || lower.Contains("estado"))
            return faker.PickRandom("Activo", "Pendiente", "Completado", "Aprobado");
        if (lower.Contains("notes") || lower.Contains("nota") || lower.Contains("observacion") || lower.Contains("description") || lower.Contains("desc"))
            return faker.Lorem.Sentence(4);

        return faker.Lorem.Word();
    }
}
