---
name: Paper-trading / periodic job triggering reliability
description: Why in-process timers (setInterval in index.ts) are a stopgap, not a durable fix, for recurring background jobs like paper-trading capture/grading.
---

The dev workflow process for an artifact (e.g. `artifacts/api-server: API Server`) is not guaranteed to
stay up continuously -- it can be restarted/evicted for reasons unrelated to the artifact's own code
(observed repeatedly: workflow went from RUNNING to FINISHED within minutes, with no error in its logs,
while other concurrent project tasks were running in the same repl). Production on `deploymentTarget =
"autoscale"` has the same structural problem for a different reason: it scales to zero when idle and
restarts on the next request.

**Why this matters:** any `setInterval`/`setTimeout`-based trigger for a periodic job (locking/grading
predictions, refreshing a cache, etc.) only progresses while that specific process instance happens to be
alive. It is a reasonable *stopgap* (better than a job that never runs at all) but is not a durable fix if
the job's correctness depends on running on a real, unattended cadence over hours/days.

**How to apply:** for any job that must keep running independent of a specific process's uptime, the
durable trigger is a Replit Scheduled Deployment (or moving the artifact off autoscale to an always-on
deployment) -- both require a person's action (choosing/configuring the deployment type), so don't
attempt to configure one yourself; document it clearly as a blocker/follow-up instead. Re-adding an
in-process trigger to restore *some* coverage while that person-decision is pending is fine and safe as
long as the job's own writes are already idempotent (unique-index dedup, pending-only settle guards) --
having both an in-process trigger and a future Scheduled Deployment fire concurrently cannot corrupt data,
only be redundant.
