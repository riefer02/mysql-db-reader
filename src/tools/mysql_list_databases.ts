import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { withReadOnlyConnection, coerceRows } from "../lib/mysql";

export const schema = {
  includeSystem: z
    .boolean()
    .default(false)
    .describe(
      "Whether to include system schemas like mysql, information_schema, performance_schema, sys"
    ),
};

export const metadata: ToolMetadata = {
  name: "mysql_listDatabases",
  description: "List available databases (schemas) on the MySQL server",
  annotations: {
    title: "MySQL: List databases",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export default async function listDatabases({
  includeSystem,
}: InferSchema<typeof schema>) {
  const system = ["mysql", "information_schema", "performance_schema", "sys"];
  return withReadOnlyConnection(async (conn) => {
    const [rows] = await conn.query(
      "SELECT schema_name AS databaseName FROM information_schema.schemata ORDER BY schema_name"
    );
    const data = coerceRows(rows as any[]).filter(
      (r) => includeSystem || !system.includes(String((r as any).databaseName))
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  });
}
