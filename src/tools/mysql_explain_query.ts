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
  description:
    "Run EXPLAIN on a SELECT query to show the query execution plan. Use this to analyze query performance and identify missing indexes.",
  annotations: {
    title: "MySQL: Explain query",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export default async function explainQuery({
  sql,
}: InferSchema<typeof schema>) {
  const trimmed = assertReadOnlySql(sql);
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstWord !== "select" && firstWord !== "with") {
    throw new Error("Only SELECT/CTE queries can be explained");
  }
  return withReadOnlyConnection(async (conn) => {
    const [rows] = await conn.query(`EXPLAIN ${trimmed}`);
    const data = coerceRows(rows as unknown[]);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}
