/**
 * Maps a notification's entityType to its in-app route. Shared by the
 * notification center screen (row tap) and the push notification response
 * handler (system tray tap) so both deep-link identically.
 */
export const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  task: (id) => `/workspace/tasks/${id}`,
  matter: (id) => `/workspace/matters/${id}`,
  digest: (id) => `/digests/${id}`,
};
