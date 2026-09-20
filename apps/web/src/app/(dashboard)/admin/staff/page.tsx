'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';

import { PermissionGate } from '@/components/layout/permission-gate';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  useCreatePlatformRole,
  useGrantPlatformRole,
  useInvitePlatformMember,
  usePlatformAuditLogs,
  usePlatformPermissions,
  usePlatformRoles,
  usePlatformStaff,
  useRevokePlatformRole,
  type PlatformStaffMember,
} from '@/features/settings/hooks/use-platform-staff';

/**
 * Staff Administration.
 *
 * The surface where platform capability is granted, and the only one. It acts
 * on the PLATFORM organization explicitly — never on whatever org the caller's
 * token happens to carry, which for anyone who signed up normally is their own
 * personal workspace, where a grant would confer nothing.
 *
 * No role names are written into this file. The grantable roles come from
 * GET /rbac/platform/roles at runtime, so a role created here appears in the
 * grant picker immediately, with no deploy (P1).
 *
 * The PermissionGates below HIDE; they do not protect. Every action has a
 * server-side guard resolving the same permission on the same org, and that
 * guard is the control (P3).
 */
export default function StaffAdministrationPage() {
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [grantFor, setGrantFor] = useState<PlatformStaffMember | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: staff, isLoading, error } = usePlatformStaff({ search: search || undefined });
  const { data: roles } = usePlatformRoles();
  const revokeRole = useRevokePlatformRole();

  const handleRevoke = async (memberId: string, roleDefinitionId: string) => {
    setActionError(null);
    try {
      await revokeRole.mutateAsync({ memberId, roleDefinitionId });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not revoke that role.',
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Staff Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who holds capability on the LIBERTASIAN platform organization, and what it
            buys them. Owning a personal workspace confers nothing here.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name or email"
          className="h-9 w-[260px]"
        />
        <PermissionGate permissions="members:invite">
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Invite to platform
          </Button>
        </PermissionGate>
        <PermissionGate permissions="roles:create">
          <Button size="sm" variant="outline" onClick={() => setCreateRoleOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New role
          </Button>
        </PermissionGate>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Could not load platform staff.'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={4} />
      ) : staff && staff.items.length > 0 ? (
        <div className="space-y-3">
          {staff.items.map((member) => (
            <StaffCard
              key={member.id}
              member={member}
              onGrant={() => {
                setActionError(null);
                setGrantFor(member);
              }}
              onRevoke={handleRevoke}
              revoking={revokeRole.isPending}
            />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No platform staff match this search.
        </p>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles ?? []}
      />
      <CreateRoleDialog open={createRoleOpen} onOpenChange={setCreateRoleOpen} />
      <GrantRoleDialog
        member={grantFor}
        roles={roles ?? []}
        onClose={() => setGrantFor(null)}
      />

      <Separator />
      <AuditTrail />
    </div>
  );
}

// ---------------------------------------------------------------------------

function StaffCard({
  member,
  onGrant,
  onRevoke,
  revoking,
}: {
  member: PlatformStaffMember;
  onGrant: () => void;
  onRevoke: (memberId: string, roleDefinitionId: string) => void;
  revoking: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{member.fullName || member.email}</p>
            <p className="text-xs text-muted-foreground">{member.email}</p>
          </div>
          <PermissionGate permissions="members:update-role">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onGrant}>
              <ShieldCheck className="mr-1 h-3 w-3" />
              Grant role
            </Button>
          </PermissionGate>
        </div>

        <div className="flex flex-wrap gap-2">
          {member.roles.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No roles — this member has no platform capability.
            </span>
          ) : (
            member.roles.map((role) => (
              <span
                key={role.id}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
              >
                {role.roleName}
                {role.expiresAt && (
                  <Badge variant="secondary" className="text-[10px]">
                    until {new Date(role.expiresAt).toLocaleDateString()}
                  </Badge>
                )}
                <PermissionGate permissions="members:update-role">
                  <button
                    aria-label={`Revoke ${role.roleName}`}
                    onClick={() => onRevoke(member.id, role.roleDefinitionId)}
                    disabled={revoking}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </PermissionGate>
              </span>
            ))
          )}
        </div>

        {/*
          The resolved set, not the role names. Role names hide that `admin`
          carries `reviewer`'s grants through the hierarchy, and that an expired
          grant contributes nothing — which is exactly what someone about to
          change a grant needs to see.
        */}
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {member.effectivePermissions.length} effective permission
            {member.effectivePermissions.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {member.effectivePermissions.map((code) => (
              <code key={code} className="rounded bg-muted px-1 py-0.5 text-[10px]">
                {code}
              </code>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Array<{ id: string; slug: string; name: string; isSystem: boolean }>;
}) {
  const [email, setEmail] = useState('');
  const [roleSlug, setRoleSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invite = useInvitePlatformMember();

  // The invite endpoint takes a legacy role SLUG, and only accepts the system
  // ones. Custom roles are granted after the invite, via Grant role.
  const invitableRoles = roles.filter((r) => r.isSystem);

  const submit = async () => {
    setError(null);
    try {
      await invite.mutateAsync({ email, role: roleSlug });
      setEmail('');
      setRoleSlug('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invite.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to the platform organization</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div>
            <Label htmlFor="staff-invite-email" className="text-sm">
              Email
            </Label>
            <Input
              id="staff-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@libertasian.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Starting role</Label>
            <Select value={roleSlug} onValueChange={setRoleSlug}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {invitableRoles.map((role) => (
                  <SelectItem key={role.id} value={role.slug}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!email || !roleSlug || invite.isPending}
            >
              {invite.isPending ? 'Sending...' : 'Send invite'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function GrantRoleDialog({
  member,
  roles,
  onClose,
}: {
  member: PlatformStaffMember | null;
  roles: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [roleDefinitionId, setRoleDefinitionId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const grant = useGrantPlatformRole();

  const held = new Set((member?.roles ?? []).map((r) => r.roleDefinitionId));
  const grantable = roles.filter((r) => !held.has(r.id));

  const submit = async () => {
    if (!member) return;
    setError(null);
    try {
      await grant.mutateAsync({
        memberId: member.id,
        roleDefinitionId,
        // A date input gives a local date; send end-of-day UTC so a grant made
        // "until the 30th" is not already expired on the morning of the 30th.
        ...(expiresAt
          ? { expiresAt: new Date(`${expiresAt}T23:59:59.000Z`).toISOString() }
          : {}),
      });
      setRoleDefinitionId('');
      setExpiresAt('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant that role.');
    }
  };

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Grant a role to {member?.fullName || member?.email}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div>
            <Label className="text-sm">Role</Label>
            <Select value={roleDefinitionId} onValueChange={setRoleDefinitionId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {grantable.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="grant-expires" className="text-sm">
              Expires (optional)
            </Label>
            <Input
              id="grant-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave empty for a permanent grant. An expired grant stops resolving
              immediately — no job has to run.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!roleDefinitionId || grant.isPending}>
              {grant.isPending ? 'Granting...' : 'Grant role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { data: permissions } = usePlatformPermissions();
  const createRole = useCreatePlatformRole();

  const byCategory = (permissions ?? []).reduce<
    Record<string, typeof permissions>
  >((acc, permission) => {
    (acc[permission.category] ??= []).push(permission);
    return acc;
  }, {});

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setError(null);
    try {
      await createRole.mutateAsync({
        name,
        slug,
        permissionIds: Array.from(selected),
      });
      setName('');
      setSlug('');
      setSelected(new Set());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that role.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a platform role</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="role-name" className="text-sm">
                Name
              </Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Slug is derived but editable — a role slug is permanent and
                  // must not be a surprise.
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-+|-+$/g, ''),
                  );
                }}
                placeholder="Bar Exam Editor"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="role-slug" className="text-sm">
                Slug
              </Label>
              <Input
                id="role-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="bar-exam-editor"
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Permissions ({selected.size} selected)
            </p>
            {Object.entries(byCategory).map(([category, perms]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-medium capitalize">{category}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {(perms ?? []).map((permission) => (
                    <label
                      key={permission.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <Checkbox
                        checked={selected.has(permission.id)}
                        onCheckedChange={() => toggle(permission.id)}
                      />
                      <code>{permission.code}</code>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!name || !slug || selected.size === 0 || createRole.isPending}
            >
              {createRole.isPending ? 'Creating...' : 'Create role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function AuditTrail() {
  const { data, isLoading } = usePlatformAuditLogs({ limit: 20 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent grant activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading audit trail...</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <code className="rounded bg-muted px-1 py-0.5">{entry.action}</code>
                <span className="text-muted-foreground">
                  {String(entry.metadataJson?.['roleName'] ?? entry.entityType)}
                </span>
                <span className="text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No role grants or revocations recorded yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
