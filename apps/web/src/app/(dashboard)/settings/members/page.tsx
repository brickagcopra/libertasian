'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  SearchIcon,
  ShieldIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  ChevronRightIcon,
  XIcon,
  CalendarIcon,
  Loader2Icon,
  UsersIcon,
  AlertTriangleIcon,
} from 'lucide-react';

import {
  useRbacMembers,
  useRoles,
  useMemberRoles,
  useMemberEffectivePermissions,
  useAssignRole,
  useRemoveRole,
} from '@/features/settings/hooks/use-rbac';
import { useSubscription } from '@/features/billing/hooks/use-subscription';
import { useQuotaUsage } from '@/features/billing/hooks/use-quotas';
import { PLAN_LABELS } from '@/features/billing/types';
import { PermissionGate } from '@/components/layout/permission-gate';
import { PlatformAdminGate } from '@/components/layout/platform-admin-gate';
import type {
  MemberWithRoles,
  RoleDefinitionDto,
} from '@libertasian/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ---------------------------------------------------------------------------
// Role color mapping
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  editor: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  reviewer: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  member: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  student: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
};

function getRoleBadgeClass(slug: string): string {
  return ROLE_COLORS[slug] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MembersPage() {
  return (
    <PlatformAdminGate>
      <PermissionGate
        permissions="members:read"
        fallback={
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <ShieldIcon className="size-12 text-muted-foreground" />
            <p className="text-lg font-medium">Access Denied</p>
            <p className="text-muted-foreground">
              You do not have permission to view members.
            </p>
            <Button variant="outline" asChild>
              <Link href="/settings">Back to Settings</Link>
            </Button>
          </div>
        }
      >
        <MembersContent />
      </PermissionGate>
    </PlatformAdminGate>
  );
}

function MembersContent() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedMember, setSelectedMember] = useState<MemberWithRoles | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignMemberId, setAssignMemberId] = useState('');

  const { data, isLoading, error } = useRbacMembers({
    search: search || undefined,
    roleSlug: roleFilter || undefined,
    cursor,
    limit: 20,
  });

  const { data: roles } = useRoles();

  const members = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Members &amp; Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage organization members and their RBAC role assignments
          </p>
        </div>
      </div>

      {/* Team Stats */}
      <TeamStatsCard memberCount={members.length} isLoading={isLoading} />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
              className="pl-9"
            />
          </div>

          <Select
            value={roleFilter}
            onValueChange={(v) => {
              setRoleFilter(v === '__all__' ? '' : v);
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All roles</SelectItem>
              {roles?.map((r) => (
                <SelectItem key={r.id} value={r.slug}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="text-xs text-muted-foreground">
            {members.length > 0 && `Showing ${members.length} member${members.length === 1 ? '' : 's'}`}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiClientError ? error.message : 'Failed to load members'}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Members Table */}
      {!isLoading && members.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Legacy Role</TableHead>
                <TableHead>RBAC Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{member.fullName}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {member.legacyRole}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {member.roles.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No RBAC roles</span>
                      )}
                      {member.roles.map((r) => (
                        <Badge
                          key={r.id}
                          className={`text-xs ${getRoleBadgeClass(r.roleSlug)}`}
                        >
                          {r.roleName}
                          {r.expiresAt && (
                            <span className="ml-1 inline-flex items-center" aria-label={`Expires ${new Date(r.expiresAt).toLocaleDateString()}`}>
                              <CalendarIcon className="size-3" />
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={member.status === 'active' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedMember(member)}
                      >
                        <ShieldCheckIcon className="mr-1 size-3.5" />
                        View
                      </Button>
                      <PermissionGate permissions="members:update-role">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAssignMemberId(member.id);
                            setAssignDialogOpen(true);
                          }}
                        >
                          <UserPlusIcon className="mr-1 size-3.5" />
                          Assign
                        </Button>
                      </PermissionGate>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && members.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldIcon className="mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No members found</p>
            <p className="text-sm text-muted-foreground">
              {search || roleFilter
                ? 'Try adjusting your search or filter.'
                : 'Your organization has no members yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {meta && (meta.hasNext || cursor) && (
        <div className="flex items-center justify-center gap-2">
          {cursor && (
            <Button variant="outline" size="sm" onClick={() => setCursor(undefined)}>
              First page
            </Button>
          )}
          {meta.hasNext && meta.nextCursor && (
            <Button variant="outline" size="sm" onClick={() => setCursor(meta.nextCursor)}>
              Next page
              <ChevronRightIcon className="ml-1 size-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Member Detail Dialog */}
      {selectedMember && (
        <MemberDetailDialog
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          onAssignRole={(memberId) => {
            setAssignMemberId(memberId);
            setAssignDialogOpen(true);
          }}
        />
      )}

      {/* Assign Role Dialog */}
      {assignDialogOpen && (
        <AssignRoleDialog
          memberId={assignMemberId}
          roles={roles ?? []}
          onClose={() => {
            setAssignDialogOpen(false);
            setAssignMemberId('');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member Detail Dialog
// ---------------------------------------------------------------------------

function MemberDetailDialog({
  member,
  onClose,
  onAssignRole,
}: {
  member: MemberWithRoles;
  onClose: () => void;
  onAssignRole: (memberId: string) => void;
}) {
  const { data: roles, isLoading: rolesLoading } = useMemberRoles(member.id);
  const { data: permissions, isLoading: permsLoading } = useMemberEffectivePermissions(member.id);
  const removeRole = useRemoveRole();
  const [error, setError] = useState('');

  const handleRemoveRole = useCallback(
    async (roleDefinitionId: string) => {
      try {
        setError('');
        await removeRole.mutateAsync({ memberId: member.id, roleDefinitionId });
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'Failed to remove role');
      }
    },
    [member.id, removeRole],
  );

  // Group permissions by resource prefix
  const permissionsByCategory = useMemo(() => {
    if (!permissions) return {} as Record<string, string[]>;
    const groups: Record<string, string[]> = {};
    for (const code of permissions) {
      const resource = code.split(':')[0] ?? 'other';
      if (!groups[resource]) groups[resource] = [];
      groups[resource]!.push(code);
    }
    return groups;
  }, [permissions]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5" />
            {member.fullName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Member info */}
          <div className="text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">Email:</span> {member.email}
            </p>
            <p>
              <span className="text-muted-foreground">Legacy role:</span>{' '}
              <Badge variant="outline" className="text-xs">
                {member.legacyRole}
              </Badge>
            </p>
            <p>
              <span className="text-muted-foreground">Status:</span>{' '}
              <Badge variant={member.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                {member.status}
              </Badge>
            </p>
          </div>

          <Separator />

          {/* Assigned roles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Assigned Roles</h3>
              <PermissionGate permissions="members:update-role">
                <Button size="sm" variant="outline" onClick={() => onAssignRole(member.id)}>
                  <UserPlusIcon className="mr-1 size-3.5" />
                  Assign Role
                </Button>
              </PermissionGate>
            </div>

            {error && (
              <Alert variant="destructive" className="mb-2">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {rolesLoading && <Skeleton className="h-8 w-full" />}

            {!rolesLoading && roles && roles.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No RBAC roles assigned</p>
            )}

            {roles?.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 mb-1"
              >
                <div>
                  <Badge className={`text-xs ${getRoleBadgeClass(r.roleSlug)}`}>
                    {r.roleName}
                  </Badge>
                  {r.isSystem && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(system)</span>
                  )}
                  {r.expiresAt && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      Expires {new Date(r.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                  {r.assignedByName && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      by {r.assignedByName}
                    </span>
                  )}
                </div>
                <PermissionGate permissions="members:update-role">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => handleRemoveRole(r.roleDefinitionId)}
                    disabled={removeRole.isPending}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </PermissionGate>
              </div>
            ))}
          </div>

          <Separator />

          {/* Effective permissions */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Effective Permissions ({permissions?.length ?? 0})
            </h3>

            {permsLoading && <Skeleton className="h-20 w-full" />}

            {!permsLoading && permissions && permissions.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No permissions resolved</p>
            )}

            {!permsLoading && Object.keys(permissionsByCategory).length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {Object.entries(permissionsByCategory)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([resource, codes]) => (
                    <div key={resource}>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                        {resource}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {codes.map((code) => (
                          <Badge key={code} variant="secondary" className="text-[10px]">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Assign Role Dialog
// ---------------------------------------------------------------------------

function AssignRoleDialog({
  memberId,
  roles,
  onClose,
}: {
  memberId: string;
  roles: RoleDefinitionDto[];
  onClose: () => void;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const assignRole = useAssignRole();

  const handleAssign = useCallback(async () => {
    if (!selectedRoleId) return;
    try {
      setError('');
      await assignRole.mutateAsync({
        memberId,
        roleDefinitionId: selectedRoleId,
        expiresAt: expiresAt || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to assign role');
    }
  }, [memberId, selectedRoleId, expiresAt, assignRole, onClose]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlusIcon className="size-5" />
            Assign Role
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role to assign" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <span className="flex items-center gap-2">
                      {r.name}
                      {r.isSystem && (
                        <Badge variant="secondary" className="text-[10px]">
                          system
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRoleId && (
              <p className="text-xs text-muted-foreground">
                {roles.find((r) => r.id === selectedRoleId)?.description ?? ''}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Expiry Date <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for a permanent assignment.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedRoleId || assignRole.isPending}
            >
              {assignRole.isPending && <Loader2Icon className="mr-1 size-4 animate-spin" />}
              Assign Role
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Team Stats Card
// ---------------------------------------------------------------------------

function TeamStatsCard({
  memberCount,
  isLoading: membersLoading,
}: {
  memberCount: number;
  isLoading: boolean;
}) {
  const { data: subscription, isLoading: subLoading } = useSubscription();
  const { data: usageData, isLoading: quotaLoading } = useQuotaUsage();

  const isLoading = subLoading || quotaLoading || membersLoading;
  const planCode = subscription?.planCode ?? 'free';
  const planName = PLAN_LABELS[planCode] ?? planCode;
  const seats = subscription?.seats ?? 1;

  // Get team_members_allowed from quota data
  const teamQuota = usageData?.quotas?.['team_members_allowed'];
  const maxMembers = teamQuota ? teamQuota.limit : seats;
  const isUnlimited = maxMembers < 0 || maxMembers >= 999999;
  const seatPercent = isUnlimited || maxMembers <= 0
    ? 0
    : Math.min(100, Math.round((memberCount / maxMembers) * 100));
  const nearLimit = !isUnlimited && maxMembers > 0 && memberCount / maxMembers >= 0.8;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={nearLimit ? 'border-amber-300 dark:border-amber-700' : ''}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <UsersIcon className="h-5 w-5 text-primary" />
        </div>

        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Team Members</p>
            <Badge variant="secondary" className="text-xs">{planName} plan</Badge>
            {nearLimit && (
              <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
            )}
          </div>

          {isUnlimited ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {memberCount} member{memberCount !== 1 ? 's' : ''} &middot; Unlimited seats
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-lg font-bold">{memberCount}</span>
                <span className="text-sm text-muted-foreground">/ {maxMembers} seats</span>
              </div>
              <Progress
                value={seatPercent}
                className={`mt-1.5 h-1.5 ${
                  seatPercent >= 90
                    ? '[&>[data-slot=progress-indicator]]:bg-red-500'
                    : seatPercent >= 80
                      ? '[&>[data-slot=progress-indicator]]:bg-amber-500'
                      : ''
                }`}
              />
            </>
          )}
        </div>

        {subscription?.billingPeriod && planCode !== 'free' && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              Billed {subscription.billingPeriod}
            </p>
            {subscription.currentPeriodEnd && (
              <p className="text-xs text-muted-foreground">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-PH', {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
