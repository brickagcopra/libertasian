/**
 * Generate .expo/types/router.d.ts (the typed-routes Href union) without
 * starting Metro.
 *
 * Why not the obvious call: expo-router exports `regenerateDeclarations`, but
 * it is wrapped in a 1000ms debounce and its body swallows every error into a
 * console.error. In CI both are silent failures — the process exits 0, the
 * declaration file is stale or absent, `Href` degrades to `string`, and every
 * dead route type-checks green. That is precisely the bug this file exists to
 * prevent, so we call the underlying generator directly and fail loudly.
 *
 * Runs from `prelint` and `pretest`, so `tsc --noEmit` always sees types
 * generated from the CURRENT src/app tree.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(projectRoot, 'src/app');
const typesDir = resolve(projectRoot, '.expo/types');
const outFile = resolve(typesDir, 'router.d.ts');

if (!existsSync(appRoot)) {
  throw new Error(`expo-router app root not found: ${appRoot}`);
}

// The ponyfill's module-level default ctx is built from EXPO_ROUTER_APP_ROOT at
// import time, so set it before requiring anything out of expo-router.
process.env['EXPO_ROUTER_APP_ROOT'] = appRoot;

const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
const requireContext = require('expo-router/build/testing-library/require-context-ponyfill').default;
const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');

const ctx = requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE);
const routeCount = ctx.keys().length;
if (routeCount === 0) {
  throw new Error(`no routes discovered under ${appRoot} — refusing to write an empty Href union`);
}

const declaration = getTypedRoutesDeclarationFile(ctx);
if (!declaration || !declaration.includes('declare module')) {
  throw new Error('expo-router produced an empty or malformed router.d.ts');
}

const previous = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;
if (previous === declaration) {
  console.log(`router types up to date (${routeCount} route files)`);
} else {
  mkdirSync(typesDir, { recursive: true });
  writeFileSync(outFile, declaration);
  console.log(`wrote ${outFile} (${routeCount} route files)`);
}
