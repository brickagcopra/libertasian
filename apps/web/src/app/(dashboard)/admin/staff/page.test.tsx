import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PlatformGrant, PlatformRoleSummary } from '@libertasian/types';

// PermissionGate resolves through this hook. The page is gated on
// platform-*:manage; the SERVER is the real control (P4) — these tests are
// about what the panel shows and, above all, what it says when refused.
const hasPermission = vi.fn().mockReturnValue({ hasPermission: true, isLoading: false });
vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useHasPermission: (...args: unknown[]) => hasPermission(...args),
}));

const grantMutate = vi.fn();
const revokeMutate = vi.fn();
const staffQuery = vi.fn();
const rolesQuery = vi.fn();
const candidatesQuery = vi.fn();
const auditQuery = vi.fn();

vi.mock('@/features/settings/hooks/use-platform-staff', () => ({
  usePlatformStaff: () => staffQuery(),
  useStaffCandidates: (q: string) => candidatesQuery(q),
  usePlatformRoles: () => rolesQuery(),
  usePlatformRole: () => ({ data: undefined }),
  usePermissionCatalogue: () => ({
    data: {
      permissions: [],
      groups: [
        {
          category: 'digests',
          resources: [
            {
              resource: 'digests',
              permissions: [
                {
                  id: 'perm-review',
                  code: 'digests:review',
                  resource: 'digests',
                  action: 'review',
                  category: 'digests',
                  description: 'Review digests for quality',
                  isSystem: true,
                },
              ],
            },
          ],
        },
      ],
    },
    isLoading: false,
  }),
  useGrantPlatformRole: () => ({ mutateAsync: grantMutate, isPending: false }),
  useRevokePlatformRole: () => ({ mutateAsync: revokeMutate, isPending: false }),
  usePlatformStaffAudit: () => auditQuery(),
  useCreatePlatformRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePlatformRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePlatformRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  serverMessage: (error: unknown) =>
    error instanceof Error && error.message ? error.message : 'Request failed.',
}));

import PlatformStaffPage from './page';

function grant(overrides: Partial<PlatformGrant> = {}): PlatformGrant {
  return {
    id: 'grant-1',
    userId: 'u-reviewer',
    fullName: 'Rosa Reviewer',
    email: 'rosa@libertasian.com',
    roleDefinitionId: 'rd-reviewer',
    roleName: 'Reviewer',
    roleSlug: 'reviewer',
    isSystemRole: true,
    grantedByUserId: 'u-admin',
    grantedByName: 'Ana Admin',
    expiresAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    permissions: ['digests:read', 'digests:review'],
    ...overrides,
  };
}

