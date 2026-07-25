import { Router, type IRouter } from "express";
import { AdminLoginBody, AdminLoginResponse, GetAdminAuthStatusResponse, AdminLogoutResponse } from "@workspace/api-zod";
import {
  getAdminAccessKey,
  getOwnerAutoLoginToken,
  isAdminSessionCookieValid,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} from "../lib/adminAuth";

const router: IRouter = Router();

function getSafeRedirectPath(input: unknown): string {
  if (typeof input !== "string") return "/app";
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return "/app";
  if (trimmed.startsWith("//")) return "/app";
  return trimmed;
}

router.get("/auth/status", (req, res): void => {
  const authenticated = isAdminSessionCookieValid(req.signedCookies);
  // Single-owner system: authenticated users are owners
  const role = authenticated ? 'owner' : 'user';
  res.json({ 
    authenticated, 
    role,
    // Include permission hints for frontend to know capability levels
    permissions: authenticated ? {
      canRunAudits: true,
      canViewLogs: true,
      canRetrySafeJobs: true,
      canManageAlerts: true,
      canRunPerformanceTests: true,
      canRunDestructiveRollback: true,
      canRunDestructiveRepairs: true,
    } : {
      canRunAudits: false,
      canViewLogs: false,
      canRetrySafeJobs: false,
      canManageAlerts: false,
      canRunPerformanceTests: false,
      canRunDestructiveRollback: false,
      canRunDestructiveRepairs: false,
    }
  });
});

router.post("/auth/login", (req, res): void => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const configuredKey = getAdminAccessKey();
  if (!configuredKey) {
    res.status(403).json({ error: "Admin access key is not configured on the server" });
    return;
  }

  if (parsed.data.accessKey !== configuredKey) {
    res.status(401).json({ error: "Incorrect access key" });
    return;
  }

  setAdminSessionCookie(res);
  res.json(AdminLoginResponse.parse({ authenticated: true }));
});

router.get("/auth/owner-auto-login", (req, res): void => {
  const configuredToken = getOwnerAutoLoginToken();
  if (!configuredToken) {
    res.status(403).json({ error: "Owner auto-login is not configured on the server" });
    return;
  }

  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token || token !== configuredToken) {
    res.status(401).json({ error: "Invalid owner auto-login token" });
    return;
  }

  setAdminSessionCookie(res);
  const next = getSafeRedirectPath(req.query.next);
  res.redirect(302, next);
});

router.post("/auth/logout", (_req, res): void => {
  clearAdminSessionCookie(res);
  res.json(AdminLogoutResponse.parse({ authenticated: false }));
});

export default router;
