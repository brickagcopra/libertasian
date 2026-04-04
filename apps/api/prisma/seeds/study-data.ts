/**
 * Study Mode Seed Data — Flashcard sets, reviewer packs, study progress,
 * study sessions, study streaks, and flashcard reviews.
 *
 * Flashcard Sets (3):
 *   1. Criminal Law — Treachery & Self-Defense (student, 8 cards, auto_digest)
 *   2. Labor Law — Termination Due Process (editor, 9 cards, auto_document)
 *   3. Civil Law — Obligations Essentials (student, 8 cards, manual)
 *
 * Reviewer Packs (2):
 *   1. Criminal Law Bar Reviewer (editor, 5 items)
 *   2. Remedial Law — Motions (student, 4 items)
 *
 * Also seeds: study progress, study sessions, study streaks, flashcard reviews.
 */

import { PrismaClient } from '@prisma/client';
import { SeededUsers } from './dev-users';
import { SeededDocuments } from './legal-documents';
import { SeededDigests } from './digests-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlashcardSeed {
  front: string;
  back: string;
  sourceType: string;
  sectionKey?: string;
}

interface FlashcardSetSeed {
  userKey: keyof Omit<SeededUsers, 'orgId'>;
  title: string;
  description: string;
  barSubject: string;
  topic: string;
  visibility: string;
  docKey: keyof SeededDocuments;
  digestKey: keyof SeededDigests | null;
  cards: FlashcardSeed[];
}

interface ReviewerPackSeed {
  userKey: keyof Omit<SeededUsers, 'orgId'>;
  title: string;
  description: string;
  barSubject: string;
  topic: string;
  visibility: string;
  items: Array<{
    itemType: string;
    docKey: keyof SeededDocuments;
    digestKey?: keyof SeededDigests;
    sectionKey?: string;
    note: string;
  }>;
}

export interface SeededStudyData {
  crimLawFlashcardSet: { id: string; cardIds: string[] };
  laborLawFlashcardSet: { id: string; cardIds: string[] };
  civilLawFlashcardSet: { id: string; cardIds: string[] };
  crimLawReviewerPack: { id: string };
  remedialLawReviewerPack: { id: string };
}

// ---------------------------------------------------------------------------
// Flashcard Sets Data
// ---------------------------------------------------------------------------

