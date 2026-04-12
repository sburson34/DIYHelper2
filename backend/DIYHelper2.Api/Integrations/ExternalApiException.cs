namespace DIYHelper2.Api.Integrations;

public class ExternalApiException : Exception
{
    public string Service { get; }
    public int? StatusCode { get; }

    public ExternalApiException(string service, string message, int? statusCode = null, Exception? inner = null)
        : base(message, inner)
    {
        Service = service;
        StatusCode = statusCode;
    }
}
