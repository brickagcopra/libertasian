import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGrant = vi.fn();
const mockRevoke = vi.fn();
const mockInvite = vi.fn();
const mockCreateRole = vi.fn();

let mockHeld: string[] = [];
let mockStaff: unknown[] = [];
let mockRoles: unknown[] = [];

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

// PermissionGate reads useHasPermission; drive it from mockHeld so the tests
// can assert what each caller is offered.
vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useHasPermission: (permissions: string | string[], mode: 'all' | 'any' = 'all') => {
    const codes = Array.isArray(permissions) ? permissions : [permissions];
    const held = new Set(mockHeld);
    return {
      hasPermission:
        mode === 'all' ? codes.every((c) => held.has(c)) : codes.some((c) => held.has(c)),
      isLoading: false,
    };
  },
}));

vi.mock('@/features/settings/hooks/use-platform-staff', () => ({
  usePlatformStaff: () => ({
    data: { items: mockStaff, meta: { hasNext: false } },
    isLoading: false,
    error: null,
  }),
  usePlatformRoles: () => ({ data: mockRoles }),
  usePlatformPermissions: () => ({
    data: [
      { id: 'p-1', code: 'digests:review', category: 'digests' },
      { id: 'p-2', code: 'admin:users', category: 'admin' },
    ],
  }),
  usePlatformAuditLogs: () => ({
    data: {
      items: [
        {
          id: 'a-1',
          action: 'role.assigned',
          entityType: 'member_role',
          entityId: 'mr-1',
          actorUserId: 'u-super',
          metadataJson: { roleName: 'Reviewer' },
          createdAt: '2026-09-20T00:00:00.000Z',
        },
      ],
      meta: { hasNext: false },
    },
    isLoading: false,
  }),
  useGrantPlatformRole: () => ({ mutateAsync: mockGrant, isPending: false }),
  useRevokePlatformRole: () => ({ mutateAsync: mockRevoke, isPending: false }),
  useInvitePlatformMember: () => ({ mutateAsync: mockInvite, isPending: false }),
  useCreatePlatformRole: () => ({ mutateAsync: mockCreateRole, isPending: false }),
}));

import StaffAdministrationPage from './page';

/**
 * Staff Administration — where platform capability is granted.
 *
 * Two properties this page must have, and the reasons they matter:
 *  - No role names in the source. The grant picker is fed from
 *    GET /rbac/platform/roles at runtime, so a role created here is grantable
 *    immediately, with no deploy (P1).
 *  - The gates HIDE, they do not protect. Every action has a matching
 *    server-side guard on the platform org, and that guard is the control (P3).
 */
