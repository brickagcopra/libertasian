/**
 * Jest-only shim for the `uuid` package.
 *
 * `uuid@13` ships as pure ESM, which the repo's ts-jest transform (TS files
 * only) cannot load from node_modules. This shim is wired in via
 * `moduleNameMapper` in jest.config.ts and is NOT used by the build or at
 * runtime — those resolve the real `uuid`. It is backed by Node's
 * `crypto.randomUUID`, so tests still get real RFC-4122 v4 UUIDs.
 */
import { randomUUID } from 'crypto';

export const v4 = (): string => randomUUID();

export default { v4 };
