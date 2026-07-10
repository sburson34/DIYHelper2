namespace DIYHelper2.Api.Models;

/// <summary>
/// A field technician for a white-label brand. Techs don't use the web Owner
/// Console — they sign into a "tech mode" in the mobile app with a short login
/// code the owner generates (stored here BCrypt-hashed, never in the clear).
/// A successful login mints a signed bearer token (see
/// <see cref="Services.TechTokenService"/>) scoping every <c>/api/tech/*</c> call
/// to this technician + brand.
///
/// <para>Tenant model matches the rest of the schema: a denormalized lowercase
/// <see cref="Brand"/> slug (no FK), sourced from the <c>X-Brand</c> header.</para>
/// </summary>
public class Technician : IBrandOwned
{
    public int Id { get; set; }

    public string Brand { get; set; } = "diyhelper";

    public string Name { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }

    /// <summary>BCrypt hash of the tech's login code
    /// (<see cref="Sburson.Shared.Auth.PasswordHasher"/>). Null → the tech can't
    /// log in yet (owner hasn't issued a code). The plaintext code is shown to
    /// the owner exactly once at generation time and never stored.</summary>
    public string? LoginCodeHash { get; set; }

    /// <summary>Fail-closed: an inactive tech can't log in and is hidden from the
    /// assignment picker, but their historical job assignments are preserved.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
