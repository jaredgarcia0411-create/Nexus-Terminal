// Single source of truth for the ALLOWED_EMAILS gate. Read at call time so a
// change to the env var applies on the next request, not the next deploy.
//
// Fail closed: a missing or empty allowlist denies everyone rather than letting
// any Google account through.
export function isEmailAllowed(email: string | null | undefined): boolean {
  const allowedRaw = process.env.ALLOWED_EMAILS?.trim();
  if (!allowedRaw) return false;

  const normalized = email?.trim().toLowerCase() ?? '';
  if (!normalized) return false;

  return allowedRaw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}
