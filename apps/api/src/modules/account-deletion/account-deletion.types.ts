/** BullMQ queue that purges a deleted user's private content. */
export const ACCOUNT_PURGE_QUEUE = 'account-purge';

/** Job name on {@link ACCOUNT_PURGE_QUEUE}. */
export const PURGE_USER_CONTENT_JOB = 'purge-user-content';

/**
 * Payload for a private-content purge.
 *
 * Carries only IDs: the job runs long after the request that scheduled it, and
 * re-reads everything it needs. `organizationIds` is the set of solo orgs that
 * were marked for deletion alongside the user — orgs with other members are
 * never in this list (the request is refused with 409 before it gets that far).
 */
export interface PurgeUserContentJobData {
  userId: string;
  organizationIds: string[];
}

/** Account statuses used by the deletion flow. */
export const USER_STATUS_ACTIVE = 'active';
export const USER_STATUS_PENDING_DELETION = 'pending_deletion';
export const USER_STATUS_DELETED = 'deleted';

/**
 * Restore window, in days, published at /account-deletion. The account is
 * deactivated immediately; the row is anonymized and purged only after this
 * many days have passed since `deletionRequestedAt`.
 */
export const DELETION_RESTORE_WINDOW_DAYS = 30;

/** Domain used for the anonymized email placeholder. */
export const ANONYMIZED_EMAIL_DOMAIN = 'deleted.libertasian.com';

/** Display name left on an anonymized row. */
export const ANONYMIZED_FULL_NAME = 'Deleted User';
