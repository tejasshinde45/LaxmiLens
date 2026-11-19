import { LoggerPort, LogMetadata } from '@/application/ports/LoggerPort';
import { env } from '@/config/env';

export class ConsoleLogger implements LoggerPort {
  private isDevelopment = env.VITE_APP_ENV === 'development' || env.VITE_APP_ENV === 'test';

  public debug(message: string, meta?: LogMetadata): void {
    if (this.isDevelopment) {
      console.debug(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }

  public info(message: string, meta?: LogMetadata): void {
    console.info(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  public warn(message: string, meta?: LogMetadata): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  public error(message: string, error?: unknown, meta?: LogMetadata): void {
    console.error(`[ERROR] ${message}`, error, meta ? JSON.stringify(meta) : '');
  }
}

export const logger = new ConsoleLogger();
