export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Fatal = 5,
}

class LoggerClass {
  private level: LogLevel = LoggerClass.parseLevel(process.env.CNCMAPS_LOG_LEVEL);

  private sink: ((level: LogLevel, message: string) => void) | null = null;

  private static parseLevel(value: string | undefined): LogLevel {
    if (value == null || value.trim() === '') return LogLevel.Info;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= LogLevel.Trace && n <= LogLevel.Fatal ? (n as LogLevel) : LogLevel.Info;
  }

  setLevel(l: LogLevel): void { this.level = l; }
  setSink(sink: ((level: LogLevel, message: string) => void) | null): void { this.sink = sink; }

  /** True when messages at `level` would actually be emitted. Hot paths must check this before
   * building a template string: `logger.trace(\`...${obj}\`)` evaluates the string even when the
   * trace level is disabled, which is millions of wasted allocations per map at 1M tiles. */
  isEnabled(level: LogLevel): boolean {
    return level >= this.level;
  }

  private fmt(level: string, msg: string): string {
    const ms = (process.hrtime.bigint() / 1000000n).toString();
    return `${ms} [${level}] ${msg}`;
  }
  private out(level: LogLevel, tag: string, args: unknown[]): void {
    if (level < this.level) return;
    const msg = args.map((a) => (typeof a === 'string' ? a : fmtObj(a))).join(' ');
    if (this.sink) this.sink(level, msg);
    if (level >= LogLevel.Error) console.error(this.fmt(tag, msg));
    else console.log(this.fmt(tag, msg));
  }
  trace(...a: unknown[]): void { this.out(LogLevel.Trace, 'TRACE', a); }
  debug(...a: unknown[]): void { this.out(LogLevel.Debug, 'DEBUG', a); }
  info(...a: unknown[]): void { this.out(LogLevel.Info, 'INFO', a); }
  warn(...a: unknown[]): void { this.out(LogLevel.Warn, 'WARN', a); }
  error(...a: unknown[]): void { this.out(LogLevel.Error, 'ERROR', a); }
  fatal(...a: unknown[]): void { this.out(LogLevel.Fatal, 'FATAL', a); }
}

function fmtObj(o: unknown): string {
  if (o === null) return 'null';
  if (o === undefined) return '';
  if (typeof o === 'object') {
    try { return JSON.stringify(o); } catch { return String(o); }
  }
  return String(o);
}

export const logger: LoggerClass = new LoggerClass();

// Logger facade matching the NLog usage style in the original source.
export function LogManager(): LoggerClass { return logger; }