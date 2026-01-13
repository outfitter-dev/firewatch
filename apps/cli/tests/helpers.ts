const formatChunk = (chunk: unknown): string => {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }
  return String(chunk);
};

export async function captureStdout(
  fn: () => Promise<void>
): Promise<string[]> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((...args: unknown[]) => {
    const text = formatChunk(args[0]);
    chunks.push(text);
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
