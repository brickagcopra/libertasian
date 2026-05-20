'use client';

import { useMemo, useState } from 'react';
import { Search, ShieldCheckIcon, MailIcon, MailWarningIcon } from 'lucide-react';

import { useAdminUsers, type ListAdminUsersQuery } from '@/hooks/useAdminUsers';
import { useAdminUser } from '@/hooks/useAdminUser';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
const USER_ROLES = ['lawyer', 'law_student', 'professor', 'judge', 'other'] as const;
const PLAN_CODES = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  deactivated: 'bg-gray-100 text-gray-700',
};

const subStatusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  complimentary: 'bg-purple-100 text-purple-700',
  grace_period: 'bg-amber-100 text-amber-700',
  past_due: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

function formatPeso(centavos: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 0,
  }).format(centavos / 100);
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString();
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString();
}

/** ISO 3166-1 alpha-2 → flag emoji (paired regional-indicator code points). */
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + upper.charCodeAt(0) - 65,
    0x1f1e6 + upper.charCodeAt(1) - 65,
  );
}

const loginEventTypeColors: Record<string, string> = {
  login_success: 'bg-green-100 text-green-700',
  google_login: 'bg-green-100 text-green-700',
  login_failed: 'bg-red-100 text-red-700',
  mfa_challenge_failed: 'bg-red-100 text-red-700',
  mfa_challenge_passed: 'bg-blue-100 text-blue-700',
  token_refresh: 'bg-gray-100 text-gray-700',
  logout: 'bg-gray-100 text-gray-700',
  password_reset_used: 'bg-amber-100 text-amber-700',
};

