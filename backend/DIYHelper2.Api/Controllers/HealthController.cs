using Microsoft.AspNetCore.Mvc;

namespace DIYHelper2.Api.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok("API Running");
    }

    [HttpPost("test-security")]
    public IActionResult TestSecurity([FromHeader(Name = "x-api-key")] string apiKey)
    {
        if (apiKey != "YOUR_SECRET_KEY")
            return Unauthorized();

        return Ok("Security check passed");
    }
}
