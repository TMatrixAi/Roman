import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Applies raw SQL that drizzle-kit's schema-diff push cannot express (functions,
 * triggers). Idempotent -- every file here is safe to re-run on every push. Run
 * automatically after `drizzle-kit push` via the `push`/`push-force` scripts.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = ["sql/immutability-trigger.sql", "sql/predictions-forward-compat.sql"];

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf-8");
      console.log(`Applying ${file}...`);
      await pool.query(sql);
    }
    console.log("SQL extras applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
