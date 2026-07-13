import type { AblationReport } from "./ablation";

function pct(v: number | null): string {
  return v === null ? "n/a" : `${v.toFixed(1)}%`;
}
function pts(v: number | null): string {
  if (v === null) return "n/a";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}pt`;
}

/** Renders the one-time model ablation analysis as a readable Markdown report. Pure formatting -- no computation. */
export function renderAblationReportMarkdown(report: AblationReport): string {
  const lines: string[] = [];
  lines.push("# Model Ablation Analysis for the Prediction Engine");
  lines.push("");
  lines.push(`Generated ${report.generatedAt} against ${report.matchCount.toLocaleString()} real, graded historical matches.`);
  lines.push("");
  lines.push("## Caveats");
  for (const c of report.caveats) lines.push(`- ${c}`);
  lines.push("");

  lines.push("## Baseline (everything active)");
  lines.push(`Overall accuracy: **${pct(report.baseline.overall.accuracy)}** (n=${report.baseline.overall.n})`);
  lines.push("");

  lines.push("## Leave-one-out ranking (Most Valuable → Harmful)");
  lines.push("");
  lines.push("| Model | Baseline acc. | With model removed | Δ (removed − baseline) | Rank | Recommendation |");
  lines.push("|---|---|---|---|---|---|");
  const rankOrder = ["Most Valuable", "Valuable", "Neutral", "Weak", "Harmful"];
  const sorted = [...report.modelDeltas].sort((a, b) => rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank));
  for (const d of sorted) {
    lines.push(`| ${d.modelLabel} | ${pct(d.baselineAccuracy)} | ${pct(d.ablatedAccuracy)} | ${pts(d.deltaPoints)} | ${d.rank} | ${d.recommendation} |`);
  }
  lines.push("");
  lines.push(
    "_Reading this table: a **negative** delta means removing the model made accuracy WORSE -- the model is earning its place. A **positive** delta means removing it made accuracy BETTER -- the model may be actively hurting predictions._",
  );
  lines.push("");

  lines.push("## Leave-one-out detail by segment");
  for (const d of sorted) {
    lines.push("");
    lines.push(`### ${d.modelLabel} (${d.rank}, ${d.recommendation})`);
    lines.push(`Overall: ${pct(d.baselineAccuracy)} → ${pct(d.ablatedAccuracy)} (${pts(d.deltaPoints)})`);
    lines.push("");
    lines.push("| Segment | Baseline acc. | Ablated acc. | Δ |");
    lines.push("|---|---|---|---|");
    for (const [tour, seg] of Object.entries(d.segments.byTour)) {
      if (seg.baseline.n === 0 && seg.ablated.n === 0) continue;
      lines.push(`| Tour: ${tour} | ${pct(seg.baseline.accuracy)} (n=${seg.baseline.n}) | ${pct(seg.ablated.accuracy)} (n=${seg.ablated.n}) | ${pts(seg.deltaPoints)} |`);
    }
    for (const [surface, seg] of Object.entries(d.segments.bySurface)) {
      if (seg.baseline.n === 0 && seg.ablated.n === 0) continue;
      lines.push(`| Surface: ${surface} | ${pct(seg.baseline.accuracy)} (n=${seg.baseline.n}) | ${pct(seg.ablated.accuracy)} (n=${seg.ablated.n}) | ${pts(seg.deltaPoints)} |`);
    }
    const dq = d.segments.byDataQuality;
    lines.push(`| High Data Quality (≥65) | ${pct(dq.high.baseline.accuracy)} (n=${dq.high.baseline.n}) | ${pct(dq.high.ablated.accuracy)} (n=${dq.high.ablated.n}) | ${pts(dq.high.deltaPoints)} |`);
    lines.push(`| Low Data Quality (<65) | ${pct(dq.low.baseline.accuracy)} (n=${dq.low.baseline.n}) | ${pct(dq.low.ablated.accuracy)} (n=${dq.low.ablated.n}) | ${pts(dq.low.deltaPoints)} |`);
    const fav = d.segments.byFavoriteVsUnderdog;
    lines.push(
      `| Picks that flipped away from the full-engine favorite | n/a | ${pct(fav.divergesFromBaseline.ablated.accuracy)} (n=${fav.divergesFromBaseline.ablated.n}) | -- |`,
    );
  }
  lines.push("");

  lines.push("## Multi-model combinations");
  lines.push("");
  lines.push("| Combination | Overall accuracy | n |");
  lines.push("|---|---|---|");
  const combosByAcc = [...report.combinations].sort((a, b) => (b.overall.accuracy ?? -1) - (a.overall.accuracy ?? -1));
  for (const c of combosByAcc) {
    lines.push(`| ${c.label} | ${pct(c.overall.accuracy)} | ${c.overall.n} |`);
  }
  if (combosByAcc.length > 0) {
    lines.push("");
    lines.push(`**Best overall win rate:** ${combosByAcc[0].label} (${pct(combosByAcc[0].overall.accuracy)})`);
    lines.push(`**Worst overall win rate:** ${combosByAcc[combosByAcc.length - 1].label} (${pct(combosByAcc[combosByAcc.length - 1].overall.accuracy)})`);
  }
  lines.push("");

  lines.push("## Diagnostic questions");
  lines.push("");
  lines.push("### Which model's vote most often coincides with a losing final prediction?");
  lines.push("| Model | n (losses where this model voted) | Coincided with the losing pick |");
  lines.push("|---|---|---|");
  for (const r of report.diagnostics.losingPredictionAttribution) lines.push(`| ${r.modelLabel} | ${r.n} | ${pct(r.rate)} |`);
  lines.push("");

  lines.push("### Which model is most often wrong specifically when it strongly favors a player (≥65% confidence)?");
  lines.push("| Model | n (strong votes) | Favored player actually lost |");
  lines.push("|---|---|---|");
  for (const r of report.diagnostics.overconfidentStrongVoteFailureRate) lines.push(`| ${r.modelLabel} | ${r.n} | ${pct(r.rate)} |`);
  lines.push("");

  lines.push("### Which model's confidence is systematically miscalibrated relative to its real hit rate?");
  lines.push("| Model | n | Avg. stated confidence | Observed hit rate | Overconfidence |");
  lines.push("|---|---|---|---|---|");
  for (const r of report.diagnostics.confidenceMiscalibration) {
    lines.push(`| ${r.modelLabel} | ${r.n} | ${pct(r.avgPredictedConfidence)} | ${pct(r.observedHitRate)} | ${pts(r.overconfidencePoints)} |`);
  }
  lines.push("");
  lines.push("_Positive overconfidence means the model states more confidence than its real hit rate supports._");
  lines.push("");

  lines.push("### Which model most often disagrees with the final blended prediction, and how often would that dissent have been correct?");
  lines.push("| Model | Dissent rate (of all matches) | n dissents | Dissent would have been correct |");
  lines.push("|---|---|---|---|");
  for (const r of report.diagnostics.dissentFromFinalPrediction) {
    lines.push(`| ${r.modelLabel} | ${pct(r.rate)} | ${r.n} | ${pct(r.correctDissentRate)} |`);
  }
  lines.push("");

  return lines.join("\n");
}
