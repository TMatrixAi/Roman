import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../lib/logger";
import { runAblationAnalysis, type AblationProgress, type AblationReport } from "./ablation";
import { renderAblationReportMarkdown } from "./ablationReportMarkdown";

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
  | { state: "running"; startedAt: string; progress: AblationProgress }
  | { state: "done"; startedAt: string; finishedAt: string; report: AblationReport; reportPath: string; markdownPath: string }
  | { state: "error"; startedAt: string; finishedAt: string; error: string };

let currentJob: AblationJobStatus = { state: "idle" };

export function getAblationJobStatus(): AblationJobStatus {
  return currentJob;
}

const REPORTS_DIR = path.join(process.cwd(), "reports");

export function startAblationJob(): { started: boolean; reason?: string } {
  if (currentJob.state === "running") {
    return { started: false, reason: "An ablation run is already in progress." };
  }

  const startedAt = new Date().toISOString();
  currentJob = { state: "running", startedAt, progress: { phase: "loading", variantIndex: 0, variantCount: 0, matchIndex: 0, matchCount: 0 } };

  // Intentionally not awaited -- this is the whole point, the job runs in the background while
  // this function returns immediately so the HTTP request that triggered it doesn't hang.
  void runJob(startedAt);

  return { started: true };
}

async function runJob(startedAt: string): Promise<void> {
  try {
    const report = await runAblationAnalysis((progress) => {
      if (currentJob.state === "running") {
        currentJob = { ...currentJob, progress };
      }
    });

    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const reportPath = path.join(REPORTS_DIR, "model-ablation-analysis.json");
    const markdownPath = path.join(REPORTS_DIR, "model-ablation-analysis.md");
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
    await fs.writeFile(markdownPath, renderAblationReportMarkdown(report), "utf-8");

    currentJob = { state: "done", startedAt, finishedAt: new Date().toISOString(), report, reportPath, markdownPath };
    logger.info({ reportPath, markdownPath }, "Ablation analysis report written");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Ablation analysis run failed");
    currentJob = { state: "error", startedAt, finishedAt: new Date().toISOString(), error: message };
  }
}
