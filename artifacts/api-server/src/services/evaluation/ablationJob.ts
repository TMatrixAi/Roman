import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../lib/logger";
import { runAblationAnalysis, type AblationProgress, type AblationReport } from "./ablation";
import { renderAblationReportMarkdown } from "./ablationReportMarkdown";

/**
 * Optional `sampleSize` scores a proportional stratified sample of the historical corpus instead
 * of the full ~18.2k matches (see `buildRepresentativeSample` in `ablation.ts`) -- sized to
 * complete in one sitting without blocking the event loop for 15-20+ minutes per variant. See
 * `docs/audit-matchloadrecovery-live-revalidation.md` for why the full run repeatedly failed to
 * finish uninterrupted.
 */

/**
 * A full ablation run replays the ~18.6k-match historical corpus through the live engine 12
 * times (baseline + 8 leave-one-out + 3 extra combinations). That's too long to hold open a
 * single HTTP request for, so this runs in-process (inside the already-running API server) and
 * is polled via GET /api/evaluation/ablation/status -- see the `sandbox-background-process-limits`
 * lesson: a detached/backgrounded shell process would get killed the moment the invoking shell
 * command ends, but work kept inside this long-lived server process survives fine.
 */

export type AblationJobStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: string; sampleSize: number | null; progress: AblationProgress }
  | { state: "done"; startedAt: string; finishedAt: string; sampleSize: number | null; report: AblationReport; reportPath: string; markdownPath: string }
  | { state: "error"; startedAt: string; finishedAt: string; sampleSize: number | null; error: string };

let currentJob: AblationJobStatus = { state: "idle" };

export function getAblationJobStatus(): AblationJobStatus {
  return currentJob;
}

const REPORTS_DIR = path.join(process.cwd(), "reports");

export function startAblationJob(sampleSize?: number): { started: boolean; reason?: string } {
  if (currentJob.state === "running") {
    return { started: false, reason: "An ablation run is already in progress." };
  }

  const startedAt = new Date().toISOString();
  const normalizedSampleSize = sampleSize != null && sampleSize > 0 ? sampleSize : null;
  currentJob = { state: "running", startedAt, sampleSize: normalizedSampleSize, progress: { phase: "loading", variantIndex: 0, variantCount: 0, matchIndex: 0, matchCount: 0 } };

  // Intentionally not awaited -- this is the whole point, the job runs in the background while
  // this function returns immediately so the HTTP request that triggered it doesn't hang.
  void runJob(startedAt, normalizedSampleSize);

  return { started: true };
}

async function runJob(startedAt: string, sampleSize: number | null): Promise<void> {
  try {
    const report = await runAblationAnalysis(
      (progress) => {
        if (currentJob.state === "running") {
          currentJob = { ...currentJob, progress };
        }
      },
      sampleSize != null ? { sampleSize } : {},
    );

    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const suffix = sampleSize != null ? "-sampled" : "";
    const reportPath = path.join(REPORTS_DIR, `model-ablation-analysis${suffix}.json`);
    const markdownPath = path.join(REPORTS_DIR, `model-ablation-analysis${suffix}.md`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
    await fs.writeFile(markdownPath, renderAblationReportMarkdown(report), "utf-8");

    currentJob = { state: "done", startedAt, finishedAt: new Date().toISOString(), sampleSize, report, reportPath, markdownPath };
    logger.info({ reportPath, markdownPath, sampleSize }, "Ablation analysis report written");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Ablation analysis run failed");
    currentJob = { state: "error", startedAt, finishedAt: new Date().toISOString(), sampleSize, error: message };
  }
}
