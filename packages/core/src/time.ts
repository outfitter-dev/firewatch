/**
 * Parse a duration string like "24h", "7d" into a Date.
 */
export function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(h|d|w|m)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${since}. Use format like 24h, 7d, 2w, 1m`
    );
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2];

  const now = new Date();
  switch (unit) {
    case "h":
      now.setHours(now.getHours() - value);
      break;
    case "d":
      now.setDate(now.getDate() - value);
      break;
    case "w":
      now.setDate(now.getDate() - value * 7);
      break;
    case "m":
      now.setMonth(now.getMonth() - value);
      break;
  }

  return now;
}
