'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BellIcon,
  CreditCardIcon,
  KeyIcon,
  KeyRoundIcon,
  UserPlusIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  LogOutIcon,
  UsersIcon,
  LockIcon,
  ScrollTextIcon,
  BarChart3Icon,
} from 'lucide-react';

import {
  useProfile,
  useUpdateProfile,
  useMyOrganizations,
  useOrganizationMembers,
  useInviteMember,
  useRemoveMember,
  useEnrollMfa,
  useConfirmMfa,
  useDisableMfa,
  useChangePassword,
  useSessions,
  useRevokeSession,
  useRevokeAllSessions,
} from '@/features/settings/hooks/use-settings';
import { useHasPermission } from '@/features/settings/hooks/use-rbac';
import {
  useEmailPreferences,
  useUpdateEmailPreferences,
} from '@/features/settings/hooks/use-email-preferences';
import { ApiClientError } from '@/lib/api-client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function SettingsPage() {
  const { hasPermission: canViewMembers } = useHasPermission('members:read');
  const { hasPermission: canViewRoles } = useHasPermission('roles:read');
  const { hasPermission: canViewAuditLogs } = useHasPermission('audit-logs:read');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account, organization, and security</p>
      </div>

      {/* Quick Links */}
      <div className="space-y-2">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CreditCardIcon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Billing &amp; Subscription</p>
              <p className="text-xs text-muted-foreground">Manage your plan, payment methods, and invoices</p>
            </div>
            <Button asChild size="sm">
              <Link href="/settings/billing">Manage</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BarChart3Icon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Usage &amp; Quotas</p>
              <p className="text-xs text-muted-foreground">View your usage limits, quotas, and active bonuses</p>
            </div>
            <Button asChild size="sm">
              <Link href="/settings/usage">View</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <KeyRoundIcon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">API Keys</p>
              <p className="text-xs text-muted-foreground">Manage API keys for external integrations (Enterprise)</p>
            </div>
            <Button asChild size="sm">
              <Link href="/settings/api-keys">Manage</Link>
            </Button>
          </CardContent>
        </Card>

        {canViewMembers && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Members &amp; Roles</p>
                <p className="text-xs text-muted-foreground">Manage organization members and their RBAC role assignments</p>
              </div>
              <Button asChild size="sm">
                <Link href="/settings/members">Manage</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {canViewRoles && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <LockIcon className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Roles &amp; Permissions</p>
                <p className="text-xs text-muted-foreground">View role definitions, permission matrix, hierarchy, and constraints</p>
              </div>
              <Button asChild size="sm">
                <Link href="/settings/roles">Manage</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {canViewAuditLogs && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ScrollTextIcon className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Audit Logs</p>
                <p className="text-xs text-muted-foreground">View organization activity logs with filtering and CSV export</p>
              </div>
              <Button asChild size="sm">
                <Link href="/settings/audit-logs">View</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="organization">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Account Tab ----

const profileSchema = z.object({
  fullName: z.string().min(1, 'Name is required').max(255),
  phone: z.string().max(50).optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

function AccountTab() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    setError,
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    values: profile ? { fullName: profile.fullName, phone: profile.phone ?? '' } : undefined,
  });

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setSuccessMsg('');
      const updated = await updateProfile.mutateAsync({
        fullName: data.fullName,
        phone: data.phone || undefined,
      });
      reset({ fullName: updated.fullName, phone: updated.phone ?? '' });
      setSuccessMsg('Profile updated successfully.');
    } catch (error) {
      if (error instanceof ApiClientError) {
        setError('root', { message: error.message });
      } else {
        setError('root', { message: 'Failed to update profile' });
      }
    }
  };

  if (isLoading) {
    return <AccountSkeleton />;
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Account Information</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}
          {successMsg && (
            <Alert>
              <AlertDescription>{successMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={profile?.email ?? ''}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              {profile?.emailVerified ? 'Verified' : 'Not verified \u2014 check your inbox'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              type="text"
              {...register('fullName')}
            />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              type="tel"
              {...register('phone')}
              placeholder="+63 912 345 6789"
            />
          </div>

          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
        </form>

        <Separator className="my-4" />
        <p className="text-xs text-muted-foreground">
          Member since {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '\u2014'}
        </p>
      </CardContent>
    </Card>
  );
}

// ---- Organization Tab ----

const inviteSchema = z.object({
  email: z.string().email('Invalid email'),
  role: z.string().min(1, 'Role is required'),
});

type InviteFormData = z.infer<typeof inviteSchema>;

function OrganizationTab() {
  const { data: orgs, isLoading } = useMyOrganizations();
  const [selectedOrg, setSelectedOrg] = useState<string>('');

  const currentOrgId = selectedOrg || orgs?.[0]?.id || '';

  if (isLoading) return <OrganizationSkeleton />;

  if (!orgs || orgs.length === 0) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You are not a member of any organization.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold">Organization</h2>

      {orgs.length > 1 && (
        <Select value={currentOrgId} onValueChange={setSelectedOrg}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select organization" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name} ({org.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {currentOrgId && <OrgMembersPanel orgId={currentOrgId} />}
    </div>
  );
}

function OrgMembersPanel({ orgId }: { orgId: string }) {
  const { data, isLoading } = useOrganizationMembers(orgId);
  const inviteMember = useInviteMember(orgId);
  const removeMember = useRemoveMember(orgId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'member' },
  });

  const roleValue = watch('role');

  const onInvite = async (formData: InviteFormData) => {
    try {
      setInviteError('');
      setInviteSuccess('');
      await inviteMember.mutateAsync(formData);
      setInviteSuccess(`Invited ${formData.email} as ${formData.role}`);
      reset({ email: '', role: 'member' });
      setInviteOpen(false);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setInviteError(error.message);
      } else {
        setInviteError('Failed to invite member');
      }
    }
  };

  const members = data?.data ?? [];

  if (isLoading) return <OrganizationSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Members ({members.length})</h3>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlusIcon className="mr-1.5 h-3.5 w-3.5" />
              Invite member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onInvite)} className="space-y-4">
              {inviteError && (
                <Alert variant="destructive">
                  <AlertDescription>{inviteError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  {...register('email')}
                  placeholder="colleague@firm.com"
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={roleValue} onValueChange={(v) => setValue('role', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="reviewer">Reviewer</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Inviting...' : 'Send Invite'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {inviteSuccess && (
        <Alert>
          <AlertDescription>{inviteSuccess}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {member.user?.fullName ?? member.user?.email ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground">{member.user?.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="capitalize">
                    {member.role}
                  </Badge>
                  {member.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeMember.mutate(member.userId)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No members yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Security Tab ----

function SecurityTab() {
  return (
    <div className="max-w-lg space-y-8">
      <PasswordSection />
      <MfaSection />
      <SessionsSection />
    </div>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(10, 'Min 10 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ['newPassword'],
    message: 'New password must differ from current',
  });

type PasswordFormData = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const router = useRouter();
  const changePassword = useChangePassword();
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = async (data: PasswordFormData) => {
    try {
      setSuccessMsg('');
      await changePassword.mutateAsync({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      reset();
      setSuccessMsg('Password updated. Signing you out…');
      setTimeout(() => router.replace('/login'), 1200);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 401) {
          setError('currentPassword', { message: 'Current password is incorrect' });
        } else {
          setError('root', { message: error.message });
        }
      } else {
        setError('root', { message: 'Failed to change password' });
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyIcon className="h-5 w-5" />
          Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}
          {successMsg && (
            <Alert>
              <AlertDescription>{successMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              {...register('currentPassword')}
            />
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...register('newPassword')}
            />
            {errors.newPassword && (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MfaSection() {
  const { data: profile, isLoading } = useProfile();
  const enrollMfa = useEnrollMfa();
  const confirmMfa = useConfirmMfa();
  const disableMfa = useDisableMfa();

  const [enrollData, setEnrollData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (isLoading) return <MfaSkeleton />;

  const handleEnroll = async () => {
    try {
      setErrorMsg('');
      const result = await enrollMfa.mutateAsync();
      setEnrollData(result);
    } catch (error) {
      setErrorMsg(error instanceof ApiClientError ? error.message : 'Failed to start MFA enrollment');
    }
  };

  const handleConfirm = async () => {
    try {
      setErrorMsg('');
      await confirmMfa.mutateAsync(totpCode);
      setEnrollData(null);
      setTotpCode('');
      setSuccessMsg('MFA enabled successfully.');
    } catch (error) {
      setErrorMsg(error instanceof ApiClientError ? error.message : 'Invalid code');
    }
  };

  const handleDisable = async () => {
    try {
      setErrorMsg('');
      await disableMfa.mutateAsync(disablePassword);
      setShowDisable(false);
      setDisablePassword('');
      setSuccessMsg('MFA disabled.');
    } catch (error) {
      setErrorMsg(error instanceof ApiClientError ? error.message : 'Failed to disable MFA');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMsg && (
          <Alert variant="destructive">
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}
        {successMsg && (
          <Alert>
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        {profile?.mfaEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700">MFA is enabled on your account.</p>
            {showDisable ? (
              <Card className="bg-muted">
                <CardContent className="space-y-3 p-4">
                  <Label htmlFor="disable-pw">Confirm your password to disable MFA</Label>
                  <Input
                    id="disable-pw"
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDisable}
                      disabled={!disablePassword}
                    >
                      <ShieldOffIcon className="mr-1.5 h-3.5 w-3.5" />
                      Disable MFA
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowDisable(false); setDisablePassword(''); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowDisable(true)}>
                Disable MFA
              </Button>
            )}
          </div>
        ) : enrollData ? (
          <Card className="bg-muted">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your authenticator app, or enter the secret manually:
              </p>
              <code className="block break-all rounded bg-background px-3 py-2 text-xs">
                {enrollData.secret}
              </code>
              <p className="text-xs text-muted-foreground">
                OTP Auth URL: {enrollData.otpauthUrl}
              </p>
              <div className="space-y-2">
                <Label htmlFor="totp-code">Enter the 6-digit code from your app</Label>
                <div className="flex gap-2">
                  <Input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="w-32"
                    placeholder="123456"
                  />
                  <Button onClick={handleConfirm} disabled={totpCode.length !== 6}>
                    Verify
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Add an extra layer of security to your account with a TOTP authenticator app.
            </p>
            <Button onClick={handleEnroll}>
              <ShieldCheckIcon className="mr-1.5 h-4 w-4" />
              Enable MFA
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsSection() {
  const { data: sessions, isLoading } = useSessions();
  const revokeSession = useRevokeSession();
  const revokeAll = useRevokeAllSessions();

  if (isLoading) return <SessionsSkeleton />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active Sessions</CardTitle>
          {sessions && sessions.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => revokeAll.mutate()}
            >
              <LogOutIcon className="mr-1.5 h-3.5 w-3.5" />
              Revoke all
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {sessions?.map((session) => (
            <div key={session.familyId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm">{parseDeviceInfo(session.deviceFingerprint)}</p>
                <p className="text-xs text-muted-foreground">
                  Last active: {new Date(session.lastUsedAt).toLocaleString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => revokeSession.mutate(session.familyId)}
              >
                Revoke
              </Button>
            </div>
          ))}
          {(!sessions || sessions.length === 0) && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No active sessions</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Notifications Tab ----

function NotificationsTab() {
  const { data: prefs, isLoading } = useEmailPreferences();
  const updatePrefs = useUpdateEmailPreferences();
  const [successMsg, setSuccessMsg] = useState('');

  if (isLoading) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const handleToggle = async (key: 'subscriptionUpdates' | 'announcements' | 'blogNotifications', value: boolean) => {
    try {
      setSuccessMsg('');
      await updatePrefs.mutateAsync({ [key]: value });
      setSuccessMsg('Preferences updated.');
    } catch {
      // Error handled by TanStack Query
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="h-5 w-5" />
          Email Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {successMsg && (
          <Alert>
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Transactional</p>
              <p className="text-xs text-muted-foreground">
                Verification, password reset, and payment receipts
              </p>
            </div>
            <Switch checked disabled />
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            These emails cannot be disabled as they contain essential account information.
          </p>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Subscription Updates</p>
              <p className="text-xs text-muted-foreground">
                Plan changes, billing reminders, and subscription status
              </p>
            </div>
            <Switch
              checked={prefs?.subscriptionUpdates ?? true}
              onCheckedChange={(checked) => handleToggle('subscriptionUpdates', checked)}
              disabled={updatePrefs.isPending}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Announcements</p>
              <p className="text-xs text-muted-foreground">
                Product updates, new features, and important news
              </p>
            </div>
            <Switch
              checked={prefs?.announcements ?? true}
              onCheckedChange={(checked) => handleToggle('announcements', checked)}
              disabled={updatePrefs.isPending}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Blog Notifications</p>
              <p className="text-xs text-muted-foreground">
                New articles, legal updates, and content publications
              </p>
            </div>
            <Switch
              checked={prefs?.blogNotifications ?? true}
              onCheckedChange={(checked) => handleToggle('blogNotifications', checked)}
              disabled={updatePrefs.isPending}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Helpers ----

function parseDeviceInfo(fingerprint: string): string {
  const parts = fingerprint.split('|');
  const ua = parts[1] || 'Unknown device';
  if (ua.includes('Chrome')) return 'Chrome browser';
  if (ua.includes('Firefox')) return 'Firefox browser';
  if (ua.includes('Safari')) return 'Safari browser';
  if (ua.includes('Edge')) return 'Edge browser';
  return ua.substring(0, 60);
}

function AccountSkeleton() {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-28" />
      </CardContent>
    </Card>
  );
}

function OrganizationSkeleton() {
  return (
    <div className="max-w-2xl space-y-6">
      <Skeleton className="h-6 w-32" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-14" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MfaSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-56" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-28" />
      </CardContent>
    </Card>
  );
}

function SessionsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
