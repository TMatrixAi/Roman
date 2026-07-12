---
name: Sandbox background process limits
description: ShellExec-spawned background processes (nohup/setsid/disown) get killed when the tool call session ends; long jobs must run inside a persistent workflow instead.
---

In this environment, processes started in the background from a ShellExec call (even with
`nohup`, `setsid`, and `disown`) do NOT survive past that ShellExec call returning -- they get
reaped along with the shell session. This is easy to misdiagnose as the job itself hanging,
especially when a slow-but-working long computation looks identical to a genuinely stuck one
(near-zero CPU sampled right after the kill, no further log output).

**Why this matters:** a multi-minute job (e.g. a full walk-forward backtest run) cannot be kicked
off via `nohup ... &` from ShellExec and polled across later tool calls -- it will silently die
between calls, and checking `ps aux` afterward will show nothing running, which looks like "it
finished" or "it was never hung" when actually it was just killed.

**How to apply:** to run something that takes longer than one ShellExec call's ~5 minute budget,
trigger it through a process that is NOT tied to the shell session -- e.g. fire an HTTP request at
an already-running workflow's server (`curl ... &` against the dev server, then `disown`). The
Express/Node handler keeps running server-side to completion even if the `curl` client itself
gets killed or times out (a plain route with no abort-on-disconnect handling doesn't cancel the
in-flight work). Poll completion by querying the database or workflow logs from later, separate
ShellExec calls instead of waiting on the original process.
