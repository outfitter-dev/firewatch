import {
  CONFIG_SCHEMA_DOC,
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { Command } from "commander";

import { outputStructured } from "../utils/json";

export type SchemaName = "entry" | "worklist" | "config";

const schemaMap: Record<SchemaName, unknown> = {
  entry: ENTRY_SCHEMA_DOC,
  worklist: WORKLIST_SCHEMA_DOC,
  config: CONFIG_SCHEMA_DOC,
};

export async function printSchema(name: SchemaName): Promise<void> {
  const schema = schemaMap[name];
  await outputStructured(schema, "json");
}

export const schemaCommand = new Command("schema")
  .description("Print JSON schema for Firewatch data types")
  .argument("[name]", "Schema variant: entry, worklist, config", "entry")
  .action(async (name: SchemaName) => {
    if (!schemaMap[name]) {
      console.error(
        `Unknown schema: ${name}. Valid schemas: entry, worklist, config`
      );
      process.exit(1);
    }
    await printSchema(name);
  });
