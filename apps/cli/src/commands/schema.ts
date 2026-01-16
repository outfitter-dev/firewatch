import {
  CONFIG_SCHEMA_DOC,
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { Command } from "commander";

export type SchemaName = "entry" | "worklist" | "config";

const schemaMap: Record<SchemaName, unknown> = {
  entry: ENTRY_SCHEMA_DOC,
  worklist: WORKLIST_SCHEMA_DOC,
  config: CONFIG_SCHEMA_DOC,
};

export function printSchema(name: SchemaName): void {
  const schema = schemaMap[name];
  console.log(JSON.stringify(schema, null, 2));
}

export const schemaCommand = new Command("schema")
  .description("Print JSON schema for Firewatch data types")
  .argument("[name]", "Schema variant: entry, worklist, config", "entry")
  .action((name: SchemaName) => {
    if (!schemaMap[name]) {
      console.error(
        `Unknown schema: ${name}. Valid schemas: entry, worklist, config`
      );
      process.exit(1);
    }
    printSchema(name);
  });
