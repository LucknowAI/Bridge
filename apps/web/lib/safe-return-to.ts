/** Normalize an application destination before checking access or redirecting. */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000- \u007f]/.test(value)
  ) return "/";

  try {
    const base = "https://mr-bridge.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** Where a signed-in user goes; never back to /login, which would loop. */
export function postLoginPath(value: unknown): string {
  const destination = safeReturnTo(value);
  return /^\/login(?:[/?#]|$)/.test(destination) ? "/" : destination;
}

/** Login URL for a failed attempt that keeps the user's intended destination. */
export function loginErrorPath(error: string, returnTo?: unknown): string {
  const params = new URLSearchParams({ error });
  const destination = postLoginPath(returnTo);
  if (destination !== "/") params.set("returnTo", destination);
  return `/login?${params}`;
}
