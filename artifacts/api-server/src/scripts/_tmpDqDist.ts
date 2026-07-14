import { db, evaluationPredictionsTable } from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";

async function main() {
  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      or(
        and(eq(evaluationPredictionsTable.runKind, "historical_test"), eq(evaluationPredictionsTable.segment, "test")),
        inArray(evaluationPredictionsTable.runKind, ["paper_trade", "live"]),
      ),
    );
  console.log("total rows:", rows.length);
  const graded = rows.filter((r) => (r.status === "graded" || r.status === "void") && r.includedInAccuracy && r.actualWinnerId !== null && r.featureSnapshot !== null);
  console.log("graded rows w/ snapshot:", graded.length);

  const withDq = graded
    .map((r) => {
      const snap = r.featureSnapshot as LiveFeatureSnapshot;
      return { r, dq: snap?.dataQuality };
    })
    .filter((x) => typeof x.dq === "number") as { r: (typeof graded)[number]; dq: number }[];
  console.log("rows with numeric dataQuality:", withDq.length, "/", graded.length);

  if (withDq.length) {
    const dqs = withDq.map((x) => x.dq).sort((a, b) => a - b);
    console.log("min", dqs[0], "max", dqs[dqs.length - 1], "median", dqs[Math.floor(dqs.length / 2)], "mean", (dqs.reduce((a, b) => a + b, 0) / dqs.length).toFixed(1));
    const buckets = [0, 25, 45, 55, 65, 85, 101];
    for (let i = 0; i < buckets.length - 1; i++) {
      const lo = buckets[i],
        hi = buckets[i + 1];
      const inb = withDq.filter((x) => x.dq >= lo && x.dq < hi);
      const wins = inb.filter((x) => x.r.actualWinnerId === x.r.predictedWinnerId).length;
      console.log(`[${lo},${hi}): n=${inb.length} (${((inb.length / withDq.length) * 100).toFixed(1)}%) accuracy=${inb.length ? ((wins / inb.length) * 100).toFixed(1) : "n/a"}%`);
    }
    const dates = rows.map((r) => (r.lockedAt?.getTime() ?? 0));
    console.log("row lockedAt range:", new Date(Math.min(...dates)).toISOString(), "..", new Date(Math.max(...dates)).toISOString());

    // also check model version breakdown (pre vs post #68 fix)
    const versions = new Map<string, number>();
    for (const x of withDq) {
      const v = (x.r.featureSnapshot as any)?.modelVersion ?? "unknown";
      versions.set(v, (versions.get(v) ?? 0) + 1);
    }
    console.log("modelVersion breakdown:", Object.fromEntries(versions));
  }
  process.exit(0);
}
main();
