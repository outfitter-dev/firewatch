/**
 * Centralized color handling using ansis with lazy initialization.
 *
 * ansis evaluates color support at module load time, but CLI flags like
 * --no-color are processed after imports. This module defers the color
 * decision until first use, allowing flags to take effect.
 */
import ansis, { Ansis } from "ansis";

let colorInstance: Ansis | null = null;

/**
 * Determine if color should be used.
 * Respects NO_COLOR, FORCE_COLOR, and TERM=dumb conventions.
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return process.stdout.isTTY ?? false;
}

/**
 * Get the ansis instance, initializing on first access.
 * This allows --no-color flags to be processed before color decision.
 */
export function getAnsis(): Ansis {
  if (colorInstance) {
    return colorInstance;
  }

  if (shouldUseColor()) {
    colorInstance = ansis;
  } else {
    colorInstance = new Ansis(0);
  }
  return colorInstance;
}

/**
 * Reset the color instance (useful for testing or dynamic reconfiguration).
 */
export function resetColorInstance(): void {
  colorInstance = null;
}

// Convenience color functions that use lazy initialization
// These check color support on each call for maximum flexibility

type ColorFn = (text: string) => string;

const createColorFn =
  (getter: (a: Ansis) => ColorFn): ColorFn =>
  (text: string) =>
    getter(getAnsis())(text);

export const c = {
  // Basic colors
  green: createColorFn((a) => a.green),
  yellow: createColorFn((a) => a.yellow),
  red: createColorFn((a) => a.red),
  cyan: createColorFn((a) => a.cyan),
  blue: createColorFn((a) => a.blue),
  magenta: createColorFn((a) => a.magenta),
  white: createColorFn((a) => a.white),
  gray: createColorFn((a) => a.gray),

  // Modifiers
  dim: createColorFn((a) => a.dim),
  bold: createColorFn((a) => a.bold),
  italic: createColorFn((a) => a.italic),
  underline: createColorFn((a) => a.underline),
  strikethrough: createColorFn((a) => a.strikethrough),

  // Backgrounds
  bgGreen: createColorFn((a) => a.bgGreen),
  bgYellow: createColorFn((a) => a.bgYellow),
  bgRed: createColorFn((a) => a.bgRed),
  bgCyan: createColorFn((a) => a.bgCyan),
  bgBlue: createColorFn((a) => a.bgBlue),
} as const;

/**
 * State color mapping for PR states
 */
export function getStateColor(state: string): ColorFn {
  switch (state.toLowerCase()) {
    case "open":
      return c.green;
    case "draft":
      return c.yellow;
    case "merged":
      return c.cyan;
    case "closed":
      return c.dim;
    default:
      return (s: string) => s;
  }
}

/**
 * Status color mapping for CI status
 */
export function getStatusColor(status: string): ColorFn {
  switch (status.toLowerCase()) {
    case "success":
      return c.green;
    case "failure":
      return c.red;
    default:
      return c.yellow;
  }
}
