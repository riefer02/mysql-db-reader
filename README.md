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

Then point your MCP client to `http://localhost:3002/mcp` and provide the same env var.

### Tools

- `mysql.listDatabases(includeSystem=false)` — list databases
- `mysql.listTables(database, includeViews=true)` — list tables/views
- `mysql.getTableSchema(database, table)` — columns/constraints/indexes
- `mysql.previewTable(database, table, limit=50, orderBy?)` — sample rows
- `mysql.query(sql, params?)` — read-only SQL (SELECT/SHOW/DESC/EXPLAIN/WITH)
- `mysql.explainQuery(sql)` — EXPLAIN a SELECT

Read-only is enforced via session settings and SQL guards.

Docs: [xmcp docs](https://xmcp.dev/docs)
