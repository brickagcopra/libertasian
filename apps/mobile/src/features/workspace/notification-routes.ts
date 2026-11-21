import type { Href } from 'expo-router';

/**
 * Maps a notification's entityType to its in-app route. Shared by the
 * notification center screen (row tap) and the push notification response
 * handler (system tray tap) so both deep-link identically.
 */
export const ENTITY_ROUTES: Record<string, (id: string) => Href> = {
  task: (id) => `/workspace/tasks/${id}`,
  matter: (id) => `/workspace/matters/${id}`,
  digest: (id) => `/digest/${id}`,
  // Moderation notices (removal, suspension, ban, appeal outcome). The id is
  // the recipient's own user id and is not needed by the screen.
  community_standing: () => '/settings/community-standing',
};
