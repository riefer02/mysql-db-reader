# MySQL Reader (read-only)

Read-only MySQL tools for `xmcp`. Connect via a connection-string env var; all operations are read-only.

### Prerequisites

- Node 20+
- pnpm

### Install & build

```bash
pnpm i
pnpm build
```

### Configure database connection

Set one of (first found wins): `MYSQL_URL`, `MYSQL_CONNECTION_STRING`, or `DATABASE_URL`.

```bash
export MYSQL_URL="mysql://user:password@localhost:3306/mydb"
```

### Use in Cursor (STDIO)

Add to your `mcp.json` (use an absolute path to `dist/stdio.js`):

```json
{
  "mcpServers": {
    "mysql-reader": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mysql-reader/dist/stdio.js"],
      "env": { "MYSQL_URL": "mysql://user:password@host:3306/db" }
    }
  }
}
```

### Use via HTTP (optional)

```bash
pnpm dev
```

Then point your MCP client to `http://localhost:3002/mcp`.

To use a different port (e.g., 3001):

```bash
export MYSQL_URL="mysql://user:password@localhost:3306/mydb"
PORT=3001 pnpm dev
```

Example HTTP client config (TOML):

```toml
[mcp_servers.mysql-reader]
transport = "http"
url = "http://127.0.0.1:3001/mcp"
project = "/ABSOLUTE/PATH/TO/your/project"
```

### Tools

- `mysql_listDatabases(includeSystem=false)` — list databases
- `mysql_listTables(database, includeViews=true)` — list tables/views
- `mysql_getTableSchema(database, table)` — columns/constraints/indexes
- `mysql_previewTable(database, table, limit=50, orderBy?)` — sample rows
- `mysql_query(sql, params?)` — read-only SQL (SELECT/SHOW/DESC/EXPLAIN/WITH)
- `mysql_explainQuery(sql)` — EXPLAIN a SELECT

### Codex compatibility

Tool names use underscores (not dots) to comply with Codex's tool name pattern `^[a-zA-Z0-9_-]+$`. See: [MCP in Codex docs](https://github.com/openai/codex/blob/main/docs/advanced.md#model-context-protocol-mcp)

Read-only is enforced via session settings and SQL guards.

Docs: [xmcp docs](https://xmcp.dev/docs)
