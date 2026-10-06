using System.Text;
using System.Xml;
using FastReport.WebEditor.Backend.Services.Interfaces;

namespace FastReport.WebEditor.Backend.Services.Implementations;

public class FileSecurityValidator : IFileSecurityValidator
{
    private static readonly string[] AllowedExtensions = { ".frx" };
    private static readonly string[] AllowedMimeTypes = {
        "application/xml",
        "text/xml",
        "application/octet-stream",
        "text/plain"
    };

    public bool ValidateFrx(byte[] fileBytes, string filename, string? contentType, out string? errorMessage)
    {
        errorMessage = null;

        // 1. Size sanity check
        if (fileBytes == null || fileBytes.Length < 16)
        {
            errorMessage = "El archivo está vacío o es demasiado pequeño para ser un formato válido.";
            return false;
        }

        if (fileBytes.Length > 10 * 1024 * 1024) // 10MB max limit
        {
            errorMessage = "El archivo excede el tamaño máximo permitido (10 MB).";
            return false;
        }

        // 2. Validate Extension
        var ext = Path.GetExtension(filename);
        if (string.IsNullOrEmpty(ext) || !AllowedExtensions.Contains(ext.ToLowerInvariant()))
        {
            errorMessage = "Extensión no permitida. Únicamente se admiten archivos con extensión '.frx'.";
            return false;
        }

        // 3. Validate MIME type if provided
        if (!string.IsNullOrEmpty(contentType))
        {
            var cleanMime = contentType.Split(';')[0].Trim().ToLowerInvariant();
            if (!AllowedMimeTypes.Contains(cleanMime))
            {
                errorMessage = $"Tipo MIME '{cleanMime}' no admitido para formatos de reporte FastReport.";
                return false;
            }
        }

        // 4. Magic Bytes / Header check
        // Check for binary executables signatures (MZ, ELF, etc.) to immediately reject
        if (fileBytes.Length >= 2 && fileBytes[0] == 0x4D && fileBytes[1] == 0x5A) // MZ header
        {
            errorMessage = "Archivo rechazado: contiene una firma de ejecutable binario (PE/MZ).";
            return false;
        }
        if (fileBytes.Length >= 4 && fileBytes[0] == 0x7F && fileBytes[1] == 0x45 && fileBytes[2] == 0x4C && fileBytes[3] == 0x46) // ELF
        {
            errorMessage = "Archivo rechazado: contiene una firma de ejecutable binario (ELF).";
            return false;
        }

        // Decode first 512 bytes as string to verify XML start
        var headerChunk = Encoding.UTF8.GetString(fileBytes, 0, Math.Min(fileBytes.Length, 512)).TrimStart();
        // Skip BOM if present
        if (headerChunk.StartsWith('\uFEFF'))
        {
            headerChunk = headerChunk[1..].TrimStart();
        }

        if (!headerChunk.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) &&
            !headerChunk.StartsWith("<Report", StringComparison.OrdinalIgnoreCase))
        {
            errorMessage = "Cabecera inválida. Los archivos FastReport .frx deben comenzar con '<?xml' o '<Report'.";
            return false;
        }

        // 5. XML Syntax and Root Element Verification (preventing XXE & XML bombs)
        try
        {
            using var ms = new MemoryStream(fileBytes);
            var settings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit, // Strictly prevent XXE injection
                XmlResolver = null,
                MaxCharactersInDocument = 10 * 1024 * 1024
            };

            using var reader = XmlReader.Create(ms, settings);
            bool foundReportRoot = false;

            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.Element)
                {
                    if (string.Equals(reader.LocalName, "Report", StringComparison.OrdinalIgnoreCase))
                    {
                        foundReportRoot = true;
                    }
                    break;
                }
            }

            if (!foundReportRoot)
            {
                errorMessage = "Estructura no válida: El elemento raíz del archivo XML debe ser estrictamente '<Report>'.";
                return false;
            }
        }
        catch (XmlException ex)
        {
            errorMessage = $"Estructura XML malformada o dañada: {ex.Message}";
            return false;
        }
        catch (Exception ex)
        {
            errorMessage = $"Error al validar el contenido del archivo: {ex.Message}";
            return false;
        }

        return true;
    }
}
