'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangleIcon,
  ArrowLeft,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  LockIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
  UserPlusIcon,
} from 'lucide-react';

import {
  serverMessage,
  useCreatePlatformRole,
  useDeletePlatformRole,
  useGrantPlatformRole,
  usePermissionCatalogue,
  usePlatformRole,
  usePlatformRoles,
  usePlatformStaff,
  useRevokePlatformRole,
  useStaffCandidates,
  useUpdatePlatformRole,
} from '@/features/settings/hooks/use-platform-staff';
import { PermissionGate } from '@/components/layout/permission-gate';
import type {
  PermissionDef,
  PlatformGrant,
  PlatformRoleSummary,
  PlatformStaffCandidate,
} from '@libertasian/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Permission codes the server actually enforces. The UI only hides (P4). */
const MANAGE_STAFF = 'platform-staff:manage';
const MANAGE_ROLES = 'platform-roles:manage';

/**
 * Platform staff administration.
 *
 * Everything on this page is loaded at runtime: the role list comes from
 * GET /platform/roles and the permission picker from GET /platform/permissions,
 * so a role created here works with no deploy and there is no role-name string
 * literal anywhere in it.
 *
 * Refusal messages from the server are rendered VERBATIM. Escalation,
 * separation-of-duties, cardinality and last-admin errors are written to teach
 * the operator the rule they hit; a generic toast throws that away.
 */
export default function PlatformStaffPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Platform Staff</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Platform capability is a grant on a person — it belongs to no
            organization. Grants are made here and nowhere else: no migration,
            seed or deploy creates one.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="roles">Platform roles</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
          <PermissionGate
            permissions={MANAGE_STAFF}
            fallback={<NoAccessNotice permission={MANAGE_STAFF} />}
            hideWhileLoading={false}
          >
            <StaffTab />
          </PermissionGate>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <PermissionGate
            permissions={MANAGE_ROLES}
            fallback={<NoAccessNotice permission={MANAGE_ROLES} />}
            hideWhileLoading={false}
          >
            <RolesTab />
          </PermissionGate>
        </TabsContent>
      </Tabs>

      <AuditLink />
    </div>
  );
}

function NoAccessNotice({ permission }: { permission: string }) {
  return (
    <Alert>
      <AlertDescription className="text-sm">
        You do not hold <code className="font-mono">{permission}</code>. This is
        a platform permission — an organization role cannot confer it. Ask
        someone who administers staff to grant you a platform role that includes
        it.
      </AlertDescription>
    </Alert>
  );
}

function AuditLink() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-2">
          <ScrollTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Every grant, revoke and refusal on this page writes an audit entry.
            Filter the audit log by entity type{' '}
            <code className="font-mono">platform_role_grant</code>, or by action{' '}
            <code className="font-mono">platform_grant.created</code>,{' '}
            <code className="font-mono">platform_grant.revoked</code>,{' '}
            <code className="font-mono">platform_grant.refused</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/audit-logs">Open audit log</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Staff tab
// ===========================================================================

