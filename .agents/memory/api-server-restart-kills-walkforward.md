---
name: API server restart kills walk-forward
description: Every api-server workflow restart terminates an in-flight walk-forward run; the run must be re-triggered via HTTP after each restart.
---

## Rule

Never restart the api-server workflow (`WorkflowsRestart`) while a walk-forward is running. Check `evaluation_predictions` count first (a running walk-forward shows a steadily growing count; if count is frozen and the workflow was recently restarted, the run is dead).

## How to trigger walk-forward without blocking

Fire the HTTP request via a **background curl in a ShellExec that stays alive long enough for the server to receive it**, then let the server continue after curl dies:

```bash
curl -s -X POST http://127.0.0.1:8080/api/evaluation/walk-forward/run \
  -H "Content-Type: application/json" \
  -d '{"foldCount":4}' &
sleep 12
# Confirm the wipe happened (count drops to near-zero, then grows)
echo "SELECT COUNT(*) FROM evaluation_predictions WHERE run_kind='historical_test'" | psql "$DATABASE_URL" -t
```

The api-server keeps processing after curl times out. Monitor with:
```sql
SELECT COUNT(*) FROM evaluation_predictions WHERE run_kind='historical_test';
SELECT id, fold_index, test_metrics FROM evaluation_runs ORDER BY id DESC LIMIT 5;
```

## Why

Walk-forward runs synchronously in the api-server Node.js process. If the workflow is restarted (e.g. to pick up code changes), the in-flight computation is killed with no partial save. The `evaluation_predictions` table is wiped at the start of each new run, so partial data from an interrupted run doesn't persist either.

## How to apply

- Before any `WorkflowsRestart` of the api-server, check if a walk-forward is running.
- If yes: wait for it to finish, or accept re-triggering it after the restart.
- If changes are urgent (e.g. new route needed): restart, then immediately re-trigger the walk-forward.
- nohup/setsid background curl dies when ShellExec ends — use `&` + `sleep N` to confirm the server received the request before the shell exits.
