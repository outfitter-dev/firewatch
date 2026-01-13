import { buildWorklist, sortWorklist, type FirewatchEntry } from "@outfitter/firewatch-core";

import { ensureGraphiteMetadata } from "./stack";
import { writeJsonLine } from "./utils/json";

export async function outputWorklist(
  entries: FirewatchEntry[]
): Promise<boolean> {
  const enriched = await ensureGraphiteMetadata(entries);
  const worklist = sortWorklist(buildWorklist(enriched));

  if (worklist.length === 0) {
    return false;
  }

  for (const item of worklist) {
    await writeJsonLine(item);
  }

  return true;
}
