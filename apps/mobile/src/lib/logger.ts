/**
 * Minimal structured logger. Emits one JSON line per event so logs stay
 * grep-able in Metro/adb output. Dev-only — release builds drop everything
 * (no console.* in production per repo standards). Callers must never pass
 * secrets or token material in `fields`.
 */
type LogFields = Record<string, string | number | boolean | null | undefined>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields?: LogFields): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console[level](JSON.stringify({ level, event, ...fields }));
}

export const logger = {
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
