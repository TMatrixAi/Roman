interface DbErrorLike {
  message?: string;
  code?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  schema?: string;
  severity?: string;
  routine?: string;
  file?: string;
  line?: string;
  hostname?: string;
}

interface QueryErrorLike extends DbErrorLike {
  query?: string;
  params?: unknown[];
  cause?: DbErrorLike;
}

export interface StructuredDatabaseError {
  status: number;
  body: {
    error: string;
    code: string;
    detail: string;
    sqlState?: string;
    column?: string;
    constraint?: string;
    table?: string;
  };
  log: {
    query?: string;
    params?: unknown[];
    cause?: Record<string, unknown>;
  };
}

function asObject(err: unknown): QueryErrorLike {
  return (err as QueryErrorLike) ?? {};
}

function classifySqlState(code: string | undefined): { status: number; error: string; apiCode: string } {
  if (!code) return { status: 500, error: "Database query failed", apiCode: "DB_QUERY_FAILED" };
  if (code === "23505") return { status: 409, error: "Duplicate prediction identity", apiCode: "DB_UNIQUE_VIOLATION" };
  if (code === "23502") return { status: 422, error: "Missing required database field", apiCode: "DB_NOT_NULL_VIOLATION" };
  if (code === "23514") return { status: 422, error: "Check constraint violation", apiCode: "DB_CHECK_VIOLATION" };
  if (code === "22P02") return { status: 422, error: "Invalid value format", apiCode: "DB_INVALID_TEXT_REPRESENTATION" };
  if (code === "22001") return { status: 422, error: "Value exceeds column length", apiCode: "DB_VALUE_TOO_LONG" };
  if (code === "22003") return { status: 422, error: "Numeric value out of range", apiCode: "DB_NUMERIC_OVERFLOW" };
  if (code === "42703") return { status: 500, error: "Database schema mismatch: missing column", apiCode: "DB_SCHEMA_COLUMN_MISSING" };
  if (code === "42P01") return { status: 500, error: "Database schema mismatch: missing table", apiCode: "DB_SCHEMA_TABLE_MISSING" };
  if (code === "42804") return { status: 500, error: "Database schema mismatch: type mismatch", apiCode: "DB_SCHEMA_TYPE_MISMATCH" };
  if (code.startsWith("08")) return { status: 503, error: "Database connection failed", apiCode: "DB_CONNECTION_FAILED" };
  return { status: 500, error: "Database query failed", apiCode: "DB_QUERY_FAILED" };
}

/**
 * Converts Drizzle/pg insert failures into stable API JSON that frontend can render safely.
 */
export function formatDatabaseError(err: unknown, fallbackDetail: string): StructuredDatabaseError {
  const q = asObject(err);
  const cause = asObject(q.cause);

  if (cause.code === "ENOTFOUND") {
    const host = cause.hostname ?? "unknown-host";
    return {
      status: 503,
      body: {
        error: "Database host could not be resolved",
        code: "DB_HOST_UNRESOLVED",
        detail: `Database hostname \"${host}\" could not be resolved from this runtime.`,
      },
      log: {
        query: q.query,
        params: q.params,
        cause: {
          code: cause.code,
          message: cause.message,
          hostname: cause.hostname,
        },
      },
    };
  }

  const sqlState = cause.code ?? q.code;
  const classification = classifySqlState(sqlState);
  return {
    status: classification.status,
    body: {
      error: classification.error,
      code: classification.apiCode,
      detail: cause.detail ?? cause.message ?? q.message ?? fallbackDetail,
      sqlState,
      column: cause.column ?? q.column,
      constraint: cause.constraint ?? q.constraint,
      table: cause.table ?? q.table,
    },
    log: {
      query: q.query,
      params: q.params,
      cause: {
        code: cause.code,
        message: cause.message,
        detail: cause.detail,
        constraint: cause.constraint,
        column: cause.column,
        table: cause.table,
        schema: cause.schema,
        severity: cause.severity,
        routine: cause.routine,
        file: cause.file,
        line: cause.line,
      },
    },
  };
}
