export interface LogMetadata {
  [key: string]: unknown;
}

export interface LoggerPort {
  debug(message: string, meta?: LogMetadata): void;
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
  error(message: string, error?: unknown, meta?: LogMetadata): void;
}
