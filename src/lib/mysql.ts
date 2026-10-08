import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import {
  buildPoolConfig,
  coerceValue,
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

export interface StreamedRows {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/**
 * Streams a query and stops as soon as more than `maxRows` rows are seen,
 * aborting the connection so the remaining rows are never transferred. Unlike
 * wrapping SQL in `SELECT * FROM (...) LIMIT n`, this is safe for arbitrary
 * statements (JOINs with duplicate column names, SHOW/EXPLAIN, etc.).
 *
 * The connection is destroyed on early abort; `withReadOnlyConnection` tolerates
 * that (its ROLLBACK/release are best-effort).
 */
export function streamQuery(
  conn: PoolConnection,
  sql: string,
  params: unknown[],
  maxRows: number
): Promise<StreamedRows> {
  return new Promise((resolve, reject) => {
    const core = (
      conn as unknown as {
        connection: {
          query: (sql: string, values: unknown[]) => NodeJS.EventEmitter;
        };
      }
    ).connection;

    const query = core.query(sql, params);
    const rows: Record<string, unknown>[] = [];
    const limit = maxRows + 1;
    let settled = false;
    let aborted = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    query.on("result", (row: unknown) => {
      if (aborted) return;
      rows.push(coerceValue(row) as Record<string, unknown>);
      if (rows.length >= limit) {
        aborted = true;
        try {
          conn.destroy();
        } catch {}
        settle(() =>
          resolve({ rows: rows.slice(0, maxRows), truncated: true })
        );
      }
    });
    query.on("error", (err: Error) => {
      if (aborted) return;
      settle(() => reject(err));
    });
    query.on("end", () => {
      if (aborted) return;
      settle(() => resolve({ rows, truncated: false }));
    });
  });
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
  fn: (conn: PoolConnection) => Promise<T>,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const p = getReadOnlyPool();
  const conn = await p.getConnection();
  // Server-side MAX_EXECUTION_TIME follows the configured budget; the wall-clock
  // timer can be overridden (used by tests to isolate the client-side abort).
  const sessionTimeoutMs = queryTimeoutMs();
  const timeoutMs = options.timeoutMs ?? sessionTimeoutMs;
  const abortMessage = `Query exceeded the ${timeoutMs}ms time limit and was aborted.`;

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await applySessionHardening(conn, sessionTimeoutMs);
    // Engine-level read-only enforcement for this operation (MySQL 5.6+ /
    // MariaDB 10.0+). The SQL guard is still the first line of defence.
    await conn.query("START TRANSACTION READ ONLY");

    // Race the work against an explicit timeout. Destroying the connection
    // alone does not reject an in-flight query, so the race is what actually
    // surfaces the timeout; destroy() frees the pool slot.
    const work = fn(conn);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          conn.destroy();
        } catch {}
        reject(new Error(abortMessage));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([work, timeout]);
      // Best-effort: the connection may have been destroyed by streamQuery
      // (row cap) or the timeout timer.
      try {
        await conn.query("ROLLBACK");
      } catch {}
      return result;
    } catch (err) {
      try {
        await conn.query("ROLLBACK");
      } catch {}
      if (timedOut) throw new Error(abortMessage);
      throw err;
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (!timedOut) {
      try {
        conn.release();
      } catch {}
    }
  }
}
