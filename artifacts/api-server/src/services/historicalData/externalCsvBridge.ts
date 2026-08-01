/**
 * Post-import bridge: re-resolves ext-{tour}-{id} (and legacy ext-{id}) player slots in
 * historical_matches to existing Sackmann / API-Tennis IDs using surname + first-initial
 * disambiguation.
 *
 * Why this is needed:
 *   The initial CSV import uses surname-only matching and falls back to "ext-{tour}-{id}"
 *   when a surname appears for multiple players (e.g. "Murray" → Andy + Jamie). That results
 *   in ~89% unresolved IDs and broken Elo chains across year boundaries.
 *
 * Cross-tour safety:
 *   ATP and WTA CSVs share the same numeric player-ID namespace. To prevent a WTA player
 *   "ext-12345" from being conflated with an ATP player "ext-12345", every slot is keyed by
 *   (ext_id, tour) throughout — in the query, the resolution map, and both UPDATE statements.
 *   New imports produce "ext-atp-{id}" / "ext-wta-{id}" fallbacks; legacy "ext-{id}" rows
 *   are handled by also filtering on h.tour in the UPDATE.
 *
 * Atomicity:
 *   All four UPDATE statements (player1_id, player2_id, winner_id in historical_matches plus
 *   player_id in match_feature_snapshots) run inside a single database transaction. If any
 *   statement fails the entire migration rolls back, leaving no partially-updated rows. Because
 *   the mutation is idempotent-by-design (ext-{…} IDs that were replaced are gone; a retry
 *   skips those slots automatically), a safe re-run after any failure is always possible.
 *
 * This bridge:
 *   1. Scans historical_matches WHERE provider='ext-csv' for rows with ext-{…} player IDs,
 *      collecting unique (ext_id, tour) slots.
 *   2. Builds an enhanced index from all NON-ext-csv rows: surname+initial → [{id, name}].
 *   3. For each unique (ext_id, tour, stored_name) slot, tries:
 *        a. Exact surname + first-initial → unique match = resolved
 *        b. Surname-only if globally unambiguous = resolved
 *        c. Otherwise: stays as ext-{…}
 *   4. Runs all UPDATEs atomically inside a single transaction so a mid-migration failure
 *      never leaves split player identities.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";

// ── Name-parsing helpers ──────────────────────────────────────────────────────

/**
 * Parse a DB-stored player name (expected format "First [Middle] Last") into
 * surname key and first initial.
 * "Novak Djokovic"              → { surname: "djokovic",          initial: "n" }
 * "Alejandro Davidovich Fokina" → { surname: "davidovich fokina", initial: "a" }
 * "Barbora Krejcikova"          → { surname: "krejcikova",        initial: "b" }
 */
function dbNameParts(name: string): { surname: string; initial: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { surname: "", initial: "" };
  if (words.length === 1) {
    return { surname: words[0].toLowerCase(), initial: words[0][0]?.toLowerCase() ?? "" };
  }
  return {
    initial: words[0][0]?.toLowerCase() ?? "",
    surname: words.slice(1).join(" ").toLowerCase(),
  };
}

/**
 * Parse a CSV abbreviated name (format "Last F." or "Compound Last F.") into
 * surname key and first initial.
 * "Djokovic N."          → { surname: "djokovic",          initial: "n" }
 * "Davidovich Fokina A." → { surname: "davidovich fokina", initial: "a" }
 * "De Minaur A."         → { surname: "de minaur",         initial: "a" }
 * "Osaka"                → { surname: "osaka",             initial: null }
 */
export function csvNameParts(name: string): { surname: string; initial: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { surname: "", initial: null };
  if (words.length === 1) return { surname: words[0].toLowerCase(), initial: null };

  const lastToken = words[words.length - 1];
  // Treat as initial when: single letter, optionally with trailing dot
  if (/^[A-Za-z]\.?$/.test(lastToken)) {
    return {
      surname: words.slice(0, -1).join(" ").toLowerCase(),
      initial: lastToken.replace(".", "").toLowerCase(),
    };
  }
  // No initial found — full string is the name (edge case)
  return { surname: name.trim().toLowerCase(), initial: null };
}

// ── Enhanced player ID map ────────────────────────────────────────────────────

