import type { Response } from "express";

type EntitlementCheck = () => Promise<boolean>;

export async function enforceEntitlement(res: Response, check: EntitlementCheck, capability: string): Promise<boolean> {
  try {
    const allowed = await check();
    if (allowed) return true;
    res.status(403).json({
      error: "Feature not available for current entitlement",
      capability,
    });
    return false;
  } catch (error) {
    // Backward-compatibility safety valve: entitlement backends should never make
    // core product data appear "missing" when the underlying data still exists.
    console.warn("[entitlements] check failed, allowing request", {
      capability,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}