/**
 * Pure, database-independent helpers for the MySQL reader tools.
 *
 * Nothing in this file opens a connection or reads the environment, which
 * makes every function here unit-testable without a live MySQL server.
 */

export const ALLOWED_STATEMENT_STARTS = [
  "select",
  "show",
  "describe",
  "desc",
  "explain",
  "with",
] as const;

export const DEFAULT_MAX_ROWS = 10_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export interface ReadOnlyOptions {
  /**
   * Allow `EXPLAIN ANALYZE`, which actually executes the statement. Off by
   * default because execution can trigger side-effecting functions.
   */
  allowExplainAnalyze?: boolean;
}

interface ForbiddenPattern {
  re: RegExp;
  message: string;
}

/**
 * Constructs that begin with an allowed keyword but are unsafe for a
 * read-only tool: server-side file writes, row locks, session mutation via
 * user variables, and functions that sleep, benchmark, grab locks, or read
 * arbitrary server files.
 */
const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    re: /\binto\s+(outfile|dumpfile)\b/,
    message: "SELECT ... INTO OUTFILE/DUMPFILE is not allowed.",
  },
  {
    re: /\binto\s+@/,
    message: "SELECT ... INTO @variable is not allowed.",
  },
  {
    re: /\bfor\s+update\b/,
    message: "SELECT ... FOR UPDATE (row locking) is not allowed.",
  },
  {
    re: /\bfor\s+share\b/,
    message: "SELECT ... FOR SHARE (row locking) is not allowed.",
  },
  {
    re: /\block\s+in\s+share\s+mode\b/,
    message: "LOCK IN SHARE MODE (row locking) is not allowed.",
  },
  {
    re: /\bprocedure\s+analyse\b/,
    message: "PROCEDURE ANALYSE is not allowed.",
  },
  { re: /\bsleep\s*\(/, message: "SLEEP() is not allowed." },
  { re: /\bbenchmark\s*\(/, message: "BENCHMARK() is not allowed." },
  { re: /\bget_lock\s*\(/, message: "GET_LOCK() is not allowed." },
  { re: /\brelease_lock\s*\(/, message: "RELEASE_LOCK() is not allowed." },
  { re: /\bload_file\s*\(/, message: "LOAD_FILE() is not allowed." },
];

const DML_KEYWORDS = /\b(insert|update|delete|replace|merge)\b/;

/**
 * Normalises SQL before guard checks:
 *  1. Unwraps executable comments (`/*! ... *\/`) so their SQL is inspected,
 *     and removes ordinary block/line comments and `#` comments. MySQL
 *     executes the contents of executable comments, and comments can sit
 *     between tokens (`INTO/**\/OUTFILE`), so this closes that bypass.
 *  2. Blanks out quoted strings and backtick identifiers so data like
 *     `'into outfile'` doesn't trip the keyword patterns.
 */
export function normalizeSqlForGuards(sql: string): string {
  const withoutComments = sql
    // Unwrap executable comments, keeping their inner SQL.
    .replace(/\/\*!(?:\d+)?([\s\S]*?)\*\//g, " $1 ")
    // Remove ordinary block comments.
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // Remove `-- ` line comments and `#` comments.
    .replace(/--\s[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ");

  return withoutComments
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`[^`]*`/g, "``")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Validates that `sql` is a single, read-only statement. Throws with a
 * human-readable message when it is not.
 *
 * This is a guardrail, not a security boundary: combine it with a
 * `SELECT`-only account and an engine-level read-only transaction.
 */
export function assertReadOnlySql(
  sql: string,
  options: ReadOnlyOptions = {}
): string {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error("SQL statement must be a non-empty string.");
  }

  const normalized = normalizeSqlForGuards(sql);

  // Defence in depth: mysql2 disables multipleStatements by default, but
  // reject stacked statements outright rather than relying on the driver.
  if (normalized.replace(/;\s*$/, "").includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  const firstWord = normalized.split(/\s+/)[0] ?? "";
  if (!(ALLOWED_STATEMENT_STARTS as readonly string[]).includes(firstWord)) {
    throw new Error(
      `Only read-only queries are allowed. Query must start with one of: ${ALLOWED_STATEMENT_STARTS.join(
        ", "
      )}`
    );
  }

  if (firstWord === "with") {
    if (!/\bselect\b/.test(normalized) || DML_KEYWORDS.test(normalized)) {
      throw new Error("WITH queries must be read-only and include SELECT only.");
    }
  }

  for (const { re, message } of FORBIDDEN_PATTERNS) {
    if (re.test(normalized)) throw new Error(message);
  }

  if (
    !options.allowExplainAnalyze &&
    /\bexplain\s+analyze\b/.test(normalized)
  ) {
    throw new Error(
      "EXPLAIN ANALYZE executes the statement and is not allowed. Use mysql_explain_query."
    );
  }

  return sql.trim();
}

/**
 * Restricts a schema/table/column identifier to a conservative allowlist so it
 * can be safely backtick-quoted into a statement.
 */
export function assertSafeIdentifier(value: string, kind: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Invalid ${kind} identifier: ${value}`);
  }
}

/**
 * Recursively converts driver-specific values into JSON-safe values:
 * `bigint` -> string, `Buffer` -> base64 string. Nested arrays/objects
 * (e.g. JSON columns) are handled too; `Date` and other class instances are
 * preserved so they aren't flattened to `{}`.
 */
export function coerceValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(coerceValue);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = coerceValue(v);
  }
  return out;
}

export function coerceRows(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => coerceValue(row) as Record<string, unknown>);
}

/**
 * Normalises an `ORDER BY` clause of the form `column [ASC|DESC]` into a
 * safely-quoted fragment, or `null` when no ordering was requested.
 */
export function buildOrderBy(orderBy?: string): string | null {
  if (!orderBy || !orderBy.trim()) return null;
  const parts = orderBy.trim().split(/\s+/);
  const column = parts[0];
  if (!column) return null;
  const dir = (parts[1] ?? "ASC").toUpperCase();
  assertSafeIdentifier(column, "column");
  if (dir !== "ASC" && dir !== "DESC") {
    throw new Error("Invalid sort direction. Use ASC or DESC.");
  }
  return `ORDER BY \`${column}\` ${dir}`;
}

export interface TruncatedResult {
  rows: Record<string, unknown>[];
  truncated: true;
  rowsReturned: number;
  maxRows: number;
}

/**
 * Applies the row cap to rows and annotates the result when truncation
 * happened. Pass `truncated` explicitly when the caller already knows (e.g.
 * streaming stopped early); otherwise it is inferred from the row count.
 */
export function shapeResult(
  rows: Record<string, unknown>[],
  maxRows: number = DEFAULT_MAX_ROWS,
  truncated: boolean = rows.length > maxRows
): Record<string, unknown>[] | TruncatedResult {
  if (!truncated && rows.length <= maxRows) return rows;
  const limited = rows.slice(0, maxRows);
  return {
    rows: limited,
    truncated: true,
    rowsReturned: limited.length,
    maxRows,
  };
}

/** Resolves the row cap, overridable with `MYSQL_MAX_ROWS`. */
export function maxRowsFromEnv(
  env: Record<string, string | undefined> = process.env
): number {
  return envInt(env.MYSQL_MAX_ROWS, DEFAULT_MAX_ROWS);
}

/** Reads a positive integer from an env-like map, falling back to `fallback`. */
export function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export interface PoolConfigLike {
  uri: string;
  connectionLimit: number;
  maxIdle: number;
  idleTimeout: number;
  waitForConnections: boolean;
  queueLimit: number;
  enableKeepAlive: boolean;
  keepAliveInitialDelay: number;
  connectTimeout: number;
  resetOnRelease: boolean;
  supportBigNumbers: boolean;
  multipleStatements: boolean;
  ssl: { rejectUnauthorized: boolean } | undefined;
}

/**
 * Resolves `MYSQL_SSL` into a mysql2 `ssl` option:
 *   "true"   (default) — encrypt but skip cert hostname validation
 *   "strict"           — encrypt and validate the server certificate
 *   "false"            — no SSL (local dev only)
 */
export function buildSslConfig(
  value: string | undefined
): { rejectUnauthorized: boolean } | undefined {
  const mode = (value ?? "true").toLowerCase();
  if (mode === "false") return undefined;
  if (mode === "strict") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/**
 * Builds the pool configuration. Kept pure so the safety-relevant values
 * (`queueLimit`, `resetOnRelease`, `multipleStatements`, `supportBigNumbers`,
 * `ssl`) can be asserted in tests without connecting to a database.
 */
export function buildPoolConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env
): PoolConfigLike {
  // A sequential AI tool needs very few connections; fail fast beyond them.
  const connectionLimit = envInt(env.MYSQL_CONNECTION_LIMIT, 3);
  return {
    uri: connectionString,
    connectionLimit,
    maxIdle: connectionLimit,
    idleTimeout: envInt(env.MYSQL_IDLE_TIMEOUT_MS, 60_000),
    waitForConnections: true,
    queueLimit: envInt(env.MYSQL_QUEUE_LIMIT, 5),
    enableKeepAlive: true,
    keepAliveInitialDelay: 5_000,
    connectTimeout: envInt(env.MYSQL_CONNECT_TIMEOUT_MS, 10_000),
    resetOnRelease: true,
    // Return BIGINT as strings only when the value can't be represented safely
    // (above 2^53); smaller integers stay numbers.
    supportBigNumbers: true,
    // Defence in depth: never allow `;`-stacked statements.
    multipleStatements: false,
    ssl: buildSslConfig(env.MYSQL_SSL),
  };
}