export default function AdminUsersPage() {
  const [filters, setFilters] = useState<ListAdminUsersQuery>({});
  const [searchInput, setSearchInput] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAdminUsers(filters);

  const users = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );
  const totalLoaded = users.length;
  const hasNext = data?.pages[data.pages.length - 1]?.hasNext ?? false;

  const onSearch = () => {
    setFilters((prev) => ({ ...prev, search: searchInput || undefined }));
  };

  if (isLoading) return <AdminListSkeleton />;

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <Alert variant="destructive">
          <AlertDescription>Failed to load users. Please try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {totalLoaded} user{totalLoaded !== 1 ? 's' : ''}
            {hasNext ? '+' : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email or name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </form>

        <Select
          value={filters.status ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({ ...prev, status: v === 'all' ? undefined : v }))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {USER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.role ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({ ...prev, role: v === 'all' ? undefined : v }))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {USER_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.planTier ?? 'all'}
          onValueChange={(v) =>
            setFilters((prev) => ({ ...prev, planTier: v === 'all' ? undefined : v }))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            {PLAN_CODES.map((p) => (
              <SelectItem key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Sub status</TableHead>
                <TableHead>LTV</TableHead>
                <TableHead>MFA</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedUserId(u.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {u.emailVerified ? (
                          <MailIcon className="size-3.5 text-muted-foreground" aria-label="Verified" />
                        ) : (
                          <MailWarningIcon className="size-3.5 text-amber-500" aria-label="Unverified" />
                        )}
                        <span className="font-medium">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{u.fullName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.lastLoginAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden>{countryFlag(u.lastLoginCountry)}</span>
                          <span>{formatDate(u.lastLoginAt)}</span>
                          {u.lastLoginCountry && (
                            <span className="text-xs uppercase">{u.lastLoginCountry}</span>
                          )}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.currentPlanCode ? (
                        <Badge variant="secondary">{u.currentPlanCode}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.subscriptionStatus ? (
                        <Badge
                          variant="secondary"
                          className={subStatusColors[u.subscriptionStatus] ?? ''}
                        >
                          {u.subscriptionStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatPeso(u.lifetimeValueCentavos)}
                    </TableCell>
                    <TableCell>
                      {u.mfaEnabled ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                          <ShieldCheckIcon className="mr-1 size-3" />
                          On
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                          Off
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={statusColors[u.status] ?? ''}
                      >
                        {u.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}

      <UserDetailSheet
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}

// ─── Detail Sheet ────────────────────────────────────────

function UserDetailSheet({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { data: user, isLoading, error } = useAdminUser(userId);

  return (
    <Sheet open={!!userId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-2xl">
        <ScrollArea className="h-full">
          <div className="p-6">
            <SheetHeader className="p-0">
              <SheetTitle>{user?.fullName ?? 'User detail'}</SheetTitle>
              <SheetDescription>
                {user?.email ?? (userId ? 'Loading…' : '')}
              </SheetDescription>
            </SheetHeader>

            {isLoading && (
              <div className="mt-6">
                <AdminListSkeleton count={3} />
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-6">
                <AlertDescription>Failed to load user detail.</AlertDescription>
              </Alert>
            )}

            {user && (
              <Tabs defaultValue="profile" className="mt-6">
                <TabsList className="grid w-full grid-cols-7">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="orgs">Orgs</TabsTrigger>
                  <TabsTrigger value="subs">Subscriptions</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="coupons">Coupons</TabsTrigger>
                  <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-3 pt-4 text-sm">
                  <FactRow label="Status" value={user.status} />
                  <FactRow label="Signup source" value={user.signupSource} />
                  <FactRow
                    label="Email verified"
                    value={user.emailVerified ? 'Yes' : 'No'}
                  />
                  <FactRow label="MFA enabled" value={user.mfaEnabled ? 'Yes' : 'No'} />
                  <FactRow label="Role (onboarding)" value={user.userRole ?? '—'} />
                  <FactRow label="Phone" value={user.phone ?? '—'} />
                  <FactRow
                    label="Onboarding completed"
                    value={formatDate(user.onboardingCompletedAt)}
                  />
                  <FactRow label="Created" value={formatDate(user.createdAt)} />
                  <FactRow label="Updated" value={formatDate(user.updatedAt)} />
                  <FactRow
                    label="Last login"
                    value={
                      user.lastLoginAt
                        ? `${formatDateTime(user.lastLoginAt)}${
                            user.lastLoginCountry
                              ? ` · ${countryFlag(user.lastLoginCountry)} ${user.lastLoginCountry}`
                              : ''
                          }`
                        : '—'
                    }
                  />
                  <FactRow label="Last login IP" value={user.lastLoginIp ?? '—'} />
                  {user.expertVerification && (
                    <FactRow
                      label="Expert verification"
                      value={`${user.expertVerification.expertiseType} — ${user.expertVerification.status}`}
                    />
                  )}
                  {user.emailPreferences && (
                    <FactRow
                      label="Email preferences"
                      value={
                        [
                          user.emailPreferences.transactional && 'transactional',
                          user.emailPreferences.subscriptionUpdates && 'subscription',
                          user.emailPreferences.announcements && 'announcements',
                          user.emailPreferences.blogNotifications && 'blog',
                        ]
                          .filter(Boolean)
                          .join(', ') || 'none'
                      }
                    />
                  )}
                </TabsContent>

                <TabsContent value="orgs" className="pt-4">
                  {user.memberships.length === 0 ? (
                    <Empty>No organization memberships.</Empty>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {user.memberships.map((m) => (
                        <div
                          key={m.organizationId}
                          className="rounded-md border bg-card p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{m.organizationName}</span>
                            <Badge variant="secondary">{m.role}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {m.organizationSlug} · joined {formatDate(m.joinedAt)} ·{' '}
                            status {m.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="subs" className="pt-4">
                  {user.subscriptions.length === 0 ? (
                    <Empty>No subscriptions.</Empty>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {user.subscriptions.map((s) => (
                        <div key={s.id} className="rounded-md border bg-card p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {s.planName ?? s.planCode} · {s.organizationName}
                            </span>
                            <Badge
                              variant="secondary"
                              className={subStatusColors[s.status] ?? ''}
                            >
                              {s.status}
                            </Badge>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Billing: {s.billingPeriod}</span>
                            <span>
                              Period: {formatDate(s.currentPeriodStart)} →{' '}
                              {formatDate(s.currentPeriodEnd)}
                            </span>
                            {(s.trialStart || s.trialEnd) && (
                              <span>
                                Trial: {formatDate(s.trialStart)} →{' '}
                                {formatDate(s.trialEnd)}
                              </span>
                            )}
                            {s.cancelAtPeriodEnd && (
                              <span className="text-amber-600">Cancels at period end</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="payments" className="pt-4">
                  {user.payments.length === 0 ? (
                    <Empty>No payments.</Empty>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Paid at</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {user.payments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDate(p.paidAt)}
                            </TableCell>
                            <TableCell>
                              {p.currency} {formatPeso(p.amount)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {p.paymentType}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{p.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="coupons" className="space-y-6 pt-4">
                  <div>
                    <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Coupons
                    </h3>
                    {user.couponRedemptions.length === 0 ? (
                      <Empty>No coupon redemptions.</Empty>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {user.couponRedemptions.map((c) => (
                          <div key={c.id} className="rounded-md border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{c.couponCode}</span>
                              <Badge variant="secondary">{c.status}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {c.discountAmountApplied !== null
                                ? `Discount: ${formatPeso(c.discountAmountApplied)} · `
                                : ''}
                              Redeemed: {formatDate(c.redeemedAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Promotions
                    </h3>
                    {user.promotionRedemptions.length === 0 ? (
                      <Empty>No promotion redemptions.</Empty>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {user.promotionRedemptions.map((p) => (
                          <div key={p.id} className="rounded-md border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{p.promotionName}</span>
                              <Badge variant="secondary">{p.status}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {p.discountAmountApplied !== null
                                ? `Discount: ${formatPeso(p.discountAmountApplied)} · `
                                : ''}
                              {formatDate(p.createdAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="entitlements" className="space-y-6 pt-4">
                  <div>
                    <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Complimentary access
                    </h3>
                    {user.complimentaryAccess.length === 0 ? (
                      <Empty>No complimentary access grants.</Empty>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {user.complimentaryAccess.map((c) => (
                          <div key={c.id} className="rounded-md border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{c.planCode}</span>
                              <Badge variant="secondary">{c.status}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {c.reason} · {formatDate(c.startsAt)} →{' '}
                              {formatDate(c.endsAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Entitlement overrides
                    </h3>
                    {user.entitlementOverrides.length === 0 ? (
                      <Empty>No entitlement overrides.</Empty>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {user.entitlementOverrides.map((o) => (
                          <div key={o.id} className="rounded-md border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">
                                {o.entitlementKey} ({o.overrideType})
                              </span>
                              <Badge
                                variant="secondary"
                                className={o.isActive ? 'bg-green-100 text-green-700' : ''}
                              >
                                {o.isActive ? 'active' : 'inactive'}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {o.numericValue !== null && `numeric: ${o.numericValue} · `}
                              {o.booleanValue !== null && `bool: ${o.booleanValue} · `}
                              {o.reason}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatDate(o.startsAt)} →{' '}
                              {o.expiresAt ? formatDate(o.expiresAt) : 'no expiry'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="pt-4">
                  {user.loginHistory.length === 0 ? (
                    <Empty>No login events captured yet.</Empty>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Device</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {user.loginHistory.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {formatDateTime(e.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={loginEventTypeColors[e.eventType] ?? ''}
                              >
                                {e.eventType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {e.ipAddress ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs">
                              {e.country ? (
                                <span className="inline-flex items-center gap-1">
                                  <span aria-hidden>{countryFlag(e.country)}</span>
                                  <span>
                                    {[e.city, e.region, e.country]
                                      .filter(Boolean)
                                      .join(', ')}
                                  </span>
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell
                              className="max-w-[240px] truncate text-xs text-muted-foreground"
                              title={e.userAgent ?? ''}
                            >
                              {e.userAgent ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
