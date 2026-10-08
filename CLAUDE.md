# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm i           # Install dependencies
pnpm build       # Build the project (xmcp build)
pnpm dev         # Run development server (xmcp dev) - HTTP server on port 3001
pnpm start       # Run production HTTP server (node dist/http.js)
pnpm test        # Run unit tests (vitest)
pnpm typecheck   # tsc --noEmit
```

For a different port: `PORT=3001 pnpm dev`

## Database Connection

Set one of these env vars (first found wins): `MYSQL_URL`, `MYSQL_CONNECTION_STRING`, or `DATABASE_URL`

```bash
export MYSQL_URL="mysql://user:password@localhost:3306/mydb"
```

## Architecture

This is an MCP (Model Context Protocol) server built with `xmcp` that provides read-only MySQL database access tools.

### Project Structure

- `src/tools/` - MCP tool implementations (one file per tool)
- `src/lib/sql.ts` - Pure, DB-independent helpers (SQL guard, identifier check, row coercion, order-by, result shaping, pool config). Unit-tested.
- `src/lib/mysql.ts` - Shared MySQL connection pool, session hardening, and timeout wrapper; re-exports `src/lib/sql.ts`.
- `test/` - Vitest unit tests; `test/integration.test.ts` self-skips unless `MYSQL_TEST_URL` is set
- `xmcp.config.ts` - xmcp configuration (HTTP on loopback + STDIO transports)
- `dist/stdio.js` - Built STDIO entry point for Cursor/CLI MCP clients
- `dist/http.js` - Built HTTP entry point

### Tool Definition Pattern

Each tool in `src/tools/` exports:
- `schema` - Zod object defining parameters
- `metadata` - Tool name, description, and annotations (readOnlyHint, destructiveHint, idempotentHint)
- `default` function - The tool implementation

### Read-Only Safety

All database access is read-only, enforced in layers:
1. `assertReadOnlySql()` (`src/lib/sql.ts`) - validates the statement starts with SELECT/SHOW/DESCRIBE/EXPLAIN/WITH, rejects stacked statements, and blocks unsafe constructs (INTO OUTFILE/DUMPFILE, INTO @var, FOR UPDATE/FOR SHARE, EXPLAIN ANALYZE, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE). Quoted string/identifier contents are ignored by the keyword checks.
2. `assertSafeIdentifier()` - validates database/table/column names against `[A-Za-z0-9_]+` before quoting.
3. Session hardening in `withReadOnlyConnection()`: `SQL_SAFE_UPDATES=1`, READ COMMITTED, `TRANSACTION READ ONLY`, and `MAX_EXECUTION_TIME` (all best-effort).
4. Wall-clock timeout drops the connection if a request exceeds `MYSQL_QUERY_TIMEOUT_MS`.
5. Pool is bounded (`queueLimit`), resets connections on release, and never enables `multipleStatements`.
6. `mysql_query` truncates results at 10,000 rows **after** fetch - callers should still use `LIMIT`.

The real security boundary is the MySQL account: use a `SELECT`-only user.

### Tool Naming Convention

Tool names use `lower_snake_case` (e.g., `mysql_list_tables`) for Codex compatibility - Codex requires `^[a-zA-Z0-9_-]+$` pattern.

### MCP Annotations

All tools include proper MCP annotations:
- `readOnlyHint: true` - Tools don't modify data
- `destructiveHint: false` - Tools are non-destructive
- `idempotentHint: true` - Tools can be safely retried
- `openWorldHint: false` - Tools are scoped to the connected database
