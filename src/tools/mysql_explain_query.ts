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
      "A read-only SELECT query to EXPLAIN. Use the same SQL you would run in mysql"
    ),
};

export const metadata: ToolMetadata = {
  name: "mysql_explain_query",
  description: "Run EXPLAIN on a SELECT to show the query plan",
  annotations: {
    title: "MySQL: Explain query",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export default async function explainQuery({
  sql,
}: InferSchema<typeof schema>) {
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    throw new Error("Only SELECT/CTE queries can be explained");
  }
  assertReadOnlySql(sql);
  return withReadOnlyConnection(async (conn) => {
    const [rows] = await conn.query(`EXPLAIN ${sql}`);
    const data = coerceRows(rows as any[]);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}
