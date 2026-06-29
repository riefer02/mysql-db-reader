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

const QUERY_TIMEOUT_MS = 30_000;

export function getReadOnlyPool(): Pool {
  if (pool) return pool;
  const connectionString = getConnectionString();
  // MYSQL_SSL controls TLS behavior:
  //   "true"   (default) — encrypt but skip cert hostname validation (use when connecting through a tunnel or proxy)
  //   "strict"           — encrypt and validate the server certificate (direct connections with valid cert)
  //   "false"            — no SSL (local dev only)
  const mysqlSsl = (process.env.MYSQL_SSL ?? "true").toLowerCase();
  const ssl =
    mysqlSsl === "false"  ? undefined :
    mysqlSsl === "strict" ? { rejectUnauthorized: true } :
                            { rejectUnauthorized: false };
  pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 3,         // sequential AI tool — 3 is plenty
    connectTimeout: 10_000,     // fail fast if DB is unreachable
    waitForConnections: true,
    queueLimit: 5,              // fail fast beyond 5 queued; 0 = unbounded
    enableKeepAlive: true,
    keepAliveInitialDelay: 5_000,
    namedPlaceholders: true,
    ssl,
  } as any);
  return pool;
}

export async function withReadOnlyConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const p = getReadOnlyPool();
  const conn = await p.getConnection();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // destroy() closes the socket and removes the connection from the pool,
    // freeing the slot even if the DB is unresponsive.
    conn.destroy();
  }, QUERY_TIMEOUT_MS);
  try {
    await conn.query("SET SESSION SQL_SAFE_UPDATES = 1");
    // START TRANSACTION READ ONLY enforces read-only at the engine level for this operation.
    // Supported since MySQL 5.6 / MariaDB 10.0.
    await conn.query("START TRANSACTION READ ONLY");
    try {
      const result = await fn(conn);
      clearTimeout(timer);
      await conn.query("ROLLBACK");
      return result;
    } catch (err) {
      if (timedOut) throw new Error(`Query timed out after ${QUERY_TIMEOUT_MS / 1000}s`);
      try { await conn.query("ROLLBACK"); } catch {}
      throw err;
    }
  } finally {
    clearTimeout(timer);
    if (!timedOut) conn.release();
  }
}

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
  // Block SELECT INTO OUTFILE / DUMPFILE which can write server-side files.
  if (/\binto\s+(outfile|dumpfile)\b/.test(normalized)) {
    throw new Error("SELECT INTO OUTFILE/DUMPFILE is not allowed.");
  }
  // For CTEs (WITH), the terminal statement must be a SELECT with no DML.
  if (firstWord === "with") {
    const lowered = normalized.replace(/\s+/g, " ");
    if (
      !/\bselect\b/.test(lowered) ||
      /\b(insert|update|delete|replace)\b/.test(lowered)
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
