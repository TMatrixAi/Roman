import { db, evaluationRunsTable } from "@workspace/db";
const rows = await db.select().from(evaluationRunsTable);
console.log("evaluation_runs count:", rows.length, "latest createdAt:", rows.length ? rows[rows.length-1].createdAt : null);
process.exit(0);
