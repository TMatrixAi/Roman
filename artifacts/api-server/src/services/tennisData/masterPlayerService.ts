/**
 * Master Player Service — cross-provider ID linking and stable internal player IDs.
 *
 * Every player the app encounters (from any provider) is assigned a stable internal ID on first
 * sight, stored in `master_players`. Subsequent encounters link additional provider keys to the
 * same row rather than creating duplicates, so callers always get a consistent identity regardless
 * of which provider served the data.
 *
 * Linking strategy:
 *   1. Exact `provider_key` match → already linked, nothing to do.
 *   2. Normalized-name match with confidence ≥ threshold → link provider key to existing row.
 *   3. No confident match → create a new master_players row.
 *
 * This module intentionally has no prediction-engine dependencies.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, masterPlayersTable } from "@workspace/db";
import type { MasterPlayerRow } from "@workspace/db";
import { logger } from "../../lib/logger";
import { normalizePlayerName } from "./playerIdentity";

/** Result of a master-player resolution attempt. */
export interface MasterPlayerResolution {
  /** Stable internal master ID. */
  masterId: string;
  /** True when the caller's provider key was already linked or was just linked now. */
  linked: boolean;
  /** The full master player row. */
  row: MasterPlayerRow;
}

/**
 * Returned when name-based linking finds multiple existing rows that share the same
 * normalized name and all lack the incoming provider key. Callers must treat this as
 * "needs human disambiguation" — never guess between candidates.
 */
export interface MasterPlayerAmbiguous {
  ambiguous: true;
  /** Stable IDs of the candidate rows that all share the normalized name. */
  candidateIds: string[];
}

export type MasterPlayerLinkResult = MasterPlayerResolution | MasterPlayerAmbiguous;

/** Which provider key column to set/query. */
export type ProviderKeyField = "apiTennisKey" | "matchstatKey";

/**
 * Resolve or create a master player record for an incoming player from a given provider.
 *
 * Steps (in order of preference):
 *   1. Look up by the incoming provider key — already linked, return early.
 *   2. Look up by normalized name among rows where the incoming provider key is not yet set.
 *      - If exactly one candidate exists: link the provider key and return it.
 *      - If multiple candidates share the same normalized name: return MasterPlayerAmbiguous —
 *        callers must disambiguate manually, never guess between candidates.
 *   3. No candidates: insert a fresh row, then re-query to return the persisted row (safe under
 *      concurrent inserts — onConflictDoNothing means the insert may be a no-op, so the
 *      re-query guarantees callers always get a real, persisted ID, never a phantom UUID).
 */
