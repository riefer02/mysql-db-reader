import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getReadOnlyPool, withReadOnlyConnection } from "../src/lib/mysql";
import listDatabases from "../src/tools/mysql_list_databases";
import listTables from "../src/tools/mysql_list_tables";
import getTableSchema from "../src/tools/mysql_get_table_schema";
import previewTable from "../src/tools/mysql_preview_table";
import query from "../src/tools/mysql_query";
import explainQuery from "../src/tools/mysql_explain_query";

/**
 * These tests exercise a real MySQL server. They are skipped unless
 * MYSQL_TEST_URL points at a database, e.g.
 *
 *   MYSQL_TEST_URL="mysql://reader:pass@localhost:3306/test" pnpm test
 *
 * Every test here is read-only; nothing is written or dropped.
 */
const testUrl = process.env.MYSQL_TEST_URL;
const hasDb = Boolean(testUrl);

/** The tools return MCP content blocks; decode the JSON payload. */
function payload(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe.skipIf(!hasDb)("integration (requires MYSQL_TEST_URL)", () => {
  beforeAll(() => {
    process.env.MYSQL_URL = testUrl as string;
  });

  afterAll(async () => {
    await closePool();
  });

  it("lists databases", async () => {
    const dbs = payload(await listDatabases({ includeSystem: false }));
    expect(Array.isArray(dbs)).toBe(true);
    expect(dbs.length).toBeGreaterThan(0);
  });

  it("lists tables and returns schema for the first one", async () => {
    const db = payload(await listDatabases({ includeSystem: false }))[0]
      .databaseName as string;
    const tables = payload(
      await listTables({ database: db, includeViews: false })
    );
    expect(Array.isArray(tables)).toBe(true);
    if (tables.length === 0) return; // empty database - nothing more to check

    const table = (tables[0] as { tableName: string }).tableName;
    const schema = payload(await getTableSchema({ database: db, table }));
    expect(Array.isArray(schema.columns)).toBe(true);
    expect(schema.columns.length).toBeGreaterThan(0);
    expect(schema.indexes).toBeDefined();

    const rows = payload(
      await previewTable({ database: db, table, limit: 1, orderBy: undefined })
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("runs a parameterised query", async () => {
    const rows = payload(
      await query({ sql: "SELECT ? AS answer", params: ["hello"] })
    );
    expect(rows[0].answer).toBe("hello");
  });

  it("returns bigints as strings and dates as ISO", async () => {
    const rows = payload(
      await query({
        sql: "SELECT CAST(9007199254740993 AS UNSIGNED) AS n, CAST('2020-01-01 00:00:00' AS DATETIME) AS d",
        params: [],
      })
    );
    expect(rows[0].n).toBe("9007199254740993");
    expect(rows[0].d).toMatch(/^2020-01-01/);
  });

  it("explains a query", async () => {
    const rows = payload(await explainQuery({ sql: "SELECT 1" }));
    expect(Array.isArray(rows)).toBe(true);
  });

  it("rejects mutations before touching the database", async () => {
    await expect(
      query({ sql: "INSERT INTO t VALUES (1)", params: [] })
    ).rejects.toThrow(/Only read-only queries/);
    await expect(
      query({ sql: "SELECT 1 INTO OUTFILE '/tmp/x'", params: [] })
    ).rejects.toThrow(/OUTFILE/);
  });

  it("resets session state when a connection is released", async () => {
    const pool = getReadOnlyPool();
    const c1 = await pool.getConnection();
    await c1.query("SET @leak = 123");
    c1.release();

    const c2 = await pool.getConnection();
    const [rows] = await c2.query("SELECT @leak AS leak");
    c2.release();
    expect((rows as Array<{ leak: unknown }>)[0].leak).toBeNull();
  });

  it("aborts queries that exceed the time limit", async () => {
    const previous = process.env.MYSQL_QUERY_TIMEOUT_MS;
    process.env.MYSQL_QUERY_TIMEOUT_MS = "800";
    try {
      const started = Date.now();
      await expect(
        withReadOnlyConnection((conn) => conn.query("SELECT SLEEP(5)"))
      ).rejects.toThrow(/time limit|maximum statement execution time/i);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      if (previous === undefined) delete process.env.MYSQL_QUERY_TIMEOUT_MS;
      else process.env.MYSQL_QUERY_TIMEOUT_MS = previous;
    }
  });
});
