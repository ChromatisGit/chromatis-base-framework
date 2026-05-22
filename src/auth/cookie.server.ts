export interface SessionCookieConfig {
  name: string;
  maxAge?: number;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
}

export function getSessionCookie(
  request: Request,
  config: Pick<SessionCookieConfig, "name">,
): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split("; ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === config.name) return part.slice(eq + 1);
  }
  return null;
}

export function buildSetSessionCookie(value: string, config: SessionCookieConfig): string {
  const maxAge = config.maxAge ?? 60 * 60 * 24 * 30;
  const path = config.path ?? "/";
  const sameSite = config.sameSite ?? "lax";
  let cookie = `${config.name}=${value}; HttpOnly; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`;
  if (config.secure) cookie += "; Secure";
  return cookie;
}

export function buildClearSessionCookie(
  config: Pick<SessionCookieConfig, "name" | "path" | "sameSite" | "secure">,
): string {
  const path = config.path ?? "/";
  const sameSite = config.sameSite ?? "lax";
  let cookie = `${config.name}=; HttpOnly; Path=${path}; Max-Age=0; SameSite=${sameSite}`;
  if (config.secure) cookie += "; Secure";
  return cookie;
}
