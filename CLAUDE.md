# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm i           # Install dependencies
pnpm build       # Build the project (xmcp build)
pnpm dev         # Run development server (xmcp dev) - HTTP server on port 3002
pnpm start       # Run production HTTP server (node dist/http.js)
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
- `src/lib/mysql.ts` - Shared MySQL connection pool and safety utilities
- `xmcp.config.ts` - xmcp configuration (enables both HTTP and STDIO transports)
- `dist/stdio.js` - Built STDIO entry point for Cursor/CLI MCP clients
- `dist/http.js` - Built HTTP entry point

### Tool Definition Pattern

Each tool in `src/tools/` exports:
- `schema` - Zod object defining parameters
- `metadata` - Tool name, description, and annotations (readOnlyHint, destructiveHint, idempotentHint)
- `default` function - The tool implementation

### Read-Only Safety

All database access is read-only, enforced via:
1. `assertReadOnlySql()` - Validates SQL starts with SELECT/SHOW/DESCRIBE/EXPLAIN/WITH and blocks mutation keywords
2. `assertSafeIdentifier()` - Validates database/table names against injection
3. Session settings: `SQL_SAFE_UPDATES=1`, `TRANSACTION READ ONLY` (where supported)
4. `withReadOnlyConnection()` wrapper applies these safeguards
5. `mysql_query` limits results to 10,000 rows max

### Tool Naming Convention

Tool names use `lower_snake_case` (e.g., `mysql_list_tables`) for Codex compatibility - Codex requires `^[a-zA-Z0-9_-]+$` pattern.

### MCP Annotations

All tools include proper MCP annotations:
- `readOnlyHint: true` - Tools don't modify data
- `destructiveHint: false` - Tools are non-destructive
- `idempotentHint: true` - Tools can be safely retried
- `openWorldHint: false` - Tools are scoped to the connected database
