/**
 * Zero-dependency ANSI styling for CLI output.
 *
 * Uses raw ANSI escape codes instead of external libraries like ansis.
 * Provides lazy color detection that respects NO_COLOR, FORCE_COLOR, and TERM=dumb.
 */

const ESC = "\u001B[";
const RESET = `${ESC}0m`;

// Lazy-evaluated color support flag
let colorEnabled: boolean | null = null;

/**
 * Determine if color output should be used.
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
 * Check if colors are enabled.
 * Caches the result for performance.
 */
export function useColor(): boolean {
  if (colorEnabled === null) {
    colorEnabled = shouldUseColor();
  }
  return colorEnabled;
}

/**
 * Reset the color detection cache.
 * Useful for testing or dynamic reconfiguration.
 */
export function resetColorCache(): void {
  colorEnabled = null;
}

/**
 * Create a style function that applies an ANSI code.
 */
function style(code: string): (text: string) => string {
  return (text: string) => (useColor() ? `${code}${text}${RESET}` : text);
}

/**
 * Style functions for CLI output.
 *
 * Usage:
 * ```ts
 * import { s } from "./render";
 * console.log(s.bold("Title"));
 * console.log(s.yellow("Warning"));
 * console.log(s.dim("Secondary info"));
 * ```
 */
export const s = {
  // Modifiers
  bold: style(`${ESC}1m`),
  dim: style(`${ESC}2m`),
  italic: style(`${ESC}3m`),
  underline: style(`${ESC}4m`),
  strikethrough: style(`${ESC}9m`),

  // Foreground colors
  black: style(`${ESC}30m`),
  red: style(`${ESC}31m`),
  green: style(`${ESC}32m`),
  yellow: style(`${ESC}33m`),
  blue: style(`${ESC}34m`),
  magenta: style(`${ESC}35m`),
  cyan: style(`${ESC}36m`),
  white: style(`${ESC}37m`),
  gray: style(`${ESC}90m`),

  // Background colors
  bgBlack: style(`${ESC}40m`),
  bgRed: style(`${ESC}41m`),
  bgGreen: style(`${ESC}42m`),
  bgYellow: style(`${ESC}43m`),
  bgBlue: style(`${ESC}44m`),
  bgMagenta: style(`${ESC}45m`),
  bgCyan: style(`${ESC}46m`),
  bgWhite: style(`${ESC}47m`),
} as const;

/** Type for a style function */
export type StyleFn = (text: string) => string;
