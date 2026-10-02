import crypto from "node:crypto";

/**
 * Generates a 256-bit cryptographically secure random token (64 hex characters)
 * and its corresponding SHA-256 digest for secure storage at rest.
 */
export function generateSecureToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Computes the SHA-256 hex digest of a raw token.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

/**
 * Sanitizes a URL by redacting any sensitive token or code query parameters.
 * Use this whenever logging URLs to console, server logs, or error traces.
 */
export function sanitizeTokenUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "REDACTED");
    }
    if (url.searchParams.has("code")) {
      url.searchParams.set("code", "REDACTED");
    }
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&](?:token|code)=)[^&#\s]+/gi, "$1REDACTED");
  }
}
