namespace DIYHelper2.Api.Validation;

/// <summary>
/// Wraps user-supplied text in delimiter tags so the surrounding system /
/// user prompt cannot be syntactically escaped by a hostile description.
///
/// Naked `"description: \"{user}\""` interpolation lets an attacker who can
/// inject a literal `"` close the wrapper and pose as the developer turn —
/// the LLM is much more willing to follow instructions that look like they
/// came from the system. Wrapping in XML-style tags and stripping any
/// occurrences of the closing tag from the user payload removes that surface.
/// The system prompt for every AI endpoint instructs the model to treat
/// content inside these tags as untrusted DATA.
/// </summary>
public static class PromptSanitizer
{
    private const string OpenTag = "<user_input>";
    private const string CloseTag = "</user_input>";

    /// <summary>
    /// Returns the user text wrapped in opaque delimiter tags. Any occurrences
    /// of the opening or closing tag inside the payload are stripped so the
    /// boundaries cannot be forged. Null/empty input → empty wrapper, which is
    /// safe for the caller to interpolate without an additional null check.
    /// </summary>
    public static string Wrap(string? userText)
    {
        if (string.IsNullOrEmpty(userText)) return OpenTag + CloseTag;
        var cleaned = userText
            .Replace(OpenTag, "", System.StringComparison.OrdinalIgnoreCase)
            .Replace(CloseTag, "", System.StringComparison.OrdinalIgnoreCase);
        return OpenTag + cleaned + CloseTag;
    }
}
