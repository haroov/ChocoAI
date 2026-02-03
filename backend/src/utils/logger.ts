/* eslint-disable no-console */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  prefix?: string;
  timestamp?: boolean;
  minLevel?: LogLevel;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

class Logger {
  private prefix: string;
  private timestamp: boolean;
  private minLevel: number;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix || '';
    this.timestamp = options.timestamp ?? true;
    this.minLevel = LEVELS[options.minLevel || 'debug'];
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    const formatted = this.format('debug', message, ...args);
    console.debug(`${COLORS.debug}${formatted}${COLORS.reset}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const formatted = this.format('info', message, ...args);
    console.info(`${COLORS.info}${formatted}${COLORS.reset}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    const formatted = this.format('warn', message, ...args);
    console.warn(`${COLORS.warn}${formatted}${COLORS.reset}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    const formatted = this.format('error', message, ...args);
    console.error(`${COLORS.error}${formatted}${COLORS.reset}`, ...args);
  }

  child(prefix: string): Logger {
    return new Logger({
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      timestamp: this.timestamp,
      minLevel: Object.keys(LEVELS).find((key) => LEVELS[key as LogLevel] === this.minLevel) as LogLevel,
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= this.minLevel;
  }

  private format(level: LogLevel, message: string, ...args: unknown[]): string {
    const parts: string[] = [];

    if (this.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    return parts.join(' ');
  }
}

export const logger = new Logger({
  timestamp: true,
  minLevel: (process.env.LOG_LEVEL as LogLevel) ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
});