export async function resolveMasterPlayer(
  providerKey: string,
  providerField: ProviderKeyField,
  displayName: string,
  extras: {
    countryCode?: string | null;
    tour?: string | null;
    currentRank?: number | null;
  } = {},
): Promise<MasterPlayerLinkResult> {
  const normalizedName = normalizePlayerName(displayName);

  // 1. Already linked by provider key?
  const colEq =
    providerField === "apiTennisKey"
      ? eq(masterPlayersTable.apiTennisKey, providerKey)
      : eq(masterPlayersTable.matchstatKey, providerKey);

  const [existing] = await db.select().from(masterPlayersTable).where(colEq).limit(1);
  if (existing) {
    return { masterId: existing.id, linked: true, row: existing };
  }

  // 2. Name match among rows missing this provider key — exact normalized match only.
  const nullColFilter =
    providerField === "apiTennisKey" ? isNull(masterPlayersTable.apiTennisKey) : isNull(masterPlayersTable.matchstatKey);

  const candidates = await db
    .select()
    .from(masterPlayersTable)
    .where(and(eq(masterPlayersTable.normalizedName, normalizedName), nullColFilter));

  if (candidates.length > 1) {
    // Multiple distinct rows share this normalized name — never guess which one to link.
    logger.warn(
      { displayName, normalizedName, providerField, providerKey, candidateCount: candidates.length },
      "Ambiguous master player name match — not linking, caller must disambiguate",
    );
    return { ambiguous: true, candidateIds: candidates.map((c) => c.id) };
  }

  if (candidates.length === 1) {
    const nameMatch = candidates[0];
    const updateData =
      providerField === "apiTennisKey"
        ? { apiTennisKey: providerKey, lastUpdated: new Date() }
        : { matchstatKey: providerKey, lastUpdated: new Date() };

    await db.update(masterPlayersTable).set(updateData).where(eq(masterPlayersTable.id, nameMatch.id));

    logger.info(
      { masterId: nameMatch.id, providerField, providerKey, displayName },
      "Linked provider key to existing master player via name match",
    );

    const [updated] = await db.select().from(masterPlayersTable).where(eq(masterPlayersTable.id, nameMatch.id)).limit(1);
    return { masterId: nameMatch.id, linked: true, row: updated ?? ({ ...nameMatch, ...updateData } as MasterPlayerRow) };
  }

  // 3. New player — insert, then re-query to handle concurrent inserts safely.
  // onConflictDoNothing means our INSERT may be a no-op if another request races us.
  // Re-querying by the provider key guarantees we return the real persisted row, not a phantom.
  const tentativeId = randomUUID();
  const now = new Date();
  await db
    .insert(masterPlayersTable)
    .values({
      id: tentativeId,
      displayName,
      normalizedName,
      apiTennisKey: providerField === "apiTennisKey" ? providerKey : null,
      matchstatKey: providerField === "matchstatKey" ? providerKey : null,
      countryCode: extras.countryCode ?? null,
      tour: extras.tour ?? null,
      currentRank: extras.currentRank ?? null,
      lastUpdated: now,
      createdAt: now,
    })
    .onConflictDoNothing();

  // Re-query by provider key — guaranteed to exist whether we won or lost the race.
  const [persisted] = await db.select().from(masterPlayersTable).where(colEq).limit(1);
  if (!persisted) {
    // Should never happen: we just inserted with the provider key, or lost the race to a row
    // that also has it. If it somehow still can't be found, log and throw so callers know.
    throw new Error(`Master player insert succeeded but re-query found nothing (providerField=${providerField}, providerKey=${providerKey})`);
  }

  logger.debug({ masterId: persisted.id, displayName, providerField, providerKey }, "Created new master player");
  return { masterId: persisted.id, linked: false, row: persisted };
}

/**
 * Look up a master player by their stable internal ID.
 * Returns null when not found (the ID may have been created by a different run).
 */
export async function getMasterPlayerById(masterId: string): Promise<MasterPlayerRow | null> {
  const [row] = await db.select().from(masterPlayersTable).where(eq(masterPlayersTable.id, masterId)).limit(1);
  return row ?? null;
}

/**
 * Look up a master player by a provider key.
 * Returns null when this provider key has not been linked yet.
 */
export async function getMasterPlayerByProviderKey(
  providerKey: string,
  providerField: ProviderKeyField,
): Promise<MasterPlayerRow | null> {
  const colEq = providerField === "apiTennisKey" ? eq(masterPlayersTable.apiTennisKey, providerKey) : eq(masterPlayersTable.matchstatKey, providerKey);

  const [row] = await db.select().from(masterPlayersTable).where(colEq).limit(1);
  return row ?? null;
}

/**
 * Search master players by display-name fragment. Useful for name-based disambiguation in routes.
 * Returns at most 20 results, ordered by normalized-name similarity (contains-match only).
 */
export async function searchMasterPlayers(query: string): Promise<MasterPlayerRow[]> {
  const normalized = normalizePlayerName(query);
  if (!normalized) return [];
  return db
    .select()
    .from(masterPlayersTable)
    .where(sql`${masterPlayersTable.normalizedName} like ${"%" + normalized + "%"}`)
    .limit(20);
}
