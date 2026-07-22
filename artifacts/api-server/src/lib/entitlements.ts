import type { Response } from "express";

type EntitlementCheck = () => Promise<boolean>;

export async function enforceEntitlement(res: Response, check: EntitlementCheck, capability: string): Promise<boolean> {
  const allowed = await check();
  if (allowed) return true;
  res.status(403).json({
    error: "Feature not available for current entitlement",
    capability,
  });
  return false;
}