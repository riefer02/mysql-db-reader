# MySQL Reader (read-only)

Read-only MySQL tools for `xmcp`. Connect via a connection-string env var; all operations are read-only.

### Prerequisites

- Node 22+
- pnpm

### Install & build

```bash
pnpm i
pnpm build
pnpm test        # unit tests (integration tests self-skip without a DB)
pnpm typecheck
```

### Configure database connection

Set one of (first found wins): `MYSQL_URL`, `MYSQL_CONNECTION_STRING`, or `DATABASE_URL`.

```bash
export MYSQL_URL="mysql://user:password@localhost:3306/mydb"
```

**SSL** is controlled by `MYSQL_SSL` (default: `"true"`):

| Value | Behavior |
|---|---|
| `true` (default) | Encrypted, skips cert hostname validation — use when connecting through a tunnel or proxy |
| `strict` | Encrypted, validates server certificate — use for direct connections with a valid cert |
| `false` | No SSL — local dev only |

```bash
export MYSQL_SSL=true    # tunnel / hosted DB (default)
export MYSQL_SSL=strict  # direct connection, valid cert
export MYSQL_SSL=false   # local dev, no SSL
```

**Use a MySQL account granted `SELECT` only** (ideally per-schema). The SQL
guards and session settings below are guardrails, not a security boundary—the
account's grants and the engine-level read-only transaction are.

Optional tuning (all have safe defaults):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYSQL_QUERY_TIMEOUT_MS` | `30000` | Per-request time limit; the connection is dropped if exceeded |
| `MYSQL_MAX_ROWS` | `10000` | Row cap for `mysql_query`; the query is aborted once exceeded |
| `MYSQL_CONNECTION_LIMIT` | `3` | Max pooled connections |
| `MYSQL_QUEUE_LIMIT` | `5` | Max requests waiting for a connection (bounded) |
| `MYSQL_IDLE_TIMEOUT_MS` | `60000` | Idle connection timeout |
| `MYSQL_CONNECT_TIMEOUT_MS` | `10000` | TCP connect timeout |
| `HOST` | `127.0.0.1` | HTTP bind address (keep loopback unless you add auth) |
| `PORT` | `3001` | HTTP port |

`HOST`/`PORT` are resolved at **build time** (xmcp bakes its config into
`dist`). For a production build: `HOST=0.0.0.0 PORT=8080 pnpm build`. Browsers
are denied cross-origin access to the HTTP endpoint by default.

### Use in Cursor (STDIO)

**Via npx** (after publishing to npm — no local clone needed):

```json
{
  "mcpServers": {
    "mysql-reader": {
      "command": "npx",
      "args": ["-y", "mysql-db-reader"],
      "env": { "MYSQL_URL": "mysql://user:password@host:3306/db" }
    }
  }
}
```

**Local build** (after `pnpm build`):

```json
{
  "mcpServers": {
    "mysql-reader": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mysql-db-reader/dist/stdio.js"],
      "env": { "MYSQL_URL": "mysql://user:password@host:3306/db" }
    }
  }
}
```

### Use via HTTP (optional)

The HTTP server binds to `127.0.0.1:3001` by default and has **no
authentication**. Use it locally only; to expose it remotely, put
authentication and TLS in front of it, and rebuild with `HOST` set.

```bash
pnpm dev
```

Then point your MCP client to `http://127.0.0.1:3001/mcp`.

Example HTTP client config (TOML):

```toml
[mcp_servers.mysql-reader]
transport = "http"
url = "http://127.0.0.1:3001/mcp"
project = "/ABSOLUTE/PATH/TO/your/project"
```

### Tools

- `mysql_list_databases(includeSystem=false)` — list databases
- `mysql_list_tables(database, includeViews=true)` — list tables/views
- `mysql_get_table_schema(database, table)` — columns/constraints/indexes
- `mysql_preview_table(database, table, limit=50, orderBy?)` — sample rows
- `mysql_query(sql, params?)` — read-only SQL (SELECT/SHOW/DESC/EXPLAIN/WITH), streamed with a 10k row cap
- `mysql_explain_query(sql)` — EXPLAIN a SELECT

### Safety

Read-only access is enforced in layers:

1. **Guards** (`src/lib/sql.ts`) — only `SELECT`/`SHOW`/`DESCRIBE`/`DESC`/`EXPLAIN`/`WITH`
   statements are accepted, and unsafe constructs are rejected: `INTO OUTFILE/DUMPFILE`,
   `INTO @var`, `FOR UPDATE`/`FOR SHARE`/`LOCK IN SHARE MODE`, `EXPLAIN ANALYZE`,
   `SLEEP`/`BENCHMARK`/`GET_LOCK`/`LOAD_FILE`, and stacked (multi-)statements.
   Identifiers are validated against an allowlist before being quoted.
2. **Engine-level read-only transaction** (`src/lib/mysql.ts`) — each operation
   runs inside `START TRANSACTION READ ONLY`, plus best-effort `SQL_SAFE_UPDATES`
   and `MAX_EXECUTION_TIME`.
3. **Time and resource limits** — a wall-clock timeout aborts runaway queries
   (dropping the connection), the wait queue is bounded, and connections are reset
   on release to avoid session-state bleed.
4. **Account grants** — point the server at a `SELECT`-only MySQL user.

The `mysql_query` row cap (default 10,000, set `MYSQL_MAX_ROWS` to change) is
enforced while **streaming**: once the cap is exceeded the query is aborted, so
the remaining rows are never fetched from the server.

### Tests

```bash
pnpm test                                              # unit tests
MYSQL_TEST_URL="mysql://reader:pass@localhost:3306/db" pnpm test   # + integration
```

### Codex compatibility

Tool names use lowercase snake_case (underscores, no dots) to comply with Codex's tool name pattern `^[a-zA-Z0-9_-]+$` (Codex models prefer lower_snake). See: [MCP in Codex docs](https://github.com/openai/codex/blob/main/docs/advanced.md#model-context-protocol-mcp)

Docs: [xmcp docs](https://xmcp.dev/docs)