function StaffTab() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [grantOpen, setGrantOpen] = useState(false);
  const { data, isLoading, error } = usePlatformStaff(
    cursor ? { cursor } : undefined,
  );
  const revoke = useRevokePlatformRole();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const handleRevoke = async (grant: PlatformGrant) => {
    setRevokeError(null);
    try {
      await revoke.mutateAsync({
        userId: grant.userId,
        roleDefinitionId: grant.roleDefinitionId,
      });
    } catch (err) {
      // Verbatim: the last-admin refusal explains why it was refused and what
      // to do first. Replacing it with "Revoke failed" hides the instruction.
      setRevokeError(serverMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.items.length} grant(s) on this page` : ' '}
        </p>
        <Button size="sm" onClick={() => setGrantOpen(true)}>
          <UserPlusIcon className="mr-1.5 h-4 w-4" />
          Grant a role
        </Button>
      </div>

      {revokeError && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertDescription>{revokeError}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{serverMessage(error)}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={4} />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((grant) => (
            <StaffRow
              key={grant.id}
              grant={grant}
              onRevoke={() => handleRevoke(grant)}
              isRevoking={revoke.isPending}
            />
          ))}
          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nobody holds a platform role yet. The first admin is created with
            the interactive CLI (
            <code className="font-mono text-xs">
              pnpm --filter api platform:grant
            </code>
            ); everyone after that is granted here.
          </CardContent>
        </Card>
      )}

      <GrantDialog open={grantOpen} onOpenChange={setGrantOpen} />
    </div>
  );
}

function StaffRow({
  grant,
  onRevoke,
  isRevoking,
}: {
  grant: PlatformGrant;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const expired =
    grant.expiresAt !== null && new Date(grant.expiresAt) <= new Date();

  return (
    <Card className={expired ? 'opacity-60' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{grant.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {grant.email}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <ShieldIcon className="mr-1 h-3 w-3" />
                {grant.roleName}
              </Badge>
              {grant.isSystemRole && (
                <Badge variant="outline" className="text-xs">
                  built-in
                </Badge>
              )}
              {expired ? (
                <Badge className="bg-red-100 text-red-700">expired</Badge>
              ) : grant.expiresAt ? (
                <Badge className="bg-yellow-100 text-yellow-700">
                  expires {new Date(grant.expiresAt).toLocaleDateString()}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">no expiry</span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Granted by {grant.grantedByName ?? 'the bootstrap CLI'} on{' '}
              {new Date(grant.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronDownIcon className="mr-1 h-3.5 w-3.5" />
              ) : (
                <ChevronRightIcon className="mr-1 h-3.5 w-3.5" />
              )}
              {grant.permissions.length} permission
              {grant.permissions.length === 1 ? '' : 's'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs text-red-600 hover:bg-red-50"
              onClick={onRevoke}
              disabled={isRevoking}
            >
              <TrashIcon className="mr-1 h-3.5 w-3.5" />
              Revoke
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3">
            <Separator className="mb-3" />
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Permissions this grants (hierarchy expanded)
            </p>
            {grant.permissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This role confers nothing.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {grant.permissions.map((code) => (
                  <code
                    key={code}
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                      code.startsWith('admin:') ||
                      code.startsWith('platform-')
                        ? 'bg-red-50 text-red-700'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {code}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GrantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PlatformStaffCandidate | null>(null);
  const [roleId, setRoleId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const { data: candidates, isFetching } = useStaffCandidates(query);
  const { data: roles } = usePlatformRoles();
  const grant = useGrantPlatformRole();

  const chosenRole = useMemo(
    () => roles?.find((r) => r.id === roleId) ?? null,
    [roles, roleId],
  );

  const reset = () => {
    setQuery('');
    setSelected(null);
    setRoleId('');
    setExpiresAt('');
    setFailure(null);
  };

  const handleSubmit = async () => {
    if (!selected || !roleId) return;
    setFailure(null);
    try {
      await grant.mutateAsync({
        userId: selected.userId,
        roleDefinitionId: roleId,
        ...(expiresAt
          ? { expiresAt: new Date(expiresAt).toISOString() }
          : {}),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      // Stay open on failure so the operator can fix the thing the server
      // just explained (pick a different role, revoke the conflicting one).
      setFailure(serverMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant a platform role</DialogTitle>
          <DialogDescription>
            Existing accounts only. Nobody is invited or created from here — if
            the person has no account, ask them to sign up first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="staff-search" className="text-sm">
              Find the person
            </Label>
            <div className="relative mt-1">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="staff-search"
                value={selected ? `${selected.fullName} (${selected.email})` : query}
                onChange={(e) => {
                  setSelected(null);
                  setQuery(e.target.value);
                }}
                placeholder="Email or name (at least 2 characters)"
                className="pl-8"
              />
            </div>

            {!selected && query.trim().length >= 2 && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded-md border">
                {isFetching && (
                  <p className="p-2 text-xs text-muted-foreground">Searching…</p>
                )}
                {!isFetching && candidates && candidates.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">
                    No account matches “{query.trim()}”. They must sign up
                    before a role can be granted.
                  </p>
                )}
                {candidates?.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="text-sm">{c.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.email}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="staff-role" className="text-sm">
              Role
            </Label>
            <select
              id="staff-role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Select a role…</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.isSystem ? ' (built-in)' : ''} — {r.permissions.length}{' '}
                  permission{r.permissions.length === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            {chosenRole && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {chosenRole.description ?? 'No description.'}
                {chosenRole.maxPerOrg !== null && (
                  <>
                    {' '}
                    Limited to {chosenRole.maxPerOrg} platform holder
                    {chosenRole.maxPerOrg === 1 ? '' : 's'} (
                    {chosenRole.holderCount} currently).
                  </>
                )}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="staff-expiry" className="text-sm">
              Expires (optional)
            </Label>
            <Input
              id="staff-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              An expired grant stops conferring access on its own; it stays
              visible here so you can see what lapsed.
            </p>
          </div>

          {failure && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selected || !roleId || grant.isPending}
            >
              {grant.isPending ? 'Granting…' : 'Grant role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Roles tab
// ===========================================================================

interface RoleDraft {
  /** Set when editing an existing custom role; null when creating or cloning. */
  id: string | null;
  name: string;
  slug: string;
  description: string;
  permissionIds: string[];
  /** Where the draft came from, for the dialog heading. */
  origin: 'new' | 'clone' | 'edit';
  clonedFrom?: string;
}

function RolesTab() {
  const { data: roles, isLoading, error } = usePlatformRoles();
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [cloneSource, setCloneSource] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteRole = useDeletePlatformRole();

  // A clone needs the source role's permission IDs, which the summary list
  // does not carry (it carries codes). Fetch the one being cloned, then turn
  // it into a draft once it arrives.
  const { data: source } = usePlatformRole(cloneSource);
  useEffect(() => {
    if (!source || !cloneSource) return;
    setCloneSource(null);
    setDraft({
      id: null,
      origin: 'clone',
      clonedFrom: source.name,
      name: `${source.name} (copy)`,
      slug: `${source.slug}-copy`,
      description: source.description ?? '',
      permissionIds: source.permissions.map((p) => p.id),
    });
  }, [source, cloneSource]);

  const handleDelete = async (role: PlatformRoleSummary) => {
    setDeleteError(null);
    try {
      await deleteRole.mutateAsync(role.id);
    } catch (err) {
      setDeleteError(serverMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">
          Roles are data. One created here is grantable immediately, with no
          deploy. Built-in roles are immutable — clone one to customise it.
        </p>
        <Button
          size="sm"
          onClick={() =>
            setDraft({
              id: null,
              origin: 'new',
              name: '',
              slug: '',
              description: '',
              permissionIds: [],
            })
          }
        >
          <PlusIcon className="mr-1.5 h-4 w-4" />
          New platform role
        </Button>
      </div>

      {deleteError && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{serverMessage(error)}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={4} />
      ) : (
        <div className="space-y-2">
          {roles?.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              onClone={() => setCloneSource(role.id)}
              onEdit={() =>
                setDraft({
                  id: role.id,
                  origin: 'edit',
                  name: role.name,
                  slug: role.slug,
                  description: role.description ?? '',
                  permissionIds: [],
                })
              }
              onDelete={() => handleDelete(role)}
              isDeleting={deleteRole.isPending}
            />
          ))}
        </div>
      )}

      {draft && (
        <RoleEditorDialog draft={draft} onClose={() => setDraft(null)} />
      )}
    </div>
  );
}

function RoleRow({
  role,
  onClone,
  onEdit,
  onDelete,
  isDeleting,
}: {
  role: PlatformRoleSummary;
  onClone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{role.name}</p>
              {role.isSystem && (
                <Badge variant="outline" className="text-xs">
                  <LockIcon className="mr-1 h-3 w-3" />
                  built-in — read-only
                </Badge>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {role.slug}
            </p>
            {role.description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {role.description}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {role.holderCount} holder{role.holderCount === 1 ? '' : 's'}
              {role.maxPerOrg !== null && ` of ${role.maxPerOrg} allowed`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronDownIcon className="mr-1 h-3.5 w-3.5" />
              ) : (
                <ChevronRightIcon className="mr-1 h-3.5 w-3.5" />
              )}
              {role.permissions.length} permission
              {role.permissions.length === 1 ? '' : 's'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={onClone}
            >
              <CopyIcon className="mr-1 h-3.5 w-3.5" />
              Clone
            </Button>
            {!role.isSystem && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={onEdit}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs text-red-600 hover:bg-red-50"
                  onClick={onDelete}
                  disabled={isDeleting}
                >
                  <TrashIcon className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3">
            <Separator className="mb-3" />
            <div className="flex flex-wrap gap-1">
              {role.permissions.map((code) => (
                <code
                  key={code}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {code}
                </code>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoleEditorDialog({
  draft,
  onClose,
}: {
  draft: RoleDraft;
  onClose: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [slug, setSlug] = useState(draft.slug);
  const [description, setDescription] = useState(draft.description);
  const [failure, setFailure] = useState<string | null>(null);

  const { data: catalogue, isLoading: catalogueLoading } =
    usePermissionCatalogue();
  // When editing, load the role's current permission ids.
  const { data: existing } = usePlatformRole(draft.origin === 'edit' ? draft.id : null);

  const [selectedIds, setSelectedIds] = useState<string[] | null>(
    draft.permissionIds.length > 0 ? draft.permissionIds : null,
  );
  const effectiveSelected =
    selectedIds ?? existing?.permissions.map((p) => p.id) ?? [];

  const create = useCreatePlatformRole();
  const update = useUpdatePlatformRole();
  const isPending = create.isPending || update.isPending;

  const toggle = (id: string) => {
    const next = effectiveSelected.includes(id)
      ? effectiveSelected.filter((p) => p !== id)
      : [...effectiveSelected, id];
    setSelectedIds(next);
  };

  const toggleGroup = (ids: string[], allOn: boolean) => {
    const next = allOn
      ? effectiveSelected.filter((id) => !ids.includes(id))
      : [...new Set([...effectiveSelected, ...ids])];
    setSelectedIds(next);
  };

  const handleSubmit = async () => {
    setFailure(null);
    try {
      if (draft.origin === 'edit' && draft.id) {
        await update.mutateAsync({
          id: draft.id,
          name,
          description,
          permissionIds: effectiveSelected,
        });
      } else {
        await create.mutateAsync({
          name,
          slug,
          description,
          permissionIds: effectiveSelected,
        });
      }
      onClose();
    } catch (err) {
      // Stay open: the escalation refusal names the permissions to remove.
      setFailure(serverMessage(err));
    }
  };

  const heading =
    draft.origin === 'edit'
      ? `Edit ${draft.name}`
      : draft.origin === 'clone'
        ? `Clone of ${draft.clonedFrom}`
        : 'New platform role';

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            You can only put permissions into a role that you hold yourself —
            otherwise authoring a role would be a way around the
            no-escalation rule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="role-name" className="text-sm">
                Name
              </Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                disabled={draft.origin === 'edit'}
                className="mt-1 font-mono"
                placeholder="corpus-reviewer"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="role-description" className="text-sm">
              Description
            </Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1"
            />
          </div>

          <div>
            <p className="text-sm font-medium">
              Permissions{' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({effectiveSelected.length} selected)
              </span>
            </p>
            {catalogueLoading ? (
              <AdminListSkeleton count={3} />
            ) : (
              <div className="mt-2 space-y-3">
                {catalogue?.groups.map((group) => (
                  <PermissionGroupPicker
                    key={group.category}
                    category={group.category}
                    resources={group.resources}
                    selected={effectiveSelected}
                    onToggle={toggle}
                    onToggleGroup={toggleGroup}
                  />
                ))}
              </div>
            )}
          </div>

          {failure && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                isPending ||
                !name.trim() ||
                (draft.origin !== 'edit' && !slug.trim()) ||
                effectiveSelected.length === 0
              }
            >
              {isPending
                ? 'Saving…'
                : draft.origin === 'edit'
                  ? 'Save changes'
                  : 'Create role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PermissionGroupPicker({
  category,
  resources,
  selected,
  onToggle,
  onToggleGroup,
}: {
  category: string;
  resources: Array<{ resource: string; permissions: PermissionDef[] }>;
  selected: string[];
  onToggle: (id: string) => void;
  onToggleGroup: (ids: string[], allOn: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const allIds = resources.flatMap((r) => r.permissions.map((p) => p.id));
  const chosen = allIds.filter((id) => selected.includes(id)).length;
  const allOn = chosen === allIds.length && allIds.length > 0;

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium capitalize"
        >
          {open ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
          {category}
          <span className="text-xs font-normal text-muted-foreground">
            {chosen}/{allIds.length}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onToggleGroup(allIds, allOn)}
        >
          {allOn ? 'Clear' : 'Select all'}
        </Button>
      </div>

      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {resources.map((resource) => (
            <div key={resource.resource}>
              <p className="font-mono text-[11px] uppercase text-muted-foreground">
                {resource.resource}
              </p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {resource.permissions.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex items-start gap-2 text-xs"
                  >
                    <Checkbox
                      checked={selected.includes(permission.id)}
                      onCheckedChange={() => onToggle(permission.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <code className="font-mono">{permission.code}</code>
                      {permission.description && (
                        <span className="block text-muted-foreground">
                          {permission.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