const FLASHCARD_SETS: FlashcardSetSeed[] = [
  // =========================================================================
  // 1. Criminal Law — Treachery & Self-Defense (student, auto_digest)
  // =========================================================================
  {
    userKey: 'student',
    title: 'Criminal Law — Treachery & Self-Defense',
    description: 'Key concepts from People v. Santos on treachery as qualifying circumstance and self-defense elements.',
    barSubject: 'criminal_law',
    topic: 'Qualifying Circumstances',
    visibility: 'private',
    docKey: 'peopleVSantos',
    digestKey: 'peopleVSantosDigest',
    cards: [
      {
        front: 'What is treachery (alevosia) as a qualifying circumstance?',
        back: 'Treachery exists when the offender employs means, methods, or forms in the execution of the crime that tend directly and specially to ensure its execution, without risk to himself arising from the defense which the offended party might make.',
        sourceType: 'auto_digest',
        sectionKey: 'Doctrine',
      },
      {
        front: 'What are the two elements required to prove treachery?',
        back: '(1) The means of execution employed gave the person attacked no opportunity to defend himself or retaliate; and (2) the means of execution were deliberately or consciously adopted by the offender.',
        sourceType: 'auto_digest',
        sectionKey: 'Doctrine',
      },
      {
        front: 'Does an attack from behind constitute treachery?',
        back: 'Yes. An attack from behind, sudden and unexpected, on an unarmed and unsuspecting victim constitutes treachery. (People v. Santos, citing People v. Cagoco)',
        sourceType: 'auto_digest',
        sectionKey: 'Ruling',
      },
      {
        front: 'What happens when the accused invokes self-defense?',
        back: 'The burden of evidence shifts to the accused. He must prove by clear and convincing evidence all three requisites under Article 11(1) of the Revised Penal Code.',
        sourceType: 'auto_digest',
        sectionKey: 'Ruling',
      },
      {
        front: 'What are the three requisites of self-defense under Art. 11(1) RPC?',
        back: '(1) Unlawful aggression on the part of the victim; (2) Reasonable necessity of the means employed to prevent or repel it; (3) Lack of sufficient provocation on the part of the person defending himself.',
        sourceType: 'auto_digest',
        sectionKey: 'Ruling',
      },
      {
        front: 'Which element of self-defense is the most essential?',
        back: 'Unlawful aggression. Without unlawful aggression on the part of the victim, self-defense cannot be appreciated. It is the conditio sine qua non of self-defense.',
        sourceType: 'manual',
      },
      {
        front: 'What is the rule on credibility of witnesses on appeal?',
        back: 'The trial court\'s assessment of witness credibility is entitled to great weight and respect and will not be disturbed on appeal, absent any arbitrariness or oversight of material facts.',
        sourceType: 'auto_digest',
        sectionKey: 'Ruling',
      },
      {
        front: 'What is the penalty for murder under the RPC?',
        back: 'Reclusion perpetua to death. In People v. Santos, the accused was sentenced to reclusion perpetua without eligibility for parole, plus civil indemnity (Php 75,000), moral damages (Php 50,000), temperate damages (Php 25,000), and exemplary damages (Php 30,000).',
        sourceType: 'manual',
      },
    ],
  },

  // =========================================================================
  // 2. Labor Law — Termination Due Process (editor, auto_document)
  // =========================================================================
  {
    userKey: 'editor',
    title: 'Labor Law — Termination Due Process (Agabon Doctrine)',
    description: 'Cards covering the twin notice requirement, Agabon doctrine, and distinction between substantive and procedural due process in termination cases.',
    barSubject: 'labor_law',
    topic: 'Termination of Employment',
    visibility: 'org',
    docKey: 'agabonVNlrc',
    digestKey: 'agabonDigest',
    cards: [
      {
        front: 'What is the twin notice requirement for termination of employment?',
        back: 'The employer must furnish the employee with two written notices: (1) a first notice apprising the employee of the acts/omissions for which dismissal is sought; (2) a second notice informing the employee of the employer\'s decision to dismiss.',
        sourceType: 'auto_document',
        sectionKey: 'Syllabus',
      },
      {
        front: 'What is the Agabon doctrine?',
        back: 'Where dismissal is for a just or authorized cause but the employer failed to comply with procedural due process (twin notice rule), the dismissal is NOT illegal. The termination remains valid, but the employer must pay nominal damages.',
        sourceType: 'auto_document',
        sectionKey: 'Doctrine',
      },
      {
        front: 'What doctrine did Agabon v. NLRC abandon?',
        back: 'The Serrano v. NLRC doctrine (G.R. No. 117040, 2000), which held that non-compliance with the notice requirement rendered the dismissal ineffectual and entitled the employee to full backwages.',
        sourceType: 'auto_document',
        sectionKey: 'Ruling',
      },
      {
        front: 'How much are nominal damages for dismissal based on just causes?',
        back: 'Php 30,000.00 for just causes under Article 297 of the Labor Code.',
        sourceType: 'auto_document',
        sectionKey: 'Ruling',
      },
      {
        front: 'How much are nominal damages for dismissal based on authorized causes?',
        back: 'Php 50,000.00 for authorized causes under Article 298 of the Labor Code.',
        sourceType: 'auto_document',
        sectionKey: 'Ruling',
      },
      {
        front: 'What is the distinction between substantive and procedural due process in termination?',
        back: 'Substantive due process concerns the validity of the ground for dismissal (just or authorized cause). Procedural due process concerns the manner of effecting the dismissal (twin notice rule). They are separate and distinct requirements.',
        sourceType: 'auto_document',
        sectionKey: 'Doctrine',
      },
      {
        front: 'What are the elements of abandonment as a just cause for dismissal?',
        back: '(1) The employee must have failed to report for work or been absent without valid reason; and (2) there must be a clear intention to sever the employer-employee relationship, manifested by some overt act.',
        sourceType: 'auto_document',
        sectionKey: 'Ruling',
      },
      {
        front: 'Under which Labor Code article are just causes for termination enumerated?',
        back: 'Article 297 (formerly Article 282) of the Labor Code. Just causes include: serious misconduct, willful disobedience, gross negligence, fraud, commission of a crime against the employer, and analogous causes.',
        sourceType: 'manual',
      },
      {
        front: 'What is the effect of the Agabon ruling on employee rights?',
        back: 'Employees dismissed for just/authorized cause without procedural due process are no longer entitled to reinstatement or backwages. They are only entitled to nominal damages as vindication of their right to due process.',
        sourceType: 'auto_document',
        sectionKey: 'Ruling',
      },
    ],
  },

  // =========================================================================
  // 3. Civil Law — Obligations Essentials (student, manual)
  // =========================================================================
  {
    userKey: 'student',
    title: 'Civil Law — Obligations Essentials (Arts. 1156-1304)',
    description: 'Core concepts on obligations under the Philippine Civil Code: definition, sources, performance, breach, and extinguishment.',
    barSubject: 'civil_law',
    topic: 'Obligations',
    visibility: 'private',
    docKey: 'civilCodeObligations',
    digestKey: 'civilCodeDigest',
    cards: [
      {
        front: 'What is an obligation under Art. 1156 of the Civil Code?',
        back: 'An obligation is a juridical necessity to give, to do, or not to do.',
        sourceType: 'manual',
        sectionKey: 'Article 1156',
      },
      {
        front: 'What are the five sources of obligations under Art. 1157?',
        back: '(1) Law; (2) Contracts; (3) Quasi-contracts; (4) Acts or omissions punished by law (delicts); (5) Quasi-delicts.',
        sourceType: 'manual',
        sectionKey: 'Article 1157',
      },
      {
        front: 'What is the effect of obligations arising from contracts? (Art. 1159)',
        back: 'Obligations arising from contracts have the force of law between the contracting parties and should be complied with in good faith.',
        sourceType: 'manual',
        sectionKey: 'Article 1159',
      },
      {
        front: 'What standard of care applies to a person obliged to give something? (Art. 1163)',
        back: 'The proper diligence of a good father of a family (diligencia de un buen padre de familia), unless the law or stipulation requires another standard.',
        sourceType: 'manual',
        sectionKey: 'Article 1163',
      },
      {
        front: 'When are obligors liable for damages under Art. 1170?',
        back: 'Those who in the performance of their obligations are guilty of fraud, negligence, or delay, and those who in any manner contravene the tenor thereof, are liable for damages.',
        sourceType: 'manual',
        sectionKey: 'Article 1170',
      },
      {
        front: 'What is the rule on fortuitous events under Art. 1174?',
        back: 'No person shall be responsible for events which could not be foreseen, or which though foreseen, were inevitable — except when the law, stipulation, or nature of the obligation requires assumption of risk.',
        sourceType: 'manual',
        sectionKey: 'Article 1174',
      },
      {
        front: 'What are the six modes of extinguishing obligations under Art. 1231?',
        back: '(1) Payment or performance; (2) Loss of the thing due; (3) Condonation or remission; (4) Confusion or merger; (5) Compensation; (6) Novation.',
        sourceType: 'manual',
        sectionKey: 'Article 1231',
      },
      {
        front: 'When does solidary liability arise? (Art. 1207)',
        back: 'Solidary liability arises only when: (1) the obligation expressly so states; (2) the law requires solidarity; or (3) the nature of the obligation requires solidarity.',
        sourceType: 'manual',
        sectionKey: 'Article 1207',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Reviewer Packs Data
// ---------------------------------------------------------------------------

const REVIEWER_PACKS: ReviewerPackSeed[] = [
  // =========================================================================
  // 1. Criminal Law Bar Reviewer (editor, 5 items)
  // =========================================================================
  {
    userKey: 'editor',
    title: 'Criminal Law Bar Reviewer — Qualifying Circumstances & Defenses',
    description: 'Essential cases and doctrines on qualifying circumstances (treachery, evident premeditation) and justifying circumstances (self-defense).',
    barSubject: 'criminal_law',
    topic: 'Qualifying & Justifying Circumstances',
    visibility: 'org',
    items: [
      {
        itemType: 'document',
        docKey: 'peopleVSantos',
        note: 'Lead case on treachery — attack from behind on unsuspecting victim.',
      },
      {
        itemType: 'digest',
        docKey: 'peopleVSantos',
        digestKey: 'peopleVSantosDigest',
        note: 'Full DFIR+ digest with provenance. Focus on doctrine section.',
      },
      {
        itemType: 'section',
        docKey: 'peopleVSantos',
        sectionKey: 'Doctrine',
        note: 'Two-element test for treachery + burden-shifting in self-defense.',
      },
      {
        itemType: 'section',
        docKey: 'peopleVSantos',
        sectionKey: 'Ruling',
        note: 'Application of treachery test. Self-defense failure analysis.',
      },
      {
        itemType: 'section',
        docKey: 'peopleVSantos',
        sectionKey: 'Dispositive Portion',
        note: 'Damages breakdown: civil indemnity + moral + temperate + exemplary.',
      },
    ],
  },

  // =========================================================================
  // 2. Remedial Law — Motions (student, 4 items)
  // =========================================================================
  {
    userKey: 'student',
    title: 'Remedial Law — Motion to Dismiss (Rule 16)',
    description: 'Quick reviewer on Rule 16 grounds, effects, and pleading as affirmative defense.',
    barSubject: 'remedial_law',
    topic: 'Civil Procedure — Motions',
    visibility: 'private',
    items: [
      {
        itemType: 'document',
        docKey: 'rulesOfCourtRule16',
        note: 'Full text of Rule 16 — 10 grounds for dismissal.',
      },
      {
        itemType: 'section',
        docKey: 'rulesOfCourtRule16',
        sectionKey: 'Section 1 — Grounds',
        note: 'Memorize all 10 grounds (a)-(j). Common bar exam topic.',
      },
      {
        itemType: 'section',
        docKey: 'rulesOfCourtRule16',
        sectionKey: 'Section 5 — Effect of Dismissal',
        note: 'Key distinction: (f)(h)(i) bar refiling vs. (a)-(e) do not bar refiling.',
      },
      {
        itemType: 'section',
        docKey: 'rulesOfCourtRule16',
        sectionKey: 'Section 6 — Pleading Grounds as Affirmative Defenses',
        note: 'Alternative to filing motion: plead in the answer as affirmative defense.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedStudyData(
  prisma: PrismaClient,
  users: SeededUsers,
  docs: SeededDocuments,
  digests: SeededDigests,
): Promise<SeededStudyData> {
  console.log('\n--- Seeding study data ---');

  const result = {} as SeededStudyData;
  const setKeys = [
    'crimLawFlashcardSet',
    'laborLawFlashcardSet',
    'civilLawFlashcardSet',
  ];

  // -------------------------------------------------------------------------
  // Flashcard Sets + Cards
  // -------------------------------------------------------------------------
  let totalCards = 0;

  for (let i = 0; i < FLASHCARD_SETS.length; i++) {
    const seed = FLASHCARD_SETS[i];
    const key = setKeys[i];
    if (!seed || !key) continue;
    const userId = users[seed.userKey].id;
    const doc = docs[seed.docKey];

    // Check if set already exists
    const existing = await prisma.flashcardSet.findFirst({
      where: { title: seed.title, userId },
    });

    let flashcardSet;
    const setData = {
      organizationId: users.orgId,
      userId,
      title: seed.title,
      description: seed.description,
      barSubject: seed.barSubject,
      topic: seed.topic,
      visibility: seed.visibility,
      cardCount: seed.cards.length,
    };

    if (existing) {
      flashcardSet = await prisma.flashcardSet.update({
        where: { id: existing.id },
        data: setData,
      });
      // Clean existing cards
      await prisma.flashcard.deleteMany({ where: { flashcardSetId: existing.id } });
    } else {
      flashcardSet = await prisma.flashcardSet.create({ data: setData });
    }

    // Create cards
    const cardIds: string[] = [];
    for (let j = 0; j < seed.cards.length; j++) {
      const card = seed.cards[j];
      if (!card) continue;
      const sectionId = card.sectionKey ? doc.sectionIds[card.sectionKey] ?? null : null;
      const digestId = seed.digestKey ? digests[seed.digestKey].id : null;

      const created = await prisma.flashcard.create({
        data: {
          flashcardSetId: flashcardSet.id,
          legalDocumentId: doc.id,
          sectionId,
          digestId: card.sourceType === 'auto_digest' ? digestId : null,
          front: card.front,
          back: card.back,
          sourceType: card.sourceType,
          ordering: j,
        },
      });
      cardIds.push(created.id);
      totalCards++;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[key] = { id: flashcardSet.id, cardIds };
    console.log(`  Flashcard set: ${seed.title} (${seed.cards.length} cards, ${seed.visibility})`);
  }

  console.log(`  ${FLASHCARD_SETS.length} flashcard sets, ${totalCards} cards total.`);

  // -------------------------------------------------------------------------
  // Reviewer Packs + Items
  // -------------------------------------------------------------------------
  const packKeys = ['crimLawReviewerPack', 'remedialLawReviewerPack'];
  let totalItems = 0;

  for (let i = 0; i < REVIEWER_PACKS.length; i++) {
    const seed = REVIEWER_PACKS[i];
    const key = packKeys[i];
    if (!seed || !key) continue;
    const userId = users[seed.userKey].id;

    const existing = await prisma.reviewerPack.findFirst({
      where: { title: seed.title, creatorUserId: userId },
    });

    let pack;
    const packData = {
      organizationId: users.orgId,
      creatorUserId: userId,
      title: seed.title,
      description: seed.description,
      barSubject: seed.barSubject,
      topic: seed.topic,
      visibility: seed.visibility,
      itemCount: seed.items.length,
    };

    if (existing) {
      pack = await prisma.reviewerPack.update({
        where: { id: existing.id },
        data: packData,
      });
      await prisma.reviewerPackItem.deleteMany({ where: { reviewerPackId: existing.id } });
    } else {
      pack = await prisma.reviewerPack.create({ data: packData });
    }

    for (let j = 0; j < seed.items.length; j++) {
      const item = seed.items[j];
      if (!item) continue;
      const doc = docs[item.docKey];
      const digestId = item.digestKey ? digests[item.digestKey].id : null;
      const sectionId = item.sectionKey ? doc.sectionIds[item.sectionKey] ?? null : null;

      await prisma.reviewerPackItem.create({
        data: {
          reviewerPackId: pack.id,
          itemType: item.itemType,
          legalDocumentId: doc.id,
          digestId,
          sectionId,
          ordering: j,
          note: item.note,
        },
      });
      totalItems++;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[key] = { id: pack.id };
    console.log(`  Reviewer pack: ${seed.title} (${seed.items.length} items, ${seed.visibility})`);
  }

  console.log(`  ${REVIEWER_PACKS.length} reviewer packs, ${totalItems} items total.`);

  // -------------------------------------------------------------------------
  // Flashcard Reviews (student reviews criminal law cards)
  // -------------------------------------------------------------------------
  console.log('  Seeding flashcard reviews...');

  const crimCards = result.crimLawFlashcardSet.cardIds;
  const studentId = users.student.id;

  // Delete existing reviews for these cards by this user
  await prisma.flashcardReview.deleteMany({
    where: { flashcardId: { in: crimCards }, userId: studentId },
  });

  const reviewResponses = ['good', 'easy', 'good', 'hard', 'good', 'easy', 'good', 'again'];
  const now = new Date();

  for (let j = 0; j < crimCards.length; j++) {
    const response = reviewResponses[j];
    const cardId = crimCards[j];
    if (!response || !cardId) continue;
    const confidence = response === 'easy' ? 5 : response === 'good' ? 4 : response === 'hard' ? 2 : 1;
    const interval = response === 'easy' ? 6 : response === 'good' ? 3 : response === 'hard' ? 1 : 0;
    const easeFactor = response === 'easy' ? 2.6 : response === 'good' ? 2.5 : response === 'hard' ? 2.36 : 2.18;

    await prisma.flashcardReview.create({
      data: {
        flashcardId: cardId,
        userId: studentId,
        response,
        confidence,
        interval,
        easeFactor,
        reviewedAt: new Date(now.getTime() - (crimCards.length - j) * 60000), // stagger by 1 min
      },
    });
  }

  console.log(`  ${crimCards.length} flashcard reviews created (student → criminal law set).`);

  // -------------------------------------------------------------------------
  // Study Progress
  // -------------------------------------------------------------------------
  console.log('  Seeding study progress...');

  const progressEntries = [
    {
      userId: studentId,
      entityType: 'flashcard_set',
      entityId: result.crimLawFlashcardSet.id,
      status: 'in_progress',
      progressPct: 75,
      metadata: { lastCardIndex: 5, totalCards: 8 },
    },
    {
      userId: studentId,
      entityType: 'flashcard_set',
      entityId: result.civilLawFlashcardSet.id,
      status: 'not_started',
      progressPct: 0,
      metadata: {},
    },
    {
      userId: users.editor.id,
      entityType: 'flashcard_set',
      entityId: result.laborLawFlashcardSet.id,
      status: 'completed',
      progressPct: 100,
      metadata: { completedReviews: 9 },
    },
    {
      userId: studentId,
      entityType: 'reviewer_pack',
      entityId: result.remedialLawReviewerPack.id,
      status: 'in_progress',
      progressPct: 50,
      metadata: { lastItemIndex: 1 },
    },
  ];

  for (const entry of progressEntries) {
    await prisma.studyProgress.upsert({
      where: {
        userId_entityType_entityId: {
          userId: entry.userId,
          entityType: entry.entityType,
          entityId: entry.entityId,
        },
      },
      update: {
        status: entry.status,
        progressPct: entry.progressPct,
        metadataJson: entry.metadata,
        completedAt: entry.status === 'completed' ? new Date() : null,
      },
      create: {
        userId: entry.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        status: entry.status,
        progressPct: entry.progressPct,
        metadataJson: entry.metadata,
        completedAt: entry.status === 'completed' ? new Date() : null,
      },
    });
  }

  console.log(`  ${progressEntries.length} study progress entries.`);

  // -------------------------------------------------------------------------
  // Study Sessions
  // -------------------------------------------------------------------------
  console.log('  Seeding study sessions...');

  // Delete existing sessions for dev users
  await prisma.studySession.deleteMany({
    where: { userId: { in: [studentId, users.editor.id] } },
  });

  const sessions = [
    {
      userId: studentId,
      entityType: 'flashcard_set',
      entityId: result.crimLawFlashcardSet.id,
      barSubject: 'criminal_law',
      startedAt: new Date(now.getTime() - 3600000), // 1 hour ago
      endedAt: new Date(now.getTime() - 1800000), // 30 min ago
      durationSecs: 1800,
      itemsStudied: 8,
      itemsCorrect: 6,
    },
    {
      userId: studentId,
      entityType: 'reviewer_pack',
      entityId: result.remedialLawReviewerPack.id,
      barSubject: 'remedial_law',
      startedAt: new Date(now.getTime() - 7200000), // 2 hours ago
      endedAt: new Date(now.getTime() - 5400000), // 1.5 hours ago
      durationSecs: 1800,
      itemsStudied: 2,
      itemsCorrect: 2,
    },
    {
      userId: users.editor.id,
      entityType: 'flashcard_set',
      entityId: result.laborLawFlashcardSet.id,
      barSubject: 'labor_law',
      startedAt: new Date(now.getTime() - 86400000), // yesterday
      endedAt: new Date(now.getTime() - 84600000),
      durationSecs: 1800,
      itemsStudied: 9,
      itemsCorrect: 8,
    },
  ];

  for (const session of sessions) {
    await prisma.studySession.create({ data: session });
  }

  console.log(`  ${sessions.length} study sessions.`);

  // -------------------------------------------------------------------------
  // Study Streaks
  // -------------------------------------------------------------------------
  console.log('  Seeding study streaks...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const streaks = [
    {
      userId: studentId,
      currentStreak: 5,
      longestStreak: 12,
      lastStudyDate: today,
      totalStudyDays: 23,
    },
    {
      userId: users.editor.id,
      currentStreak: 1,
      longestStreak: 8,
      lastStudyDate: new Date(today.getTime() - 86400000), // yesterday
      totalStudyDays: 15,
    },
  ];

  for (const streak of streaks) {
    await prisma.studyStreak.upsert({
      where: { userId: streak.userId },
      update: {
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastStudyDate: streak.lastStudyDate,
        totalStudyDays: streak.totalStudyDays,
      },
      create: streak,
    });
  }

  console.log(`  ${streaks.length} study streaks.`);

  return result;
}
