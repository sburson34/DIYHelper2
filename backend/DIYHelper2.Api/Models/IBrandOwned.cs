namespace DIYHelper2.Api.Models;

/// <summary>
/// A row owned by a single white-label brand (tenant). Lets the shared
/// tenant-scoping helpers (<c>EndpointHelpers.WhereBrandVisible</c> /
/// <c>CrossTenant</c>) work over any brand-owned entity instead of each
/// endpoint group re-implementing the same scope/param filter inline.
/// </summary>
public interface IBrandOwned
{
    string Brand { get; }
}
