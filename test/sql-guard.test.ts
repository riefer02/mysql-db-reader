import { describe, expect, it } from "vitest";
import { assertReadOnlySql } from "../src/lib/sql";

describe("assertReadOnlySql — allowed statements", () => {
  const allowed = [
    "SELECT 1",
    "select * from users limit 5",
    "  SELECT NOW()  ",
    "SHOW TABLES",
    "show full processlist",
    "DESCRIBE users",
    "DESC users",
    "EXPLAIN SELECT * FROM users",
    "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte",
    "select 1;",
    "SELECT id, COUNT(*) FROM orders GROUP BY id",
    "SELECT * FROM a UNION SELECT * FROM b",
    "select * from t where name = 'select into outfile'",
    // Leading comments are stripped before the check, then must start read-only.
    "/* comment */ SELECT 1",
    "-- comment\nSELECT 1",
    "# comment\nSELECT 1",
  ];

  it.each(allowed)("allows %j", (sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it("returns the trimmed statement", () => {
    expect(assertReadOnlySql("  SELECT 1  ")).toBe("SELECT 1");
  });
});

describe("assertReadOnlySql — rejected statements", () => {
  const rejected = [
    "",
    "   ",
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "REPLACE INTO t VALUES (1)",
    "DROP TABLE t",
    "ALTER TABLE t ADD COLUMN c INT",
    "CREATE TABLE t (id INT)",
    "TRUNCATE TABLE t",
    "GRANT ALL ON *.* TO 'x'@'%'",
    "REVOKE ALL ON *.* FROM 'x'@'%'",
    "CALL some_proc()",
    "SET GLOBAL general_log = 1",
    "LOAD DATA INFILE '/tmp/x' INTO TABLE t",
    "LOCK TABLES t WRITE",
    "UNLOCK TABLES",
    "WITH cte AS (SELECT 1) DELETE FROM t",
    "WITH cte AS (SELECT 1) UPDATE t SET a = 1",
    "WITH cte AS (SELECT 1) REPLACE INTO t VALUES (1)",
    "SELECT 1; DROP TABLE users",
    "SELECT 1; DROP TABLE users;",
    "SELECT 1 INTO OUTFILE '/tmp/dump'",
    "SELECT 1 INTO DUMPFILE '/tmp/dump'",
    "SELECT 1 INTO @x",
    "SELECT * FROM t FOR UPDATE",
    "SELECT * FROM t FOR SHARE",
    "SELECT * FROM t LOCK IN SHARE MODE",
    "SELECT SLEEP(30)",
    "SELECT BENCHMARK(1000000, MD5('a'))",
    "SELECT LOAD_FILE('/etc/passwd')",
    "SELECT GET_LOCK('lock', 10)",
    "SELECT RELEASE_LOCK('lock')",
    "SELECT * FROM t PROCEDURE ANALYSE()",
    "EXPLAIN ANALYZE SELECT * FROM users",
    // Comment-based obfuscation must not bypass the guards.
    "SELECT 1 INTO/**/OUTFILE '/tmp/x'",
    "SELECT * FROM t FOR/**/UPDATE",
    "SEL/**/ECT 1",
    "SELECT 1 /*! ; DROP TABLE t */",
  ];

  it.each(rejected)("rejects %j", (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow();
  });

  it("allows EXPLAIN ANALYZE only when explicitly opted in", () => {
    expect(() =>
      assertReadOnlySql("EXPLAIN ANALYZE SELECT 1", {
        allowExplainAnalyze: true,
      })
    ).not.toThrow();
  });

  it("does not reject forbidden words inside string literals", () => {
    expect(() =>
      assertReadOnlySql("SELECT * FROM t WHERE note = 'please delete me'")
    ).not.toThrow();
  });
});
