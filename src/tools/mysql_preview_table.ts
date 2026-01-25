import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import {
  withReadOnlyConnection,
  coerceRows,
  assertSafeIdentifier,
} from "../lib/mysql";

export const schema = {
  database: z.string().describe("Database (schema) name"),
  table: z.string().describe("Table name"),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .default(50)
    .describe("Max rows to return"),
  orderBy: z
    .string()
    .optional()
    .describe("Optional ORDER BY clause of the form 'column [ASC|DESC]'"),
};

export const metadata: ToolMetadata = {
  name: "mysql_preview_table",
  description:
    "Preview first N rows from a table with optional ordering. Use this to quickly inspect sample data without writing SQL.",
  annotations: {
    title: "MySQL: Preview table",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function buildOrderBy(orderBy?: string): string | null {
  if (!orderBy || !orderBy.trim()) return null;
  const parts = orderBy.trim().split(/\s+/);
  const column = parts[0];
  if (!column) return null;
  const dir = (parts[1] || "ASC").toUpperCase();
  assertSafeIdentifier(column, "column");
  if (dir !== "ASC" && dir !== "DESC")
    throw new Error("Invalid sort direction");
  return `ORDER BY \`${column}\` ${dir}`;
}

export default async function previewTable({
  database,
  table,
  limit,
  orderBy,
}: InferSchema<typeof schema>) {
  assertSafeIdentifier(database, "database");
  assertSafeIdentifier(table, "table");
  const order = buildOrderBy(orderBy) || "";
  return withReadOnlyConnection(async (conn) => {
    const sql = `SELECT * FROM \`${database}\`.\`${table}\` ${order} LIMIT ?`;
    const [rows] = await conn.query(sql, [limit]);
    const data = coerceRows(rows as any[]);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}