function role(overrides: Partial<PlatformRoleSummary> = {}): PlatformRoleSummary {
  return {
    id: 'rd-reviewer',
    name: 'Reviewer',
    slug: 'reviewer',
    description: 'Digest and content reviewer',
    isSystem: true,
    requiresMfa: true,
    maxPerOrg: null,
    holderCount: 1,
    permissions: ['digests:read', 'digests:review'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue({ hasPermission: true, isLoading: false });
  staffQuery.mockReturnValue({
    data: { items: [grant()], meta: { hasNext: false, limit: 20 } },
    isLoading: false,
    error: null,
  });
  rolesQuery.mockReturnValue({ data: [role()], isLoading: false, error: null });
  candidatesQuery.mockReturnValue({ data: [], isFetching: false });
  auditQuery.mockReturnValue({
    data: { items: [], meta: { hasNext: false, limit: 25 } },
    isLoading: false,
    error: null,
  });
});

describe('Platform staff panel — the staff list', () => {
  it('shows who holds what, who granted it, and when it lapses', () => {
    staffQuery.mockReturnValue({
      data: {
        items: [
          grant({ expiresAt: '2099-01-01T00:00:00Z', grantedByName: 'Ana Admin' }),
        ],
        meta: { hasNext: false, limit: 20 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText('Rosa Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    expect(screen.getByText(/Granted by Ana Admin/)).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });

  it('attributes a bootstrap grant to the CLI rather than to nobody', () => {
    staffQuery.mockReturnValue({
      data: {
        items: [grant({ grantedByUserId: null, grantedByName: null })],
        meta: { hasNext: false, limit: 20 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText(/Granted by the bootstrap CLI/)).toBeInTheDocument();
  });

  it('expands to show the permissions a grant actually confers', async () => {
    const user = userEvent.setup();
    render(<PlatformStaffPage />);

    await user.click(screen.getByRole('button', { name: /2 permissions/ }));

    expect(
      await screen.findByText('Permissions this grants (hierarchy expanded)'),
    ).toBeInTheDocument();
    expect(screen.getByText('digests:review')).toBeInTheDocument();
  });

  it('flags a lapsed grant rather than hiding it', () => {
    staffQuery.mockReturnValue({
      data: {
        items: [grant({ expiresAt: '2020-01-01T00:00:00Z' })],
        meta: { hasNext: false, limit: 20 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('points at the bootstrap CLI when nobody holds anything yet', () => {
    staffQuery.mockReturnValue({
      data: { items: [], meta: { hasNext: false, limit: 20 } },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText(/Nobody holds a platform role yet/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm --filter api platform:grant/)).toBeInTheDocument();
  });
});

describe('Platform staff panel — refusals are shown verbatim', () => {
  it('renders the LAST-ADMIN refusal exactly as the server wrote it', async () => {
    const serverText =
      'Last-admin protection: revoking "Admin" from Ana Admin would leave nobody on the platform holding any admin:* permission, and no one could grant it back. Grant an admin-bearing role to someone else first.';
    revokeMutate.mockRejectedValue(new Error(serverText));
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('button', { name: /Revoke/ }));

    // The whole sentence, including the instruction — this is the message that
    // teaches the operator the rule.
    expect(await screen.findByText(serverText)).toBeInTheDocument();
  });

  it('renders the ESCALATION refusal and keeps the grant dialog open', async () => {
    const serverText =
      'Privilege escalation refused: "Admin" confers 6 permission(s) you do not hold — admin:billing, admin:users. You can only grant a role whose permissions are a subset of your own.';
    grantMutate.mockRejectedValue(new Error(serverText));
    candidatesQuery.mockReturnValue({
      data: [
        {
          userId: 'u-target',
          fullName: 'Tomas Target',
          email: 'tomas@libertasian.com',
          status: 'active',
        },
      ],
      isFetching: false,
    });
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('button', { name: /Grant a role/ }));

    await user.type(screen.getByLabelText('Find the person'), 'tomas');
    await user.click(await screen.findByText('Tomas Target'));
    await user.selectOptions(screen.getByLabelText('Role'), 'rd-reviewer');
    await user.click(screen.getByRole('button', { name: 'Grant role' }));

    expect(await screen.findByText(serverText)).toBeInTheDocument();
    // Still open, so the operator can act on what they were just told.
    expect(screen.getByRole('button', { name: 'Grant role' })).toBeInTheDocument();
  });

  it('says an unmatched search means "no account", not "we will invite them"', async () => {
    candidatesQuery.mockReturnValue({ data: [], isFetching: false });
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('button', { name: /Grant a role/ }));
    await user.type(screen.getByLabelText('Find the person'), 'nobody');

    expect(
      await screen.findByText(/must sign up before a role can be granted/),
    ).toBeInTheDocument();
  });
});

describe('Platform staff panel — roles are data', () => {
  it('lists roles from the API, with nothing hardcoded', async () => {
    rolesQuery.mockReturnValue({
      data: [
        role(),
        role({
          id: 'rd-custom',
          name: 'Corpus Boss',
          slug: 'corpus-boss',
          isSystem: false,
          holderCount: 0,
          permissions: ['corpus:update'],
        }),
      ],
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('tab', { name: 'Platform roles' }));

    // A role that exists only in the API response renders — no deploy needed.
    expect(await screen.findByText('Corpus Boss')).toBeInTheDocument();
    expect(screen.getByText('corpus-boss')).toBeInTheDocument();
  });

  it('renders a built-in role read-only, with Clone as the way to customise it', async () => {
    rolesQuery.mockReturnValue({
      data: [role({ isSystem: true })],
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('tab', { name: 'Platform roles' }));

    expect(await screen.findByText(/built-in — read-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clone/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('offers Edit and Delete on a custom platform role', async () => {
    rolesQuery.mockReturnValue({
      data: [role({ id: 'rd-custom', name: 'Corpus Boss', isSystem: false })],
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('tab', { name: 'Platform roles' }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('renders the permission picker from the catalogue, grouped by category', async () => {
    const user = userEvent.setup();

    render(<PlatformStaffPage />);
    await user.click(screen.getByRole('tab', { name: 'Platform roles' }));
    await user.click(screen.getByRole('button', { name: /New platform role/ }));

    // The category comes from GET /platform/permissions, not from a constant.
    const category = await screen.findByRole('button', { name: /digests/ });
    await user.click(category);
    expect(await screen.findByText('digests:review')).toBeInTheDocument();
  });
});

describe('Platform staff panel — gating', () => {
  it('explains that an organization role cannot confer platform capability', async () => {
    hasPermission.mockReturnValue({ hasPermission: false, isLoading: false });

    render(<PlatformStaffPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/an organization role cannot confer it/),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /Grant a role/ }),
    ).not.toBeInTheDocument();
  });

});

describe('Platform staff panel — audit trail', () => {
  it('shows the history in the panel, not as a link to the tenant audit log', () => {
    // /settings/audit-logs is tenant-scoped, plan-gated at Team and needs
    // audit-logs:read — which a platform-only admin may hold none of.
    render(<PlatformStaffPage />);

    expect(screen.getByText('Audit trail')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /audit log/i }),
    ).not.toBeInTheDocument();
  });

  it('shows grantor, target, role and expiry for a grant', () => {
    // Empty the staff list so the names asserted below can only come from the
    // audit trail.
    staffQuery.mockReturnValue({
      data: { items: [], meta: { hasNext: false, limit: 20 } },
      isLoading: false,
      error: null,
    });
    auditQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'audit-1',
            action: 'platform_grant.created',
            outcome: 'granted',
            actorUserId: 'u-admin',
            actorName: 'Ana Admin',
            actorEmail: 'a***@libertasian.com',
            targetUserId: 'u-rosa',
            targetName: 'Rosa Reviewer',
            targetEmail: 'r***@libertasian.com',
            roleSlug: 'reviewer',
            roleName: 'Reviewer',
            expiresAt: '2099-01-01T00:00:00Z',
            refusal: null,
            reason: null,
            createdAt: '2026-09-21T12:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 25 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText('granted')).toBeInTheDocument();
    expect(screen.getByText('Ana Admin')).toBeInTheDocument();
    expect(screen.getByText('Rosa Reviewer')).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });

  it('shows a BLOCKED escalation attempt, with the rule and the message', () => {
    const reason =
      'Privilege escalation refused: "Admin" confers 6 permission(s) you do not hold — admin:billing, admin:users.';
    auditQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'audit-2',
            action: 'platform_grant.refused',
            outcome: 'refused',
            actorUserId: 'u-clerk',
            actorName: 'Carl Clerk',
            actorEmail: 'c***@libertasian.com',
            targetUserId: 'u-target',
            targetName: 'Tomas Target',
            targetEmail: 't***@libertasian.com',
            roleSlug: 'admin',
            roleName: 'Admin',
            expiresAt: null,
            refusal: 'privilege_escalation',
            reason,
            createdAt: '2026-09-21T12:05:00Z',
          },
        ],
        meta: { hasNext: false, limit: 25 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText('refused')).toBeInTheDocument();
    expect(screen.getByText('privilege_escalation')).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('never renders a full email address', () => {
    auditQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'audit-3',
            action: 'platform_grant.created',
            outcome: 'granted',
            actorUserId: 'u-admin',
            actorName: null,
            actorEmail: 'a***@libertasian.com',
            targetUserId: 'u-rosa',
            targetName: null,
            targetEmail: 'r***@libertasian.com',
            roleSlug: 'reviewer',
            roleName: 'Reviewer',
            expiresAt: null,
            refusal: null,
            reason: null,
            createdAt: '2026-09-21T12:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 25 },
      },
      isLoading: false,
      error: null,
    });

    const { container } = render(<PlatformStaffPage />);

    expect(container.textContent).toContain('a***@libertasian.com');
    expect(container.textContent).not.toMatch(/ana@libertasian\.com/);
  });

  it('attributes a bootstrap entry with no actor to the CLI', () => {
    auditQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'audit-4',
            action: 'platform_grant.created',
            outcome: 'granted',
            actorUserId: null,
            actorName: null,
            actorEmail: null,
            targetUserId: 'u-root',
            targetName: 'Root Admin',
            targetEmail: 'r***@libertasian.com',
            roleSlug: 'admin',
            roleName: 'Admin',
            expiresAt: null,
            refusal: null,
            reason: null,
            createdAt: '2026-09-21T11:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 25 },
      },
      isLoading: false,
      error: null,
    });

    render(<PlatformStaffPage />);

    expect(screen.getByText('the bootstrap CLI')).toBeInTheDocument();
  });
});
