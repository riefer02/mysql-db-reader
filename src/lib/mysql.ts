import mysql, { type Pool, type PoolConnection } from "mysql2/promise";

const DEFAULT_ENV_KEYS = [
  "MYSQL_URL",
  "MYSQL_CONNECTION_STRING",
  "DATABASE_URL",
];

let pool: Pool | null = null;

function getConnectionString(): string {
  for (const key of DEFAULT_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value.trim();
  }
  throw new Error(
    `Missing MySQL connection string. Set one of env vars: ${DEFAULT_ENV_KEYS.join(
      ", "
    )}`
  );
}

export function getReadOnlyPool(): Pool {
  if (pool) return pool;
  const connectionString = getConnectionString();
  pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 5_000,
    namedPlaceholders: true,
  } as any);
  return pool;
}

export async function withReadOnlyConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const p = getReadOnlyPool();
  const conn = await p.getConnection();
  try {
    // Harden session to be read-only where supported
    // MySQL: SET SESSION TRANSACTION READ ONLY affects next transactions; we still set sql_safe_updates
    await conn.query("SET SESSION SQL_SAFE_UPDATES = 1");
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    // Not all MySQL variants accept the following; ignore errors silently
    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY");
    } catch {}
    return await fn(conn);
  } finally {
    conn.release();
  }
}

const FORBIDDEN_START = [
  "insert",
  "update",
  "delete",
  "replace",
  "alter",
  "create",
  "drop",
  "truncate",
  "rename",
  "grant",
  "revoke",
  "call",
  "load",
  "lock",
  "unlock",
  "optimize",
  "analyze",
  "repair",
  "flush",
  "reset",
  "kill",
  "set",
];

export function assertReadOnlySql(sql: string): void {
  const normalized = sql.trim().toLowerCase();
  const firstWord = normalized.split(/\s+/)[0] ?? "";
  const allowedFirst = [
    "select",
    "show",
    "describe",
    "desc",
    "explain",
    "with",
  ];
  if (!allowedFirst.includes(firstWord)) {
    throw new Error(
      `Only read-only queries are allowed. Query must start with one of: ${allowedFirst.join(
        ", "
      )}`
    );
  }
  for (const f of FORBIDDEN_START) {
    if (normalized.startsWith(f + " ")) {
      throw new Error("Mutation statements are not allowed.");
    }
  }
  // Basic guard for WITH used with DML (not exhaustive)
  if (firstWord === "with") {
    const lowered = normalized.replace(/\s+/g, " ");
    if (
      !/\bselect\b/.test(lowered) ||
      /\b(insert|update|delete)\b/.test(lowered)
    ) {
      throw new Error(
        "WITH queries must be read-only and include SELECT only."
      );
    }
  }
}

export function assertSafeIdentifier(value: string, kind: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Invalid ${kind} identifier: ${value}`);
  }
}

export function coerceRows(rows: any[]): any[] {
  return rows.map((row) => {
    const coerced: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "bigint") coerced[k] = v.toString();
      else coerced[k] = v as unknown;
    }
    return coerced;
  });
}
