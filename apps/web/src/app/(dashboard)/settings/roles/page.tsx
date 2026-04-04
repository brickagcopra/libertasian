'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldIcon,
  ShieldCheckIcon,
  CheckIcon,
  MinusIcon,
  ChevronsRightIcon,
  AlertTriangleIcon,
  Loader2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  LockIcon,
  UnlockIcon,
  InfoIcon,
  XIcon,
} from 'lucide-react';

import {
  useRoles,
  usePermissions,
  useRoleHierarchy,
  useConstraints,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
} from '@/features/settings/hooks/use-rbac';
import { PermissionGate } from '@/components/layout/permission-gate';
import type {
  RoleDefinitionDto,
  PermissionDef,
  RoleHierarchyNode,
  RbacConstraint,
} from '@libertasian/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ---------------------------------------------------------------------------
// Role color mapping (shared with members page)
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

export default function RolesPage() {
  return (
    <PermissionGate
      permissions="roles:read"
      fallback={
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <LockIcon className="size-12 text-muted-foreground" />
          <p className="text-lg font-medium">Access Denied</p>
          <p className="text-muted-foreground">
            You do not have permission to view roles and permissions.
          </p>
          <Button variant="outline" asChild>
            <Link href="/settings">Back to Settings</Link>
          </Button>
        </div>
      }
    >
      <RolesContent />
    </PermissionGate>
  );
}

