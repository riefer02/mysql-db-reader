import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import {
  withReadOnlyConnection,
  coerceRows,
  assertReadOnlySql,
} from "../lib/mysql";

const MAX_ROWS = 10000;

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
    "Run a read-only SQL query with optional positional parameters. For complex queries or when you need JOINs, aggregations, or filtering. Results are limited to 10,000 rows; use LIMIT for large tables.",
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
  return withReadOnlyConnection(async (conn) => {
    const [rows] = await conn.query(sql, params ?? []);
    const data = Array.isArray(rows) ? coerceRows(rows as any[]) : rows;
    const limited = Array.isArray(data) ? data.slice(0, MAX_ROWS) : data;
    const truncated = Array.isArray(data) && data.length > MAX_ROWS;
    const result = truncated
      ? { rows: limited, truncated: true, totalReturned: data.length }
      : limited;
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
