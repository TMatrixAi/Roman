import type { Request, Response, NextFunction } from "express";

/**
 * Task #143: single-owner access gate. There are no user accounts -- the owner logs in once
 * with a shared access key (ADMIN_ACCESS_KEY) via POST /api/auth/login, which sets this signed,
 * httpOnly cookie. `requireAdmin` then protects every data-mutating and job-triggering route;
 * plain browsing/read routes stay open so the app's own UI never needs to re-prompt mid-session.
 */
export const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_VALUE = "ok";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getAdminAccessKey(): string | undefined {
  // Accept a few common secret-name variants across hosts (Replit/Codespaces/etc.).
  // The first non-empty value wins.
  const candidates = [
    process.env.ADMIN_ACCESS_KEY,
    process.env.ADMIN_ACCESSKEY,
    process.env.ADMIN_KEY,
    process.env.ADMIN_PASSWORD,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function getOwnerAutoLoginToken(): string | undefined {
  // Optional dedicated token for owner-only magic-link login.
  // Falls back to ADMIN_ACCESS_KEY so existing deployments work without extra setup.
  const candidates = [
    process.env.OWNER_AUTO_LOGIN_TOKEN,
    process.env.OWNER_MAGIC_LINK_TOKEN,
    getAdminAccessKey(),
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function isAdminSessionCookieValid(signedCookies: Record<string, unknown> | undefined): boolean {
  return signedCookies?.[ADMIN_SESSION_COOKIE] === ADMIN_SESSION_VALUE;
}

export function setAdminSessionCookie(res: Response): void {
  res.cookie(ADMIN_SESSION_COOKIE, ADMIN_SESSION_VALUE, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    maxAge: THIRTY_DAYS_MS,
  });
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE);
}

/**
 * Protects data-changing and job-triggering routes. If ADMIN_ACCESS_KEY isn't configured yet,
 * fails closed (403) rather than silently leaving the route open -- an unset secret should never
 * be mistaken for "no auth needed here".
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!getAdminAccessKey()) {
    res.status(403).json({ error: "Admin access key is not configured on the server" });
    return;
  }

  if (!isAdminSessionCookieValid(req.signedCookies)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  next();
}
