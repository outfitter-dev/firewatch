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

/**
 * Parse a duration string like "5m", "2h" into milliseconds.
 * Supports s, m, h, d, w units (m = minutes).
 */
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use format like 30s, 5m, 2h, 7d`
    );
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid unit: ${unit}`);
  }
}
