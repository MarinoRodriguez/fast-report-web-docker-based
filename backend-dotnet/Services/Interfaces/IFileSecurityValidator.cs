namespace FastReport.WebEditor.Backend.Services.Interfaces;

public interface IFileSecurityValidator
{
    bool ValidateFrx(byte[] fileBytes, string filename, string? contentType, out string? errorMessage);
}
