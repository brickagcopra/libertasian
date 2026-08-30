/**
 * The routes into and inside the purchase surface.
 *
 * Declared here rather than typed as string literals at each call site so that
 * every way into this surface is a named import from `@/features/purchase` —
 * which is what makes the confinement test in `no-purchase-copy.test.ts` able
 * to enumerate the entry points at all. A `router.push('/purchase')` written
 * inline anywhere would be a door that test cannot see.
 */
export const PURCHASE_ROUTE = '/purchase' as const;
export const PURCHASE_TERMS_ROUTE = '/purchase/terms' as const;
export const PURCHASE_PRIVACY_ROUTE = '/purchase/privacy' as const;
