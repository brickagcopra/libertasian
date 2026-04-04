import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockEntries: unknown[] = [];
let mockIsLoading = false;
let mockError: Error | null = null;
let mockHasNext = false;

vi.mock('../hooks/use-activity', () => ({
  useActivity: () => ({
    data: { data: mockEntries, meta: { hasNext: mockHasNext } },
    isLoading: mockIsLoading,
    error: mockError,
  }),
}));

vi.mock('@/lib/constants', () => ({
  ROUTES: {
    WORKSPACE_MATTER: (id: string) => `/workspace/matters/${id}`,
    WORKSPACE_NOTE: (id: string) => `/workspace/notes/${id}`,
    WORKSPACE_TASK: (id: string) => `/workspace/tasks/${id}`,
  },
}));

import { ActivityFeed } from './activity-feed';

describe('ActivityFeed', () => {
  beforeEach(() => {
    mockEntries = [];
    mockIsLoading = false;
    mockError = null;
    mockHasNext = false;
  });

  it('shows loading skeletons when loading', () => {
    mockIsLoading = true;
    const { container } = render(<ActivityFeed />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows error message when there is an error', () => {
    mockError = new Error('Network error');
    render(<ActivityFeed />);
    expect(screen.getByText('Unable to load activity.')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    mockEntries = [];
    render(<ActivityFeed />);
    expect(screen.getByText('No recent activity.')).toBeInTheDocument();
  });

  it('renders activity entries', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'matter.create',
        entityType: 'matter',
        entityId: 'm1',
        actor: { fullName: 'Juan Cruz' },
        metadata: { title: 'Test Matter' },
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ActivityFeed />);
    expect(screen.getByText('Juan Cruz')).toBeInTheDocument();
    expect(screen.getByText('created a matter')).toBeInTheDocument();
    expect(screen.getByText('Test Matter')).toBeInTheDocument();
  });

  it('shows actor initial avatar', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'note.create',
        entityType: 'note',
        entityId: 'n1',
        actor: { fullName: 'Maria Santos' },
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ActivityFeed />);
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('falls back to System for missing actor', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'task.create',
        entityType: 'task',
        entityId: 't1',
        actor: null,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ActivityFeed />);
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('shows View all activity link when hasNext is true', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'task.update',
        entityType: 'task',
        entityId: 't1',
        actor: { fullName: 'User' },
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ];
    mockHasNext = true;
    render(<ActivityFeed />);
    expect(screen.getByText('View all activity')).toBeInTheDocument();
  });

  it('hides View all when showViewAll is false', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'task.update',
        entityType: 'task',
        entityId: 't1',
        actor: { fullName: 'User' },
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ];
    mockHasNext = true;
    render(<ActivityFeed showViewAll={false} />);
    expect(screen.queryByText('View all activity')).not.toBeInTheDocument();
  });

  it('renders entity title as link when route exists', () => {
    mockEntries = [
      {
        id: 'a1',
        action: 'matter.update',
        entityType: 'matter',
        entityId: 'm1',
        actor: { fullName: 'User' },
        metadata: { title: 'Linked Matter' },
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ActivityFeed />);
    const link = screen.getByText('Linked Matter');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/workspace/matters/m1',
    );
  });
});
