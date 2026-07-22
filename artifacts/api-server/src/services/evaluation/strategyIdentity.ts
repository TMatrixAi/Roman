import { desc } from "drizzle-orm";
import { db, configPromotionsTable } from "@workspace/db";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function yearFrom(date: Date | string | null | undefined): string {
  const resolved = date ? new Date(date) : new Date();
  return Number.isNaN(resolved.getTime()) ? String(new Date().getUTCFullYear()) : String(resolved.getUTCFullYear());
}

export interface StrategyIdentityInput {
  strategyName: string;
  strategyFamily: string;
  strategyFingerprint: string;
  parentStrategyId?: string | null;
  parentStrategyVersion?: string | null;
  creationMethod?: string | null;
  createdAt?: Date | string | null;
}

export interface StrategyIdentity {
  strategyId: string;
  strategyVersion: string;
}

export function deriveStrategyIdentity(input: StrategyIdentityInput): StrategyIdentity {
  const seed = stableStringify({
    strategyName: input.strategyName,
    strategyFamily: input.strategyFamily,
    strategyFingerprint: input.strategyFingerprint,
    parentStrategyId: input.parentStrategyId ?? null,
    parentStrategyVersion: input.parentStrategyVersion ?? null,
    creationMethod: input.creationMethod ?? null,
  });
  const suffix = (parseInt(hash32(seed).slice(0, 8), 16) % 10000).toString().padStart(4, "0");
  const strategyId = `STR-${yearFrom(input.createdAt)}-${suffix}`;
  const versionSeed = parseInt(hash32(`${input.strategyFingerprint}:${seed}`).slice(0, 8), 16);
  const major = 1 + (versionSeed % 5);
  const minor = (versionSeed >> 3) % 10;
  const patch = (versionSeed >> 5) % 10;
  return { strategyId, strategyVersion: `${major}.${minor}.${patch}` };
}

export function derivePredictionStrategyIdentity(input: {
  strategyId?: string | null;
  strategyVersion?: string | null;
  strategyFingerprint?: string | null;
  predictionMode: string;
  modelVersion: string;
  createdAt?: Date | string | null;
}): StrategyIdentity {
  if (input.strategyId && input.strategyVersion) {
    return { strategyId: input.strategyId, strategyVersion: input.strategyVersion };
  }
  const fingerprint = input.strategyFingerprint ?? input.modelVersion;
  const strategyId = input.strategyId ?? `STR-${yearFrom(input.createdAt)}-${(parseInt(hash32(`${fingerprint}:${input.predictionMode}`), 16) % 10000).toString().padStart(4, "0")}`;
  const versionSeed = parseInt(hash32(`${fingerprint}:${input.predictionMode}`), 16);
  const strategyVersion = input.strategyVersion ?? `${1 + (versionSeed % 5)}.${(versionSeed >> 2) % 10}.${(versionSeed >> 5) % 10}`;
  return { strategyId, strategyVersion };
}

export function defaultPredictionMode(runKind: string): string {
  switch (runKind) {
    case "historical_test":
      return "walk_forward";
    case "paper_trade_shadow":
      return "archived_replay";
    case "paper_trade":
      return "paper_trading";
    case "live":
      return "production";
    default:
      return runKind;
  }
}

export async function getCurrentProductionStrategyIdentity(): Promise<{ strategyId: string | null; strategyVersion: string | null; strategyFingerprint: string | null }> {
  const [promotion] = await db.select().from(configPromotionsTable).orderBy(desc(configPromotionsTable.approvedAt)).limit(1);
  if (!promotion) {
    return { strategyId: null, strategyVersion: null, strategyFingerprint: null };
  }

  const strategyId = typeof promotion.strategyId === "string" && promotion.strategyId.trim() !== "" ? promotion.strategyId : `STR-${new Date(promotion.approvedAt).getUTCFullYear()}-${String(promotion.candidateConfigId).padStart(4, "0")}`;
  const strategyVersion = typeof promotion.strategyVersion === "string" && promotion.strategyVersion.trim() !== "" ? promotion.strategyVersion : "1.0.0";
  const strategyFingerprint = typeof promotion.strategyFingerprint === "string" && promotion.strategyFingerprint.trim() !== "" ? promotion.strategyFingerprint : null;
  return { strategyId, strategyVersion, strategyFingerprint };
}
