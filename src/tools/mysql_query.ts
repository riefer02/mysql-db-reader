import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import {
  withReadOnlyConnection,
  coerceRows,
  assertReadOnlySql,
} from "../lib/mysql";

export const schema = {
  sql: z
    .string()
    .describe(
      "A read-only SQL statement starting with SELECT, SHOW, DESCRIBE/DESC, EXPLAIN or WITH (select)."
    ),
  params: z
    .array(z.any())
    .optional()
    .describe("Positional parameters for the query"),
};

export const metadata: ToolMetadata = {
  name: "mysql.query",
  description: "Run a read-only SQL query with optional positional parameters",
  annotations: {
    title: "MySQL: Query (read-only)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
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
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}