type PlayerEntry = { id: string; name: string };
export type EnhancedPlayerIdMap = {
  /** "surname|initial" → players. Unique entry = unambiguous match. */
  byInitial: Map<string, PlayerEntry[]>;
  /** surname → players. Used as fallback when initial is absent. */
  bySurname: Map<string, PlayerEntry[]>;
};

function addToMap<K>(map: Map<K, PlayerEntry[]>, key: K, entry: PlayerEntry): void {
  if (!map.has(key)) map.set(key, []);
  const bucket = map.get(key)!;
  if (!bucket.some(e => e.id === entry.id)) bucket.push(entry);
}

/**
 * Build the enhanced map from all non-ext-csv historical_matches rows.
 * One DB round-trip.
 */
async function buildEnhancedPlayerIdMap(): Promise<EnhancedPlayerIdMap> {
  const byInitial = new Map<string, PlayerEntry[]>();
  const bySurname = new Map<string, PlayerEntry[]>();

  const result = await db.execute(sql`
    SELECT player_id, player_name FROM (
      SELECT DISTINCT player1_id AS player_id, player1_name AS player_name
        FROM historical_matches
       WHERE player1_name IS NOT NULL AND player1_name != ''
         AND provider != 'ext-csv'
      UNION
      SELECT DISTINCT player2_id AS player_id, player2_name AS player_name
        FROM historical_matches
       WHERE player2_name IS NOT NULL AND player2_name != ''
         AND provider != 'ext-csv'
    ) sub
  `);

  for (const r of result.rows as Array<{ player_id: string; player_name: string }>) {
    if (!r.player_id || !r.player_name) continue;
    const entry: PlayerEntry = { id: r.player_id, name: r.player_name };
    const { surname, initial } = dbNameParts(r.player_name);
    if (!surname) continue;

    addToMap(bySurname, surname, entry);
    if (initial) addToMap(byInitial, `${surname}|${initial}`, entry);
  }

  return { byInitial, bySurname };
}

/**
 * Resolve a CSV player (stored name) to the best available real player ID.
 * Returns null if no unambiguous match was found.
 */
export function resolveCsvPlayerToRealId(
  storedName: string,
  map: EnhancedPlayerIdMap,
): string | null {
  const { surname, initial } = csvNameParts(storedName);
  if (!surname) return null;

  // 1. Try surname + initial (most specific — disambiguates Murray A./Murray J. etc.)
  if (initial) {
    const candidates = map.byInitial.get(`${surname}|${initial}`);
    if (candidates && candidates.length === 1) return candidates[0].id;
    // Multiple players share same surname+initial (very rare) → fall through to surname-only
  }

  // 2. Surname-only fallback — only when globally unambiguous
  const surnameCandidates = map.bySurname.get(surname);
  if (surnameCandidates && surnameCandidates.length === 1) return surnameCandidates[0].id;

  return null;
}

// ── Bridge result type ────────────────────────────────────────────────────────

export interface ExtCsvBridgeResult {
  /** Total distinct (ext_id, tour) player slots found in ext-csv rows. */
  extPlayerSlotsFound: number;
  /** Slots resolved to a real Sackmann/API-Tennis ID. */
  resolved: number;
  /** Slots that remained ext-{…} (ambiguous or genuinely new players). */
  unresolved: number;
  /** historical_matches rows updated (p1 + p2 + winner combined). */
  matchRowsUpdated: number;
  /** match_feature_snapshots rows updated. */
  featureRowsUpdated: number;
  /** ATP main-draw player match rate 0–100, or null if no ATP rows. */
  atpMatchRate: number | null;
  /** WTA player match rate 0–100, or null if no WTA rows. */
  wtaMatchRate: number | null;
}

// ── Resolution entry ──────────────────────────────────────────────────────────

/** One resolved mapping: an ext player slot → a canonical real player ID. */
export type ResolutionEntry = {
  extId: string;
  /** Tour of the match row that contained this player slot ("ATP", "WTA", etc.). */
  tour:  string;
  realId: string;
};

// ── SQL array helper ──────────────────────────────────────────────────────────

/**
 * Safely embed a list of plain text values as a PostgreSQL text[] literal.
 * Values are internal IDs/tour strings — no user-supplied input.
 */
