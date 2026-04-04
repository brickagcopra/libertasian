import { describe, it, expect } from 'vitest';

import { APP_NAME, APP_DESCRIPTION, ROUTES } from './constants';

describe('APP constants', () => {
  it('has correct app name', () => {
    expect(APP_NAME).toBe('LIBERTASIAN');
  });

  it('has correct app description', () => {
    expect(APP_DESCRIPTION).toBe('Philippine Legal AI Platform');
  });
});

describe('ROUTES', () => {
  describe('auth routes', () => {
    it('has login route', () => {
      expect(ROUTES.LOGIN).toBe('/login');
    });

    it('has register route', () => {
      expect(ROUTES.REGISTER).toBe('/register');
    });

    it('has forgot password route', () => {
      expect(ROUTES.FORGOT_PASSWORD).toBe('/forgot-password');
    });

    it('has reset password route', () => {
      expect(ROUTES.RESET_PASSWORD).toBe('/reset-password');
    });

    it('has verify email route', () => {
      expect(ROUTES.VERIFY_EMAIL).toBe('/verify-email');
    });

    it('has onboarding route', () => {
      expect(ROUTES.ONBOARDING).toBe('/onboarding');
    });
  });

  describe('dashboard routes', () => {
    it('has search route', () => {
      expect(ROUTES.SEARCH).toBe('/search');
    });

    it('has digests route', () => {
      expect(ROUTES.DIGESTS).toBe('/digests');
    });

    it('has scans route', () => {
      expect(ROUTES.SCANS).toBe('/scans');
    });

    it('has workspace route', () => {
      expect(ROUTES.WORKSPACE).toBe('/workspace');
    });

    it('has settings route', () => {
      expect(ROUTES.SETTINGS).toBe('/settings');
    });
  });

  describe('parameterized route functions', () => {
    it('generates digest route with ID', () => {
      expect(ROUTES.DIGEST('dig-123')).toBe('/digests/dig-123');
    });

    it('generates scan route with ID', () => {
      expect(ROUTES.SCAN('scan-abc')).toBe('/scans/scan-abc');
    });

    it('generates reader route with ID', () => {
      expect(ROUTES.READER('doc-456')).toBe('/reader/doc-456');
    });

    it('generates workspace matter route with ID', () => {
      expect(ROUTES.WORKSPACE_MATTER('matter-789')).toBe('/workspace/matters/matter-789');
    });

    it('generates workspace note route with ID', () => {
      expect(ROUTES.WORKSPACE_NOTE('note-1')).toBe('/workspace/notes/note-1');
    });

    it('generates workspace task route with ID', () => {
      expect(ROUTES.WORKSPACE_TASK('task-1')).toBe('/workspace/tasks/task-1');
    });

    it('generates workspace memo route with ID', () => {
      expect(ROUTES.WORKSPACE_MEMO('memo-1')).toBe('/workspace/memos/memo-1');
    });

    it('generates study codal route with subject', () => {
      expect(ROUTES.STUDY_CODAL('civil_law')).toBe('/study/codals/civil_law');
    });

    it('generates study flashcard set route with ID', () => {
      expect(ROUTES.STUDY_FLASHCARD('fc-set-1')).toBe('/study/flashcards/fc-set-1');
    });

    it('generates study reviewer pack route with ID', () => {
      expect(ROUTES.STUDY_REVIEWER_PACK('pack-1')).toBe('/study/reviewer-packs/pack-1');
    });

    it('generates study syllabus subject route', () => {
      expect(ROUTES.STUDY_SYLLABUS_SUBJECT('criminal_law')).toBe('/study/syllabus/criminal_law');
    });

    it('generates admin source route with ID', () => {
      expect(ROUTES.ADMIN_SOURCE('src-1')).toBe('/admin/sources/src-1');
    });

    it('generates admin doctrine route with ID', () => {
      expect(ROUTES.ADMIN_DOCTRINE('doc-1')).toBe('/admin/doctrines/doc-1');
    });

    it('generates shared route with token', () => {
      expect(ROUTES.SHARED('share-token-abc')).toBe('/shared/share-token-abc');
    });
  });

  describe('study routes', () => {
    it('has study root', () => {
      expect(ROUTES.STUDY).toBe('/study');
    });

    it('has study codals route', () => {
      expect(ROUTES.STUDY_CODALS).toBe('/study/codals');
    });

    it('has study flashcards route', () => {
      expect(ROUTES.STUDY_FLASHCARDS).toBe('/study/flashcards');
    });

    it('has study reviewer packs route', () => {
      expect(ROUTES.STUDY_REVIEWER_PACKS).toBe('/study/reviewer-packs');
    });

    it('has study syllabus route', () => {
      expect(ROUTES.STUDY_SYLLABUS).toBe('/study/syllabus');
    });
  });

  describe('admin routes', () => {
    it('has admin root', () => {
      expect(ROUTES.ADMIN).toBe('/admin');
    });

    it('has admin sources route', () => {
      expect(ROUTES.ADMIN_SOURCES).toBe('/admin/sources');
    });

    it('has admin review queue route', () => {
      expect(ROUTES.ADMIN_REVIEW).toBe('/admin/review');
    });

    it('has admin flags route', () => {
      expect(ROUTES.ADMIN_FLAGS).toBe('/admin/flags');
    });

    it('has admin doctrines route', () => {
      expect(ROUTES.ADMIN_DOCTRINES).toBe('/admin/doctrines');
    });

    it('has admin knowledge graph route', () => {
      expect(ROUTES.ADMIN_KNOWLEDGE_GRAPH).toBe('/admin/knowledge-graph');
    });

    it('has admin health route', () => {
      expect(ROUTES.ADMIN_HEALTH).toBe('/admin/health');
    });

    it('has admin duplicates route', () => {
      expect(ROUTES.ADMIN_DUPLICATES).toBe('/admin/duplicates');
    });
  });

  describe('workspace routes', () => {
    it('has workspace matters route', () => {
      expect(ROUTES.WORKSPACE_MATTERS).toBe('/workspace/matters');
    });

    it('has workspace notes route', () => {
      expect(ROUTES.WORKSPACE_NOTES).toBe('/workspace/notes');
    });

    it('has workspace annotations route', () => {
      expect(ROUTES.WORKSPACE_ANNOTATIONS).toBe('/workspace/annotations');
    });

    it('has workspace tasks route', () => {
      expect(ROUTES.WORKSPACE_TASKS).toBe('/workspace/tasks');
    });

    it('has workspace calendar route', () => {
      expect(ROUTES.WORKSPACE_CALENDAR).toBe('/workspace/calendar');
    });

    it('has workspace activity route', () => {
      expect(ROUTES.WORKSPACE_ACTIVITY).toBe('/workspace/activity');
    });

    it('has workspace memos route', () => {
      expect(ROUTES.WORKSPACE_MEMOS).toBe('/workspace/memos');
    });
  });
});
