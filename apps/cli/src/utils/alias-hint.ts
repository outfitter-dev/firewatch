/**
 * Emit a hint to stderr when a hidden alias is used.
 * Only outputs if stderr is a TTY to avoid polluting piped output.
 */
export function emitAliasHint(used: string, canonical: string): void {
  if (process.stderr.isTTY) {
    console.error(`hint: \`${used}\` is an alias for \`${canonical}\``);
  }
}
