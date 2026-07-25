import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

/**
 * Requires a valid Clerk session. Returns 401 if the request has no authenticated user.
 * Admin routes are separately protected by requireAdmin (cookie-based) and are unaffected.
 */
export const requireClerkUser = (req: Request, res: Response, next: NextFunction): void => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
