import type { Logger } from "@outfitter/contracts";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
	fatal: 5,
};

interface LoggerOptions {
	/** Minimum log level to output. Default: "info" */
	level?: LogLevel;
	/** Context to include in all log messages */
	context?: Record<string, unknown>;
	/** Write to stderr instead of stdout for error/fatal. Default: true */
	stderrForErrors?: boolean;
	/** Suppress all output (for testing). Default: false */
	silent?: boolean;
}

function shouldLog(current: LogLevel, minimum: LogLevel): boolean {
	return LEVEL_ORDER[current] >= LEVEL_ORDER[minimum];
}

function formatMessage(
	level: LogLevel,
	message: string,
	metadata: Record<string, unknown> | undefined,
	context: Record<string, unknown>,
): string {
	const merged = metadata ? { ...context, ...metadata } : context;
	const hasContext = Object.keys(merged).length > 0;

	if (hasContext) {
		return `[${level}] ${message} ${JSON.stringify(merged)}`;
	}
	return `[${level}] ${message}`;
}

/**
 * Create a Logger that satisfies the @outfitter/contracts Logger interface.
 *
 * Outputs structured log lines to stderr (errors) and stdout (info/debug).
 * Supports child loggers with inherited context.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
	const minLevel = options.level ?? "info";
	const context = options.context ?? {};
	const stderrForErrors = options.stderrForErrors ?? true;
	const silent = options.silent ?? false;

	function log(
		level: LogLevel,
		message: string,
		metadata?: Record<string, unknown>,
	): void {
		if (silent || !shouldLog(level, minLevel)) return;

		const formatted = formatMessage(level, message, metadata, context);

		if (
			stderrForErrors &&
			(level === "error" || level === "fatal" || level === "warn")
		) {
			console.error(formatted);
		} else {
			console.log(formatted);
		}
	}

	return {
		trace: (message, metadata) => log("trace", message, metadata),
		debug: (message, metadata) => log("debug", message, metadata),
		info: (message, metadata) => log("info", message, metadata),
		warn: (message, metadata) => log("warn", message, metadata),
		error: (message, metadata) => log("error", message, metadata),
		fatal: (message, metadata) => log("fatal", message, metadata),
		child(childContext) {
			return createLogger({
				level: minLevel,
				context: { ...context, ...childContext },
				stderrForErrors,
				silent,
			});
		},
	};
}

/** A no-op logger that discards all messages. Useful for tests. */
export const silentLogger: Logger = createLogger({ silent: true });