describe('StaffAdministrationPage', () => {
  beforeEach(() => {
    mockGrant.mockReset();
    mockRevoke.mockReset();
    mockInvite.mockReset();
    mockCreateRole.mockReset();
    mockHeld = ['members:read', 'members:invite', 'members:update-role', 'roles:create'];
    mockRoles = [
      { id: 'rd-reviewer', slug: 'reviewer', name: 'Reviewer', isSystem: true },
      { id: 'rd-editor', slug: 'editor', name: 'Editor', isSystem: true },
      // A role created in the panel: it must appear here with no deploy.
      { id: 'rd-custom', slug: 'bar-exam-editor', name: 'Bar Exam Editor', isSystem: false },
    ];
    mockStaff = [
      {
        id: 'm-1',
        userId: 'u-1',
        email: 'rey@libertasian.com',
        fullName: 'Rey Reviewer',
        roles: [
          {
            id: 'mr-1',
            roleDefinitionId: 'rd-reviewer',
            roleName: 'Reviewer',
            roleSlug: 'reviewer',
            isSystem: true,
            expiresAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        effectivePermissions: ['digests:review', 'digests:approve'],
      },
      {
        id: 'm-2',
        userId: 'u-2',
        email: 'nobody@libertasian.com',
        fullName: 'No Roles Nora',
        roles: [],
        effectivePermissions: [],
      },
    ];
  });

  it('lists platform staff with their roles', () => {
    render(<StaffAdministrationPage />);

    expect(screen.getByText('Rey Reviewer')).toBeInTheDocument();
    // "Reviewer" also appears in the audit trail below, so scope to the card.
    const card = screen.getByText('Rey Reviewer').closest('div.space-y-3')!;
    expect(within(card).getByText('Reviewer')).toBeInTheDocument();
  });

  it('says plainly when a member has no capability', () => {
    render(<StaffAdministrationPage />);

    expect(
      screen.getByText(/No roles — this member has no platform capability/),
    ).toBeInTheDocument();
  });

  it('shows EFFECTIVE permissions, not just role names', () => {
    // Role names hide that `admin` carries `reviewer`'s grants through the
    // hierarchy, and that an expired grant contributes nothing.
    render(<StaffAdministrationPage />);

    expect(screen.getByText('2 effective permissions')).toBeInTheDocument();
    expect(screen.getByText('digests:review')).toBeInTheDocument();
  });

  it('offers a role created in the panel, with no deploy', async () => {
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getAllByRole('button', { name: /grant role/i })[0]!);
    await userEvent.click(await screen.findByText('Choose a role'), {
      pointerEventsCheck: 0,
    });

    expect(await screen.findByText('Bar Exam Editor')).toBeInTheDocument();
  });

  it('does not offer a role the member already holds', async () => {
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getAllByRole('button', { name: /grant role/i })[0]!);
    await userEvent.click(await screen.findByText('Choose a role'), {
      pointerEventsCheck: 0,
    });

    const listbox = await screen.findByRole('listbox');
    // Rey already holds Reviewer; assignRole would 409.
    expect(within(listbox).queryByText('Reviewer')).not.toBeInTheDocument();
    expect(within(listbox).getByText('Editor')).toBeInTheDocument();
  });

  it('surfaces the server message when a grant fails', async () => {
    mockGrant.mockRejectedValue(new Error('Role already assigned to this member'));
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getAllByRole('button', { name: /grant role/i })[0]!);
    await userEvent.click(await screen.findByText('Choose a role'), {
      pointerEventsCheck: 0,
    });
    await userEvent.click(await screen.findByText('Editor'), { pointerEventsCheck: 0 });
    await userEvent.click(screen.getByRole('button', { name: /^grant role$/i }));

    expect(
      await screen.findByText('Role already assigned to this member'),
    ).toBeInTheDocument();
  });

  it('surfaces the server message when a revoke fails', async () => {
    mockRevoke.mockRejectedValue(
      new Error('Refusing to revoke your own grant-management role.'),
    );
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getByRole('button', { name: /revoke reviewer/i }));

    expect(await screen.findByText(/Refusing to revoke your own/)).toBeInTheDocument();
  });

  it('hides grant and invite controls from a read-only caller', () => {
    // members:read alone: can see the roster, cannot change it. The server
    // refuses regardless — this only stops offering a button that 403s.
    mockHeld = ['members:read'];
    render(<StaffAdministrationPage />);

    expect(screen.getByText('Rey Reviewer')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /invite to platform/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /grant role/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new role/i })).not.toBeInTheDocument();
  });

  it('hides role creation from a caller without roles:create', () => {
    mockHeld = ['members:read', 'members:update-role'];
    render(<StaffAdministrationPage />);

    expect(screen.getAllByRole('button', { name: /grant role/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /new role/i })).not.toBeInTheDocument();
  });

  it('sends a temporary grant as an ISO expiry', async () => {
    mockGrant.mockResolvedValue({});
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getAllByRole('button', { name: /grant role/i })[0]!);
    await userEvent.click(await screen.findByText('Choose a role'), {
      pointerEventsCheck: 0,
    });
    await userEvent.click(await screen.findByText('Editor'), { pointerEventsCheck: 0 });
    await userEvent.type(screen.getByLabelText(/expires/i), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: /^grant role$/i }));

    await waitFor(() => expect(mockGrant).toHaveBeenCalled());
    const call = mockGrant.mock.calls[0]![0];
    expect(call.memberId).toBe('m-1');
    expect(call.roleDefinitionId).toBe('rd-editor');
    // End of day, so a grant made "until the 31st" is not already expired on
    // the morning of the 31st.
    expect(call.expiresAt).toBe('2026-12-31T23:59:59.000Z');
  });

  it('sends no expiry for a permanent grant', async () => {
    mockGrant.mockResolvedValue({});
    render(<StaffAdministrationPage />);

    await userEvent.click(screen.getAllByRole('button', { name: /grant role/i })[0]!);
    await userEvent.click(await screen.findByText('Choose a role'), {
      pointerEventsCheck: 0,
    });
    await userEvent.click(await screen.findByText('Editor'), { pointerEventsCheck: 0 });
    await userEvent.click(screen.getByRole('button', { name: /^grant role$/i }));

    await waitFor(() => expect(mockGrant).toHaveBeenCalled());
    expect(mockGrant.mock.calls[0]![0]).not.toHaveProperty('expiresAt');
  });

  it('links changes to the RBAC audit trail', () => {
    render(<StaffAdministrationPage />);

    expect(screen.getByText('Recent grant activity')).toBeInTheDocument();
    expect(screen.getByText('role.assigned')).toBeInTheDocument();
  });
});
