import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import {
  withReadOnlyConnection,
  streamQuery,
  shapeResult,
  assertReadOnlySql,
  maxRowsFromEnv,
} from "../lib/mysql";

export const schema = {
  sql: z
    .string()
    .describe(
      "A read-only SQL statement starting with SELECT, SHOW, DESCRIBE/DESC, EXPLAIN or WITH (select). Include LIMIT clause for large tables."
    ),
  params: z
    .array(z.any())
    .optional()
    .describe("Positional parameters for the query (use ? placeholders in SQL)"),
};

export const metadata: ToolMetadata = {
  name: "mysql_query",
  description:
    "Run a read-only SQL query with optional positional parameters. For complex queries or when you need JOINs, aggregations, or filtering. Results are streamed and capped (default 10,000 rows, configurable via MYSQL_MAX_ROWS); the query is aborted once the cap is exceeded.",
  annotations: {
    title: "MySQL: Query (read-only)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export default async function query({
  sql,
  params,
}: InferSchema<typeof schema>) {
  assertReadOnlySql(sql);
  const maxRows = maxRowsFromEnv();
  return withReadOnlyConnection(async (conn) => {
    const { rows, truncated } = await streamQuery(
      conn,
      sql,
      params ?? [],
      maxRows
    );
    const result = shapeResult(rows, maxRows, truncated);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