function pgTextArray(values: string[]): string {
  return `ARRAY[${values.map(v => `'${v.replace(/'/g, "''")}'`).join(",")}]`;
}

// ── Transactional mutation (exported for testing) ─────────────────────────────

/**
 * A minimal subset of the drizzle `db` / transaction object that the mutation
 * needs. Typed narrowly so tests can inject a mock without importing drizzle.
 */
export interface DbLike {
  execute(query: unknown): Promise<{ rowCount?: number }>;
}

/**
 * Execute all four UPDATE statements that constitute the identity migration.
 *
 * All statements run through the same `tx` connection; callers must wrap this
 * in `db.transaction()` so a failure in any statement rolls back the others.
 *
 * Exported so tests can inject a mock `tx` and verify atomicity without a real DB.
 */
export async function runBridgeMigration(
  tx: DbLike,
  entries: ResolutionEntry[],
): Promise<{ p1Rows: number; p2Rows: number; winRows: number; featureRowsUpdated: number }> {
  if (entries.length === 0) return { p1Rows: 0, p2Rows: 0, winRows: 0, featureRowsUpdated: 0 };

  const extIds  = entries.map(e => e.extId);
  const tours   = entries.map(e => e.tour);
  const realIds = entries.map(e => e.realId);

  function matchUpdate(column: string): string {
    return `
      UPDATE historical_matches AS h
         SET ${column} = m.real_id
        FROM (
               SELECT unnest(${pgTextArray(extIds)})  AS ext_id,
                      unnest(${pgTextArray(tours)})   AS tour,
                      unnest(${pgTextArray(realIds)}) AS real_id
             ) AS m
       WHERE h.provider  = 'ext-csv'
         AND h.${column} = m.ext_id
         AND h.tour      = m.tour
    `;
  }

  // Run sequentially within the transaction — parallel execution inside a single
  // transaction offers no benefit and makes failure ordering harder to reason about.
  const p1Result  = await tx.execute(sql.raw(matchUpdate("player1_id")));
  const p2Result  = await tx.execute(sql.raw(matchUpdate("player2_id")));
  const winResult = await tx.execute(sql.raw(matchUpdate("winner_id")));

  // Snapshot update joins through historical_matches to inherit the tour filter.
  const snapshotResult = await tx.execute(sql.raw(`
    UPDATE match_feature_snapshots AS f
       SET player_id = m.real_id
      FROM historical_matches AS h,
           (
             SELECT unnest(${pgTextArray(extIds)})  AS ext_id,
                    unnest(${pgTextArray(tours)})   AS tour,
                    unnest(${pgTextArray(realIds)}) AS real_id
           ) AS m
     WHERE f.match_id  = h.id
       AND f.player_id = m.ext_id
       AND h.tour      = m.tour
       AND h.provider  = 'ext-csv'
  `));

  return {
    p1Rows:            (p1Result  as unknown as { rowCount?: number }).rowCount  ?? 0,
    p2Rows:            (p2Result  as unknown as { rowCount?: number }).rowCount  ?? 0,
    winRows:           (winResult as unknown as { rowCount?: number }).rowCount  ?? 0,
    featureRowsUpdated:(snapshotResult as unknown as { rowCount?: number }).rowCount ?? 0,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run the post-import bridge.
 *
 * Safe to run repeatedly — idempotent once all ext-{…} IDs have been replaced
 * (subsequent runs find no matching rows and the transaction is a no-op).
 */
export async function runExternalCsvBridge(): Promise<ExtCsvBridgeResult> {
  logger.info("ext-csv-bridge: building enhanced player ID map");
  const map = await buildEnhancedPlayerIdMap();
  logger.info(
    { bySurnameKeys: map.bySurname.size, byInitialKeys: map.byInitial.size },
    "ext-csv-bridge: player ID map ready",
  );

  // ── Step 1: Collect unique (ext_id, tour) player slots ────────────────────
  const slotsResult = await db.execute(sql`
    SELECT DISTINCT slot_id, slot_name, tour
      FROM (
             SELECT player1_id   AS slot_id, player1_name AS slot_name, tour
               FROM historical_matches
              WHERE provider = 'ext-csv'
                AND player1_id LIKE 'ext-%'
                AND player1_id IS NOT NULL
                AND player1_name IS NOT NULL AND player1_name != ''
             UNION ALL
             SELECT player2_id, player2_name, tour
               FROM historical_matches
              WHERE provider = 'ext-csv'
                AND player2_id LIKE 'ext-%'
                AND player2_id IS NOT NULL
                AND player2_name IS NOT NULL AND player2_name != ''
           ) sub
  `);

  type SlotRow = { slot_id: string; slot_name: string; tour: string | null };
  const allSlots = slotsResult.rows as SlotRow[];

  // Deduplicate by (slot_id, tour) — ATP "ext-12345" and WTA "ext-12345" are separate slots
  const slotByKey = new Map<string, SlotRow>(); // key: `${tour}||${slot_id}`
  for (const row of allSlots) {
    const key = `${row.tour ?? ""}||${row.slot_id}`;
    if (!slotByKey.has(key)) slotByKey.set(key, row);
  }

  logger.info(
    { rawSlotRows: allSlots.length, uniqueSlots: slotByKey.size },
    "ext-csv-bridge: discovered ext-id player slots (keyed by ext_id+tour)",
  );

  // ── Step 2: Resolve each (ext_id, tour) slot ──────────────────────────────
  const resolutionEntries: ResolutionEntry[] = [];
  let atpResolved = 0; let atpTotal = 0;
  let wtaResolved = 0; let wtaTotal = 0;

  for (const slot of slotByKey.values()) {
    const isAtp = /^atp/i.test(slot.tour ?? "");
    const isWta = /^wta/i.test(slot.tour ?? "");
    if (isAtp) atpTotal++;
    else if (isWta) wtaTotal++;

    const realId = resolveCsvPlayerToRealId(slot.slot_name, map);
    if (realId) {
      resolutionEntries.push({ extId: slot.slot_id, tour: slot.tour ?? "", realId });
      if (isAtp) atpResolved++;
      else if (isWta) wtaResolved++;
    }
  }

  const resolved    = resolutionEntries.length;
  const unresolved  = slotByKey.size - resolved;
  const overallRate = slotByKey.size > 0 ? Math.round((resolved / slotByKey.size) * 100) : 0;
  const atpRate     = atpTotal > 0 ? Math.round((atpResolved / atpTotal) * 100) : null;
  const wtaRate     = wtaTotal > 0 ? Math.round((wtaResolved / wtaTotal) * 100) : null;

  logger.info(
    {
      uniqueSlots:    slotByKey.size,
      resolved,
      unresolved,
      overallRatePct: `${overallRate}%`,
      atpResolved,    atpTotal,
      atpRatePct:     atpRate !== null ? `${atpRate}%` : "n/a",
      wtaResolved,    wtaTotal,
      wtaRatePct:     wtaRate !== null ? `${wtaRate}%` : "n/a",
    },
    "ext-csv-bridge: resolution complete",
  );

  if (resolutionEntries.length === 0) {
    logger.info("ext-csv-bridge: no resolutions found — already bridged or no ext-csv data");
    return {
      extPlayerSlotsFound: slotByKey.size,
      resolved: 0, unresolved,
      matchRowsUpdated: 0, featureRowsUpdated: 0,
      atpMatchRate: atpRate, wtaMatchRate: wtaRate,
    };
  }

  // ── Step 3: Apply all updates atomically ──────────────────────────────────
  // All four statements run in a single transaction. If any fails the entire
  // migration rolls back — no partially-updated rows are ever committed.
  const { p1Rows, p2Rows, winRows, featureRowsUpdated } = await db.transaction(async (tx) => {
    return runBridgeMigration(tx as unknown as DbLike, resolutionEntries);
  });

  const matchRowsUpdated = p1Rows + p2Rows + winRows;

  logger.info(
    { p1Rows, p2Rows, winRows, matchRowsUpdated, featureRowsUpdated },
    "ext-csv-bridge: migration committed",
  );

  return {
    extPlayerSlotsFound: slotByKey.size,
    resolved, unresolved,
    matchRowsUpdated, featureRowsUpdated,
    atpMatchRate: atpRate, wtaMatchRate: wtaRate,
  };
}
