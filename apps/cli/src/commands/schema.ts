import {
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { Command } from "commander";

export type SchemaName = "query" | "entry" | "worklist";

const schemaMap: Record<SchemaName, unknown> = {
  query: ENTRY_SCHEMA_DOC, // Deprecated alias for 'entry'
  entry: ENTRY_SCHEMA_DOC,
  worklist: WORKLIST_SCHEMA_DOC,
};

export function printSchema(name: SchemaName): void {
  const schema = schemaMap[name];
  console.log(JSON.stringify(schema, null, 2));
}

export const schemaCommand = new Command("schema")
  .description(
    "Print JSON schema for Firewatch data types (entry, worklist). " +
      "Use 'fw schema entry' for individual activity records, " +
      "'fw schema worklist' for per-PR summaries."
  )
  .argument(
    "[name]",
    "Schema variant: entry (individual records), worklist (per-PR summaries), query (deprecated alias for entry)",
    "entry"
  )
  .action((name: SchemaName) => {
    if (!schemaMap[name]) {
      console.error(
        `Unknown schema: ${name}. Valid schemas: entry, worklist`
      );
      process.exit(1);
    }
    // Show deprecation notice for 'query'
    if (name === "query") {
      console.error(
        "Note: 'fw schema query' is deprecated, use 'fw schema entry' instead."
      );
    }
    printSchema(name);
  });
