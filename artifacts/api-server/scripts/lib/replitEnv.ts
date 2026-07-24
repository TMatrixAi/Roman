import { lookup } from "node:dns/promises";

export function parseDatabaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
}

export function getDatabaseUrlOrThrow(): string {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Set it before running this pipeline (Replit sets this automatically).",
    );
  }
  return databaseUrl;
}

export function buildReplitHeliumHint(command: string): string {
  return [
    "Database host 'helium' is only resolvable inside Replit runtime.",
    "Run this script in Replit shell (same repo), not from Codespaces/local shell.",
    `Command: ${command}`,
  ].join(" ");
}

export function detectDbHostResolutionHint(err: unknown, command: string): string | null {
  const e = err as { code?: string; hostname?: string; cause?: { code?: string; hostname?: string } };
  const code = e?.code ?? e?.cause?.code;
  const hostname = e?.hostname ?? e?.cause?.hostname;
  if (code === "ENOTFOUND" && hostname === "helium") {
    return buildReplitHeliumHint(command);
  }
  return null;
}

export async function ensureDatabaseHostResolvable(commandForHint: string): Promise<string> {
  const databaseUrl = getDatabaseUrlOrThrow();
  const host = parseDatabaseHost(databaseUrl);

  try {
    await lookup(host);
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "ENOTFOUND") {
      if (host === "helium") {
        throw new Error(buildReplitHeliumHint(commandForHint));
      }
      throw new Error(`Database host '${host}' is not resolvable (ENOTFOUND).`);
    }
    throw err;
  }

  return host;
}
