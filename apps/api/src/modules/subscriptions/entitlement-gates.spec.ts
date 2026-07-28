import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard, SUBSCRIPTION_KEY } from '../../common/guards/subscription.guard';
import { AuditController } from '../audit/audit.controller';
import { OrganizationsController } from '../organizations/organizations.controller';
import { StudyController } from '../study/study.controller';

/**
 * `@RequiredSubscription(tier)` is INERT unless SubscriptionGuard is in the
 * same route's guard chain — the decorator only writes metadata, the guard is
 * what reads it. Several routes carried one without the other, so a free JWT
 * got 200 on study progress, bar readiness and audit logs in production
 * (measured 2026-07-28).
 *
 * These specs pin BOTH halves of every gate. Dropping the guard from a
 * `@UseGuards` array is the silent failure mode this file exists to catch.
 */

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
}

function tierOf(target: object): unknown {
  return Reflect.getMetadata(SUBSCRIPTION_KEY, target);
}

describe('StudyController — edu tier gates', () => {
  // `flashcardGeneration` and `studyProgressTracking` exist only on the edu
  // plan row, so these must be TIER gates (free < edu) and never boolean
  // entitlement checks — a truthiness check would 403 Pro/Team/Enterprise.
  const GATED_HANDLERS: Array<[string, (...args: never[]) => unknown]> = [
    ['generateAiFlashcards', StudyController.prototype.generateAiFlashcards],
    ['getSyllabusProgress', StudyController.prototype.getSyllabusProgress],
    [
      'upsertSyllabusTopicProgress',
      StudyController.prototype.upsertSyllabusTopicProgress,
    ],
    ['getBarExamReadiness', StudyController.prototype.getBarExamReadiness],
    ['upsertProgress', StudyController.prototype.upsertProgress],
  ];

  it.each(GATED_HANDLERS)(
    '%s declares JwtAuthGuard + SubscriptionGuard and requires edu',
    (_name, handler) => {
      expect(guardsOf(handler)).toEqual([JwtAuthGuard, SubscriptionGuard]);
      expect(tierOf(handler)).toBe('edu');
    },
  );

  it('leaves the codal reader anonymous — it backs the public/SEO funnel', () => {
    for (const handler of [
      StudyController.prototype.listBarSubjects,
      StudyController.prototype.listCodalsBySubject,
    ]) {
      expect(guardsOf(handler)).toEqual([]);
      expect(tierOf(handler)).toBeUndefined();
    }
  });

  it('leaves the other study routes ungated', () => {
    // Reads that a free user must keep: their own progress list, flashcard
    // CRUD, sessions, stats. Only the five gated handlers above changed.
    for (const handler of [
      StudyController.prototype.listProgress,
      StudyController.prototype.getProgress,
      StudyController.prototype.listFlashcardSets,
      StudyController.prototype.createFlashcardSet,
      StudyController.prototype.submitFlashcardReview,
      StudyController.prototype.getStudyStats,
      StudyController.prototype.listSyllabi,
    ]) {
      expect(tierOf(handler)).toBeUndefined();
    }
  });

  it('carries no class-level tier gate', () => {
    expect(tierOf(StudyController)).toBeUndefined();
  });
});

describe('AuditController — team tier gate', () => {
  it('keeps SubscriptionGuard in the class guard chain', () => {
    expect(guardsOf(AuditController)).toEqual([
      JwtAuthGuard,
      MfaGuard,
      TenantGuard,
      PermissionsGuard,
      SubscriptionGuard,
    ]);
  });

  it('requires the team tier for every audit-log route', () => {
    // `auditLogs` is false on free/edu/pro in plan-seed.
    expect(tierOf(AuditController)).toBe('team');
  });

  it('applies to the handlers via class-level metadata', () => {
    // Reflector.getAllAndOverride falls back to the class, so no handler
    // needs its own decorator — but none may override it downward either.
    for (const handler of [
      AuditController.prototype.listAuditLogs,
      AuditController.prototype.exportCsv,
      AuditController.prototype.listEntityTypes,
      AuditController.prototype.listActions,
    ]) {
      expect(tierOf(handler)).toBeUndefined();
    }
  });
});

describe('OrganizationsController — team tier gate on invites only', () => {
  it('gates POST :id/members/invite behind SubscriptionGuard + team', () => {
    const handler = OrganizationsController.prototype.inviteMember;
    expect(guardsOf(handler)).toEqual([SubscriptionGuard]);
    expect(tierOf(handler)).toBe('team');
  });

  it('keeps the class-level JwtAuthGuard (runs first)', () => {
    expect(guardsOf(OrganizationsController)).toEqual([JwtAuthGuard]);
    expect(tierOf(OrganizationsController)).toBeUndefined();
  });

  it('does NOT gate listing, role changes or removal', () => {
    // Existing members must never lose access when a plan lapses — only
    // adding a seat is the `teamCollaboration` entitlement.
    for (const handler of [
      OrganizationsController.prototype.listMembers,
      OrganizationsController.prototype.listPendingInvites,
      OrganizationsController.prototype.updateMemberRole,
      OrganizationsController.prototype.removeMember,
      OrganizationsController.prototype.findById,
      OrganizationsController.prototype.create,
      OrganizationsController.prototype.update,
    ]) {
      expect(tierOf(handler)).toBeUndefined();
      expect(guardsOf(handler)).toEqual([]);
    }
  });
});
