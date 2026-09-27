/**
 * The caller's JWT organization, or `undefined` when there is none.
 *
 * For PLATFORM routes only (guarded by `PlatformPermissionsGuard`, not
 * `TenantGuard`). Platform staff belong to no organization by design, so their
 * JWT may carry no `organizationId` — or an empty string — even though
 * `JwtPayload` types it as a string. Normalising here means an audit row or a
 * job payload records `NULL` rather than `''` (which the UUID column would
 * reject, silently dropping the audit row) or a personal workspace id that has
 * nothing to do with the operation.
 *
 * Never use this to scope a tenant query: a tenant route must keep
 * `TenantGuard`, which refuses a missing organization outright.
 */
export function optionalOrganizationId(user: {
  organizationId?: string | null;
}): string | undefined {
  const value = user.organizationId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
