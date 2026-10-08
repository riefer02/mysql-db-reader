import { describe, expect, it } from "vitest";
import {
  shapeResult,
  buildPoolConfig,
  envInt,
  maxRowsFromEnv,
  DEFAULT_MAX_ROWS,
} from "../src/lib/sql";

describe("shapeResult", () => {
  it("returns the array unchanged when within the cap", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(shapeResult(rows, 5)).toBe(rows);
  });

  it("returns the array unchanged at exactly the cap", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(shapeResult(rows, 2)).toBe(rows);
  });

  it("truncates and annotates when over the cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = shapeResult(rows, 3);
    expect(result).toEqual({
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      truncated: true,
      rowsReturned: 3,
      maxRows: 3,
    });
  });

  it("annotates when truncation is signalled explicitly (streaming)", () => {
    // Streaming stops at exactly the cap, so length alone can't signal it.
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    expect(shapeResult(rows, 3, true)).toEqual({
      rows,
      truncated: true,
      rowsReturned: 3,
      maxRows: 3,
    });
  });

  it("exposes a 10k default", () => {
    expect(DEFAULT_MAX_ROWS).toBe(10_000);
  });
});

describe("maxRowsFromEnv", () => {
  it("defaults to 10k", () => {
    expect(maxRowsFromEnv({})).toBe(10_000);
  });

  it("honours MYSQL_MAX_ROWS", () => {
    expect(maxRowsFromEnv({ MYSQL_MAX_ROWS: "25" })).toBe(25);
  });

  it("ignores invalid values", () => {
    expect(maxRowsFromEnv({ MYSQL_MAX_ROWS: "lots" })).toBe(10_000);
  });
});

describe("envInt", () => {
  it("parses positive integers", () => {
    expect(envInt("25", 10)).toBe(25);
  });

  it.each([undefined, "", "0", "-3", "abc", "1.5"])(
    "falls back for %j",
    (value) => {
      expect(envInt(value as string | undefined, 10)).toBe(10);
    }
  );
});

describe("buildPoolConfig", () => {
  it("is safe and bounds the queue by default", () => {
    const config = buildPoolConfig("mysql://u:p@localhost:3306/db", {});
    expect(config.connectionLimit).toBe(3);
    expect(config.queueLimit).toBe(5);
    expect(config.waitForConnections).toBe(true);
    expect(config.resetOnRelease).toBe(true);
    expect(config.keepAliveInitialDelay).toBe(5_000);
    // Avoid lossy BIGINT numbers (strings only above 2^53).
    expect(config.supportBigNumbers).toBe(true);
    // Stacked statements must stay disabled.
    expect(config.multipleStatements).toBe(false);
    // SSL on by default, skipping hostname validation.
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    // Named placeholders are intentionally not enabled: the tool schemas pass
    // positional (array) parameters.
    expect(config).not.toHaveProperty("namedPlaceholders");
  });

  it("honours environment overrides", () => {
    const config = buildPoolConfig("mysql://u:p@localhost:3306/db", {
      MYSQL_CONNECTION_LIMIT: "4",
      MYSQL_QUEUE_LIMIT: "7",
      MYSQL_IDLE_TIMEOUT_MS: "1000",
      MYSQL_CONNECT_TIMEOUT_MS: "2500",
    });
    expect(config.connectionLimit).toBe(4);
    expect(config.maxIdle).toBe(4);
    expect(config.queueLimit).toBe(7);
    expect(config.idleTimeout).toBe(1000);
    expect(config.connectTimeout).toBe(2500);
  });

  it("ignores invalid overrides", () => {
    const config = buildPoolConfig("mysql://u:p@localhost:3306/db", {
      MYSQL_CONNECTION_LIMIT: "nope",
      MYSQL_QUEUE_LIMIT: "-1",
    });
    expect(config.connectionLimit).toBe(3);
    expect(config.queueLimit).toBe(5);
  });

  it("maps MYSQL_SSL to a mysql2 ssl option", () => {
    const base = "mysql://u:p@localhost:3306/db";
    expect(buildPoolConfig(base, { MYSQL_SSL: "false" }).ssl).toBeUndefined();
    expect(buildPoolConfig(base, { MYSQL_SSL: "strict" }).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(buildPoolConfig(base, { MYSQL_SSL: "true" }).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("keeps the connection string", () => {
    const config = buildPoolConfig("mysql://u:p@localhost:3306/db", {});
    expect(config.uri).toBe("mysql://u:p@localhost:3306/db");
  });
});
