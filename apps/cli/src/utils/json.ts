import { once } from "node:events";

export async function writeJsonLine(value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  const line = `${serialized ?? "null"}\n`;
  if (!process.stdout.write(line)) {
    await once(process.stdout, "drain");
  }
}
