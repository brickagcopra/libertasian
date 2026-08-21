import type { Href } from 'expo-router';

/**
 * Compile-time proof that typed routes actually loaded.
 *
 * `.expo/types/router.d.ts` is generated, gitignored, and pulled in through a
 * GLOB in tsconfig `include`. TypeScript ignores a glob that matches nothing —
 * so if generation is skipped, tsc does not complain: the module augmentation
 * is simply absent, `Href` widens back to `string`, and every dead route
 * type-checks green again. That silent fallback is worse than not having the
 * flag, because it looks like coverage.
 *
 * The directive below closes that hole. `/__not_a_route__` is not in the
 * generated union, so with types loaded the assignment errors and
 * `@ts-expect-error` consumes it. With types missing the assignment succeeds,
 * the directive has nothing to suppress, and tsc fails with
 * "Unused '@ts-expect-error' directive" — turning a silent no-op into a
 * build failure.
 *
 * If this line ever errors, run `pnpm --filter mobile generate:router-types`.
 */
// @ts-expect-error -- typed routes are not loaded if this line stops erroring
const TYPED_ROUTES_ARE_LOADED: Href = '/__not_a_route__';

void TYPED_ROUTES_ARE_LOADED;