function RolesContent() {
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
          <h1 className="text-2xl font-bold">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage role definitions, view permission assignments, and configure access control
          </p>
        </div>
      </div>

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="matrix">Permission Matrix</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <RolesTab />
        </TabsContent>
        <TabsContent value="matrix" className="mt-4">
          <PermissionMatrixTab />
        </TabsContent>
        <TabsContent value="hierarchy" className="mt-4">
          <HierarchyTab />
        </TabsContent>
        <TabsContent value="constraints" className="mt-4">
          <ConstraintsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================================================================
// ROLES TAB
// ===========================================================================

function RolesTab() {
  const { data: roles, isLoading, error } = useRoles();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleDefinitionDto | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleDefinitionDto | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const systemRoles = useMemo(() => roles?.filter((r) => r.isSystem) ?? [], [roles]);
  const customRoles = useMemo(() => roles?.filter((r) => !r.isSystem) ?? [], [roles]);

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {roles && `${systemRoles.length} system roles, ${customRoles.length} custom roles`}
        </div>
        <PermissionGate permissions="roles:create">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <PlusIcon className="mr-1 size-4" />
            Create Custom Role
          </Button>
        </PermissionGate>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiClientError ? error.message : 'Failed to load roles'}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {/* System Roles */}
      {!isLoading && systemRoles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            System Roles
          </h3>
          {systemRoles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              isExpanded={expandedRole === role.id}
              onToggle={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
            />
          ))}
        </div>
      )}

      {/* Custom Roles */}
      {!isLoading && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Custom Roles
          </h3>
          {customRoles.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <ShieldIcon className="mb-3 size-8 text-muted-foreground" />
                <p className="text-sm font-medium">No custom roles</p>
                <p className="text-xs text-muted-foreground">
                  Create custom roles to fine-tune permissions for your organization.
                </p>
              </CardContent>
            </Card>
          )}
          {customRoles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              isExpanded={expandedRole === role.id}
              onToggle={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
              onEdit={() => setEditRole(role)}
              onDelete={() => setDeleteRole(role)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      {createDialogOpen && (
        <CreateEditRoleDialog
          mode="create"
          onClose={() => setCreateDialogOpen(false)}
        />
      )}

      {/* Edit Dialog */}
      {editRole && (
        <CreateEditRoleDialog
          mode="edit"
          role={editRole}
          onClose={() => setEditRole(null)}
        />
      )}

      {/* Delete Confirm */}
      {deleteRole && (
        <DeleteRoleDialog
          role={deleteRole}
          onClose={() => setDeleteRole(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role Card
// ---------------------------------------------------------------------------

function RoleCard({
  role,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  role: RoleDefinitionDto;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const directPerms = role.permissions ?? [];
  const inheritedPerms = role.inheritedPermissions ?? [];
  const totalPerms = directPerms.length + inheritedPerms.length;

  // Group direct permissions by category
  const directByCategory = useMemo(() => {
    const groups: Record<string, PermissionDef[]> = {};
    for (const p of directPerms) {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(p);
    }
    return groups;
  }, [directPerms]);

  const inheritedByCategory = useMemo(() => {
    const groups: Record<string, PermissionDef[]> = {};
    for (const p of inheritedPerms) {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(p);
    }
    return groups;
  }, [inheritedPerms]);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardContent className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            {isExpanded ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            )}

            <Badge className={`text-xs shrink-0 ${getRoleBadgeClass(role.slug)}`}>
              {role.name}
            </Badge>

            {role.isSystem && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                <LockIcon className="mr-1 size-2.5" />
                System
              </Badge>
            )}

            <span className="flex-1 text-sm text-muted-foreground truncate">
              {role.description ?? 'No description'}
            </span>

            <div className="flex items-center gap-3 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground">
                    {totalPerms} perm{totalPerms !== 1 ? 's' : ''}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {directPerms.length} direct, {inheritedPerms.length} inherited
                </TooltipContent>
              </Tooltip>

              {role.memberCount !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {role.memberCount} member{role.memberCount !== 1 ? 's' : ''}
                </span>
              )}

              {role.requiresMfa && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ShieldCheckIcon className="size-4 text-amber-600" />
                  </TooltipTrigger>
                  <TooltipContent>MFA required</TooltipContent>
                </Tooltip>
              )}

              {!role.isSystem && (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <PermissionGate permissions="roles:update">
                    <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
                      <PencilIcon className="size-3.5" />
                    </Button>
                  </PermissionGate>
                  <PermissionGate permissions="roles:delete">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={onDelete}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </PermissionGate>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator />
          <CardContent className="p-4 space-y-4">
            {/* Role info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Slug:</span>{' '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{role.slug}</code>
              </div>
              {role.maxPerOrg && (
                <div>
                  <span className="text-muted-foreground">Max per org:</span> {role.maxPerOrg}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">MFA required:</span>{' '}
                {role.requiresMfa ? 'Yes' : 'No'}
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{' '}
                {role.isSystem ? 'System (immutable)' : 'Custom'}
              </div>
            </div>

            <Separator />

            {/* Direct permissions */}
            {directPerms.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Direct Permissions ({directPerms.length})
                </h4>
                <div className="space-y-2">
                  {Object.entries(directByCategory)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, perms]) => (
                      <div key={category}>
                        <p className="text-xs font-medium text-muted-foreground capitalize mb-1">
                          {category}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {perms.map((p) => (
                            <Tooltip key={p.id}>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="text-[10px]">
                                  {p.code}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>{p.description ?? p.code}</TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Inherited permissions */}
            {inheritedPerms.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Inherited Permissions ({inheritedPerms.length})
                </h4>
                <div className="space-y-2">
                  {Object.entries(inheritedByCategory)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, perms]) => (
                      <div key={category}>
                        <p className="text-xs font-medium text-muted-foreground capitalize mb-1">
                          {category}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {perms.map((p) => (
                            <Tooltip key={p.id}>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] opacity-70">
                                  {p.code}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {p.description ?? p.code} (inherited)
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {totalPerms === 0 && (
              <p className="text-sm text-muted-foreground italic">No permissions assigned</p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Role Dialog
// ---------------------------------------------------------------------------

function CreateEditRoleDialog({
  mode,
  role,
  onClose,
}: {
  mode: 'create' | 'edit';
  role?: RoleDefinitionDto;
  onClose: () => void;
}) {
  const { data: allPermissions, isLoading: permsLoading } = usePermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const [name, setName] = useState(role?.name ?? '');
  const [slug, setSlug] = useState(role?.slug ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [requiresMfa, setRequiresMfa] = useState(role?.requiresMfa ?? false);
  const [maxPerOrg, setMaxPerOrg] = useState(role?.maxPerOrg?.toString() ?? '');
  const [selectedPermIds, setSelectedPermIds] = useState<Set<string>>(
    new Set(role?.permissions?.map((p) => p.id) ?? []),
  );
  const [error, setError] = useState('');

  // Auto-generate slug from name (only in create mode)
  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (mode === 'create') {
        setSlug(
          value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        );
      }
    },
    [mode],
  );

  // Group permissions by category
  const permsByCategory = useMemo(() => {
    if (!allPermissions) return {} as Record<string, PermissionDef[]>;
    const groups: Record<string, PermissionDef[]> = {};
    for (const p of allPermissions) {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(p);
    }
    return groups;
  }, [allPermissions]);

  const togglePermission = useCallback((id: string) => {
    setSelectedPermIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCategory = useCallback(
    (category: string) => {
      const categoryPerms = permsByCategory[category] ?? [];
      const allSelected = categoryPerms.every((p) => selectedPermIds.has(p.id));
      setSelectedPermIds((prev) => {
        const next = new Set(prev);
        for (const p of categoryPerms) {
          if (allSelected) next.delete(p.id);
          else next.add(p.id);
        }
        return next;
      });
    },
    [permsByCategory, selectedPermIds],
  );

  const handleSubmit = useCallback(async () => {
    try {
      setError('');
      const permissionIds = Array.from(selectedPermIds);

      if (!name.trim()) {
        setError('Role name is required');
        return;
      }
      if (!slug.trim()) {
        setError('Slug is required');
        return;
      }
      if (permissionIds.length === 0) {
        setError('Select at least one permission');
        return;
      }

      if (mode === 'create') {
        await createRole.mutateAsync({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          permissionIds,
          requiresMfa: requiresMfa || undefined,
          maxPerOrg: maxPerOrg ? parseInt(maxPerOrg, 10) : undefined,
        });
      } else if (role) {
        await updateRole.mutateAsync({
          id: role.id,
          name: name.trim(),
          description: description.trim() || undefined,
          permissionIds,
          requiresMfa: requiresMfa || undefined,
          maxPerOrg: maxPerOrg ? parseInt(maxPerOrg, 10) : undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to save role');
    }
  }, [mode, name, slug, description, requiresMfa, maxPerOrg, selectedPermIds, role, createRole, updateRole, onClose]);

  const isPending = createRole.isPending || updateRole.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldIcon className="size-5" />
            {mode === 'create' ? 'Create Custom Role' : `Edit Role: ${role?.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Senior Paralegal"
              maxLength={100}
            />
          </div>

          {/* Slug (read-only in edit) */}
          <div className="space-y-2">
            <Label htmlFor="role-slug">Slug</Label>
            <Input
              id="role-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="senior-paralegal"
              maxLength={50}
              disabled={mode === 'edit'}
              className={mode === 'edit' ? 'bg-muted' : ''}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase alphanumeric with hyphens. Cannot be changed after creation.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="role-desc">Description (optional)</Label>
            <Input
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Can manage digests and review documents"
              maxLength={500}
            />
          </div>

          {/* Options row */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="role-mfa"
                checked={requiresMfa}
                onCheckedChange={setRequiresMfa}
              />
              <Label htmlFor="role-mfa" className="text-sm">
                Require MFA
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="role-max" className="text-sm whitespace-nowrap">
                Max per org
              </Label>
              <Input
                id="role-max"
                type="number"
                value={maxPerOrg}
                onChange={(e) => setMaxPerOrg(e.target.value)}
                placeholder="Unlimited"
                className="w-24"
                min={1}
              />
            </div>
          </div>

          <Separator />

          {/* Permission selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                Permissions ({selectedPermIds.size} selected)
              </h3>
            </div>

            {permsLoading && <Skeleton className="h-40 w-full" />}

            {!permsLoading && allPermissions && (
              <ScrollArea className="max-h-[340px]">
                <div className="space-y-4">
                  {Object.entries(permsByCategory)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, perms]) => {
                      const allSelected = perms.every((p) => selectedPermIds.has(p.id));
                      const someSelected = perms.some((p) => selectedPermIds.has(p.id));

                      return (
                        <div key={category} className="space-y-1">
                          <div
                            className="flex items-center gap-2 cursor-pointer py-1"
                            onClick={() => toggleCategory(category)}
                          >
                            <Checkbox
                              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                              onCheckedChange={() => toggleCategory(category)}
                            />
                            <span className="text-sm font-medium capitalize">{category}</span>
                            <span className="text-xs text-muted-foreground">
                              ({perms.filter((p) => selectedPermIds.has(p.id)).length}/{perms.length})
                            </span>
                          </div>
                          <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1">
                            {perms.map((p) => (
                              <label
                                key={p.id}
                                className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
                              >
                                <Checkbox
                                  checked={selectedPermIds.has(p.id)}
                                  onCheckedChange={() => togglePermission(p.id)}
                                  className="mt-0.5"
                                />
                                <div>
                                  <p className="text-xs font-medium">{p.code}</p>
                                  {p.description && (
                                    <p className="text-[10px] text-muted-foreground leading-tight">
                                      {p.description}
                                    </p>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2Icon className="mr-1 size-4 animate-spin" />}
              {mode === 'create' ? 'Create Role' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete Role Dialog
// ---------------------------------------------------------------------------

function DeleteRoleDialog({
  role,
  onClose,
}: {
  role: RoleDefinitionDto;
  onClose: () => void;
}) {
  const deleteRole = useDeleteRole();
  const [error, setError] = useState('');

  const handleDelete = useCallback(async () => {
    try {
      setError('');
      await deleteRole.mutateAsync(role.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to delete role');
    }
  }, [role.id, deleteRole, onClose]);

  return (
    <AlertDialog open onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-destructive" />
            Delete Role
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the role <strong>{role.name}</strong>? This action
            cannot be undone. Members currently holding this role will lose its permissions.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteRole.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteRole.isPending && <Loader2Icon className="mr-1 size-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===========================================================================
// PERMISSION MATRIX TAB
// ===========================================================================

function PermissionMatrixTab() {
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const { data: permissions, isLoading: permsLoading } = usePermissions();

  const isLoading = rolesLoading || permsLoading;

  // Group permissions by category
  const permsByCategory = useMemo(() => {
    if (!permissions) return {} as Record<string, PermissionDef[]>;
    const groups: Record<string, PermissionDef[]> = {};
    for (const p of permissions) {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(p);
    }
    return groups;
  }, [permissions]);

  // Build lookup: roleId -> Set<permissionCode>
  const rolePermLookup = useMemo(() => {
    if (!roles) return new Map<string, Set<string>>();
    const lookup = new Map<string, Set<string>>();
    for (const role of roles) {
      const codes = new Set<string>();
      for (const p of role.permissions ?? []) codes.add(p.code);
      lookup.set(role.id, codes);
    }
    return lookup;
  }, [roles]);

  // Build inherited lookup
  const roleInheritedLookup = useMemo(() => {
    if (!roles) return new Map<string, Set<string>>();
    const lookup = new Map<string, Set<string>>();
    for (const role of roles) {
      const codes = new Set<string>();
      for (const p of role.inheritedPermissions ?? []) codes.add(p.code);
      lookup.set(role.id, codes);
    }
    return lookup;
  }, [roles]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!roles || !permissions) return null;

  const sortedCategories = Object.entries(permsByCategory).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CheckIcon className="size-3.5 text-green-600" />
          Direct
        </div>
        <div className="flex items-center gap-1.5">
          <ChevronsRightIcon className="size-3.5 text-blue-500" />
          Inherited
        </div>
        <div className="flex items-center gap-1.5">
          <MinusIcon className="size-3.5 text-muted-foreground" />
          Not assigned
        </div>
      </div>

      <Card>
        <ScrollArea className="w-full">
          <div className="min-w-[800px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px] sticky left-0 bg-background z-10">
                    Permission
                  </TableHead>
                  {roles.map((role) => (
                    <TableHead
                      key={role.id}
                      className="text-center min-w-[80px] text-xs"
                    >
                      <Badge className={`text-[10px] ${getRoleBadgeClass(role.slug)}`}>
                        {role.name}
                      </Badge>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCategories.map(([category, perms]) => (
                  <>
                    {/* Category header row */}
                    <TableRow key={`cat-${category}`} className="bg-muted/50">
                      <TableCell
                        colSpan={roles.length + 1}
                        className="py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0"
                      >
                        {category}
                      </TableCell>
                    </TableRow>
                    {perms.map((perm) => (
                      <TableRow key={perm.id}>
                        <TableCell className="text-xs sticky left-0 bg-background z-10">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">{perm.code}</span>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {perm.description ?? perm.code}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        {roles.map((role) => {
                          const direct = rolePermLookup.get(role.id)?.has(perm.code) ?? false;
                          const inherited = roleInheritedLookup.get(role.id)?.has(perm.code) ?? false;

                          return (
                            <TableCell key={role.id} className="text-center">
                              {direct ? (
                                <CheckIcon className="size-4 text-green-600 mx-auto" />
                              ) : inherited ? (
                                <ChevronsRightIcon className="size-4 text-blue-500 mx-auto" />
                              ) : (
                                <MinusIcon className="size-3.5 text-muted-foreground/30 mx-auto" />
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

// ===========================================================================
// HIERARCHY TAB
// ===========================================================================

function HierarchyTab() {
  const { data: hierarchy, isLoading, error } = useRoleHierarchy();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load hierarchy</AlertDescription>
      </Alert>
    );
  }

  if (!hierarchy) return null;

  const { tree, edges } = hierarchy;

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>
          Parent roles inherit all permissions from their child roles. The hierarchy flows
          top-down: a parent role gets all permissions of its descendants.
        </AlertDescription>
      </Alert>

      {/* Tree visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Hierarchy Tree</CardTitle>
        </CardHeader>
        <CardContent>
          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No hierarchy defined. All roles are independent.
            </p>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => (
                <HierarchyNode key={node.id} node={node} depth={0} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edges table */}
      {edges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hierarchy Edges ({edges.length})</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parent Role</TableHead>
                <TableHead className="text-center">Inherits From</TableHead>
                <TableHead>Child Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.map((edge) => (
                <TableRow key={edge.id}>
                  <TableCell>
                    <Badge className={`text-xs ${getRoleBadgeClass(edge.parentRoleName.toLowerCase())}`}>
                      {edge.parentRoleName}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <ChevronsRightIcon className="size-4 text-muted-foreground mx-auto" />
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${getRoleBadgeClass(edge.childRoleName.toLowerCase())}`}>
                      {edge.childRoleName}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function HierarchyNode({ node, depth }: { node: RoleHierarchyNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 hover:bg-muted/50 rounded-md px-2 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <Badge className={`text-xs ${getRoleBadgeClass(node.roleSlug)}`}>
          {node.roleName}
        </Badge>

        {hasChildren && (
          <span className="text-xs text-muted-foreground">
            ({node.children.length} child{node.children.length !== 1 ? 'ren' : ''})
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <HierarchyNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// CONSTRAINTS TAB
// ===========================================================================

function ConstraintsTab() {
  const { data: constraints, isLoading, error } = useConstraints();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load constraints</AlertDescription>
      </Alert>
    );
  }

  const mutualExclusion = constraints?.filter((c) => c.constraintType === 'mutually_exclusive') ?? [];
  const prerequisite = constraints?.filter((c) => c.constraintType === 'prerequisite') ?? [];
  const cardinality = constraints?.filter((c) => c.constraintType === 'cardinality') ?? [];

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>
          Constraints enforce separation of duties (SoD) and other access control policies.
          They are checked at role assignment time and prevent conflicting role combinations.
        </AlertDescription>
      </Alert>

      {/* Mutual Exclusion (SoD) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <XIcon className="size-4 text-red-500" />
            Separation of Duties ({mutualExclusion.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mutualExclusion.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No mutual exclusion constraints defined.
            </p>
          ) : (
            <div className="space-y-3">
              {mutualExclusion.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-3"
                >
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleASlug)}`}>
                    {c.roleAName}
                  </Badge>
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    cannot coexist with
                  </span>
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleBSlug)}`}>
                    {c.roleBName}
                  </Badge>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                A member cannot hold both roles simultaneously. Assigning one when the other
                is already held will be rejected.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prerequisite */}
      {prerequisite.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ChevronsRightIcon className="size-4 text-blue-500" />
              Prerequisites ({prerequisite.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {prerequisite.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3"
                >
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleASlug)}`}>
                    {c.roleAName}
                  </Badge>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    requires
                  </span>
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleBSlug)}`}>
                    {c.roleBName}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cardinality */}
      {cardinality.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UnlockIcon className="size-4 text-amber-500" />
              Cardinality ({cardinality.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {cardinality.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3"
                >
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleASlug)}`}>
                    {c.roleAName}
                  </Badge>
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    limited by
                  </span>
                  <Badge className={`text-xs ${getRoleBadgeClass(c.roleBSlug)}`}>
                    {c.roleBName}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {constraints && constraints.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <ShieldCheckIcon className="mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No constraints defined</p>
            <p className="text-xs text-muted-foreground">
              Constraints are configured at the system level to enforce access control policies.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
