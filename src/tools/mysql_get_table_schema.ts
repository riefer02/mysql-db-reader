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
};

export const metadata: ToolMetadata = {
  name: "mysql.getTableSchema",
  description: "Get table column definitions, primary key, and constraints",
  annotations: {
    title: "MySQL: Get table schema",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export default async function getTableSchema({
  database,
  table,
}: InferSchema<typeof schema>) {
  assertSafeIdentifier(database, "database");
  assertSafeIdentifier(table, "table");
  return withReadOnlyConnection(async (conn) => {
    const [cols] = await conn.query(
      `SELECT column_name AS name,
              data_type AS dataType,
              column_type AS columnType,
              is_nullable = 'YES' AS isNullable,
              column_default AS defaultValue,
              column_key AS columnKey,
              extra AS extra
         FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position`,
      [database, table]
    );

    const [constraints] = await conn.query(
      `SELECT constraint_name AS constraintName, constraint_type AS constraintType
         FROM information_schema.table_constraints
        WHERE table_schema = ? AND table_name = ?
        ORDER BY constraint_name`,
      [database, table]
    );

    const [indexes] = await conn.query(
      `SHOW INDEX FROM \`${database}\`.\`${table}\``
    );

    const payload = {
      columns: coerceRows(cols as any[]),
      constraints: coerceRows(constraints as any[]),
      indexes: coerceRows(indexes as any[]),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
