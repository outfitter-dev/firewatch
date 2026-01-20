import { once } from "node:events";

export type OutputFormat = "jsonl" | "json";

export async function writeJsonLine(value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  const line = `${serialized ?? "null"}\n`;
  if (!process.stdout.write(line)) {
    await once(process.stdout, "drain");
  }
}

export async function outputStructured(
  value: unknown,
  format: OutputFormat
): Promise<void> {
  if (format === "json") {
    const serialized = JSON.stringify(value, null, 2);
    const line = `${serialized ?? "null"}\n`;
    if (!process.stdout.write(line)) {
      await once(process.stdout, "drain");
    }
    return;
  }

  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    await writeJsonLine(item);
  }
}
