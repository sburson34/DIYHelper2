// Shared date formatting for job scheduling surfaces (MyJobs, TechJobs,
// booking slots). Locale-sensitive via toLocaleString with the device locale.

/** "Wed, Jul 9, 2:30 PM" — or null when the input is missing/unparseable. */
export const fmtDateTime = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

/**
 * Scheduled time if set/parseable, else the coarse preferred window the
 * customer picked at booking ("morning"), else empty string.
 */
export const fmtWhen = (iso?: string | null, window?: string | null): string =>
  fmtDateTime(iso) ?? (window || '');
