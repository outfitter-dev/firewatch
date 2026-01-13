import {
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { Command } from "commander";

export type SchemaName = "query" | "entry" | "worklist";

const schemaMap: Record<SchemaName, unknown> = {
  query: ENTRY_SCHEMA_DOC,
  entry: ENTRY_SCHEMA_DOC,
  worklist: WORKLIST_SCHEMA_DOC,
};

export function printSchema(name: SchemaName): void {
  const schema = schemaMap[name];
  console.log(JSON.stringify(schema, null, 2));
}

export const schemaCommand = new Command("schema")
  .description("Print schema information")
  .argument("[name]", "query | entry | worklist", "query")
  .option("--json", "Output JSON (default)")
  .action((name: SchemaName) => {
    if (!schemaMap[name]) {
      console.error(`Unknown schema: ${name}`);
      process.exit(1);
    }
    printSchema(name);
  });
