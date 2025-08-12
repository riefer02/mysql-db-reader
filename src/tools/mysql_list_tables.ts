import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import {
  withReadOnlyConnection,
  coerceRows,
  assertSafeIdentifier,
} from "../lib/mysql";

export const schema = {
  database: z.string().describe("Database (schema) name"),
  includeViews: z.boolean().default(true).describe("Include views in result"),
};

export const metadata: ToolMetadata = {
  name: "mysql.listTables",
  description: "List tables (and optionally views) in a database",
  annotations: {
    title: "MySQL: List tables",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export default async function listTables({
  database,
  includeViews,
}: InferSchema<typeof schema>) {
  assertSafeIdentifier(database, "database");
  const typePredicate = includeViews
    ? "table_type in ('BASE TABLE','VIEW')"
    : "table_type = 'BASE TABLE'";
  return withReadOnlyConnection(async (conn) => {
    const [rows] = await conn.query(
      `SELECT table_name AS tableName, table_type AS tableType
       FROM information_schema.tables
       WHERE table_schema = ? AND ${typePredicate}
       ORDER BY table_name`,
      [database]
    );
    const data = coerceRows(rows as any[]);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}
