import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import {
  buildPoolConfig,
  envInt,
  DEFAULT_QUERY_TIMEOUT_MS,
} from "./sql";

export * from "./sql";

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
  // `as any`: mysql2's PoolOptions typing does not expose `uri` here, though
  // the implementation supports it.
  pool = mysql.createPool(buildPoolConfig(connectionString) as any);
  return pool;
}

/** Closes the shared pool. Intended for process shutdown and tests. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

export function queryTimeoutMs(): number {
  return envInt(process.env.MYSQL_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS);
}

/**
 * Best-effort session settings. None of these is the security boundary (that is
 * the SQL guard plus a `SELECT`-only account plus the read-only transaction), so
 * failures are ignored to stay compatible with proxies and non-MySQL variants.
 */
async function applySessionHardening(
  conn: PoolConnection,
  timeoutMs: number
): Promise<void> {
  const statements = [
    "SET SESSION SQL_SAFE_UPDATES = 1",
    `SET SESSION MAX_EXECUTION_TIME = ${timeoutMs}`,
  ];
  for (const statement of statements) {
    try {
      await conn.query(statement);
    } catch {}
  }
}

/**
 * Runs `fn` against a hardened connection.
 *
 * Read-only is enforced at the engine level with `START TRANSACTION READ ONLY`
 * (fails loudly, unlike a session flag). A wall-clock timeout destroys the
 * connection — freeing the pool slot even if the server is unresponsive —
 * rather than returning a poisoned connection to the pool.
 */
export async function withReadOnlyConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const p = getReadOnlyPool();
  const conn = await p.getConnection();
  const timeoutMs = queryTimeoutMs();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      conn.destroy();
    } catch {}
  }, timeoutMs);

  try {
    await applySessionHardening(conn, timeoutMs);
    // Engine-level read-only enforcement for this operation (MySQL 5.6+ /
    // MariaDB 10.0+). The SQL guard is still the first line of defence.
    await conn.query("START TRANSACTION READ ONLY");
    try {
      const result = await fn(conn);
      await conn.query("ROLLBACK");
      return result;
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `Query exceeded the ${timeoutMs}ms time limit and was aborted.`
        );
      }
      try {
        await conn.query("ROLLBACK");
      } catch {}
      throw err;
    }
  } finally {
    clearTimeout(timer);
    if (!timedOut) {
      try {
        conn.release();
      } catch {}
    }
  }
}
