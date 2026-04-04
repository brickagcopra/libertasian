/**
 * Workspace Seed Data — Matters, tasks, notes, annotations, bookmarks,
 * matter documents, and task/matter comments.
 *
 * Matters (3):
 *   1. Santos Murder Case (member, active, criminal)
 *   2. Agabon Labor Dispute (member, active, labor)
 *   3. Data Privacy Compliance Review (editor, closed, regulatory)
 *
 * Tasks (6), Notes (5), Annotations (4), Bookmarks (4)
 */

import { PrismaClient } from '@prisma/client';
import { SeededUsers } from './dev-users';
import { SeededDocuments } from './legal-documents';
import { SeededScans } from './scans-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeededWorkspace {
  santosMatter: { id: string };
  agabonMatter: { id: string };
  privacyMatter: { id: string };
}

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedWorkspaceData(
  prisma: PrismaClient,
  users: SeededUsers,
  docs: SeededDocuments,
  scans: SeededScans,
): Promise<SeededWorkspace> {
  console.log('\n--- Seeding workspace data ---');

  // =========================================================================
  // MATTERS
  // =========================================================================
  const matterSeeds = [
    {
      key: 'santosMatter',
      ownerKey: 'member' as const,
      title: 'People v. Santos — Appeal Research',
      description: 'Research file for potential appeal grounds in the Santos murder case. Focus on treachery analysis and witness credibility issues.',
      matterType: 'criminal',
      court: 'Supreme Court — Second Division',
      status: 'active',
    },
    {
      key: 'agabonMatter',
      ownerKey: 'member' as const,
      title: 'Agabon Labor Dispute — Client Advisory',
      description: 'Advisory research on procedural due process requirements for termination. Client seeking guidance on twin notice compliance after recent employee separation.',
      matterType: 'labor',
      court: 'National Labor Relations Commission',
      status: 'active',
    },
    {
      key: 'privacyMatter',
      ownerKey: 'editor' as const,
      title: 'Data Privacy Compliance Review — RA 10173',
      description: 'Internal compliance review to ensure LIBERTASIAN platform meets Data Privacy Act requirements. Covers data processing policies, consent mechanisms, and NPC registration.',
      matterType: 'regulatory',
      court: null,
      status: 'closed',
    },
  ];

  const result = {} as SeededWorkspace;

  for (const seed of matterSeeds) {
    const userId = users[seed.ownerKey].id;

    const existing = await prisma.matter.findFirst({
      where: { title: seed.title, ownerUserId: userId },
    });

    let matter;
    const data = {
      organizationId: users.orgId,
      ownerUserId: userId,
      title: seed.title,
      description: seed.description,
      matterType: seed.matterType,
      court: seed.court,
      status: seed.status,
    };

    if (existing) {
      matter = await prisma.matter.update({ where: { id: existing.id }, data });
    } else {
      matter = await prisma.matter.create({ data });
    }

    result[seed.key as keyof SeededWorkspace] = { id: matter.id };
    console.log(`  Matter: ${seed.title} (${seed.status})`);
  }

  console.log(`  ${matterSeeds.length} matters seeded.`);

  // =========================================================================
  // MATTER DOCUMENTS
  // =========================================================================
  console.log('  Seeding matter documents...');

  // Clean existing matter documents for these matters
  const matterIds = Object.values(result).map((m) => m.id);
  await prisma.matterDocument.deleteMany({ where: { matterId: { in: matterIds } } });

  const matterDocs = [
    { matterId: result.santosMatter.id, legalDocumentId: docs.peopleVSantos.id, title: 'People v. Santos — Full Text', role: 'reference' },
    { matterId: result.santosMatter.id, userUploadId: scans.studentCrimLawExcerpt.id, title: 'Scanned page — Ruling excerpt', role: 'evidence' },
    { matterId: result.agabonMatter.id, legalDocumentId: docs.agabonVNlrc.id, title: 'Agabon v. NLRC — Full Text', role: 'reference' },
    { matterId: result.privacyMatter.id, legalDocumentId: docs.ra10173.id, title: 'RA 10173 — Data Privacy Act', role: 'reference' },
  ];

  for (const doc of matterDocs) {
    await prisma.matterDocument.create({ data: doc });
  }

  console.log(`  ${matterDocs.length} matter documents linked.`);

  // =========================================================================
  // TASKS
  // =========================================================================
  console.log('  Seeding tasks...');

  const now = new Date();
  const inThreeDays = new Date(now.getTime() + 3 * 86400000);
  const inOneWeek = new Date(now.getTime() + 7 * 86400000);
  const yesterday = new Date(now.getTime() - 86400000);

  const taskSeeds = [
    {
      matterId: result.santosMatter.id,
      createdByKey: 'member' as const,
      assignedToKey: 'member' as const,
      title: 'Review treachery jurisprudence (2000-2010)',
      description: 'Compile all SC decisions on treachery as qualifying circumstance from 2000-2010. Focus on attack-from-behind cases.',
      status: 'in_progress',
      priority: 'high',
      dueDate: inThreeDays,
    },
    {
      matterId: result.santosMatter.id,
      createdByKey: 'member' as const,
      assignedToKey: 'editor' as const,
      title: 'Draft motion for reconsideration outline',
      description: 'Outline grounds for MR focusing on witness credibility issues and alternative interpretation of physical evidence.',
      status: 'todo',
      priority: 'medium',
      dueDate: inOneWeek,
    },
    {
      matterId: result.agabonMatter.id,
      createdByKey: 'member' as const,
      assignedToKey: 'member' as const,
      title: 'Compute nominal damages exposure',
      description: 'Calculate potential nominal damages liability based on Agabon doctrine. Client terminated 3 employees without proper notice.',
      status: 'done',
      priority: 'high',
      dueDate: yesterday,
      completedAt: yesterday,
    },
    {
      matterId: result.agabonMatter.id,
      createdByKey: 'member' as const,
      assignedToKey: null,
      title: 'Draft twin notice templates for HR department',
      description: 'Create template first and second notices compliant with twin notice requirement per Agabon v. NLRC.',
      status: 'todo',
      priority: 'medium',
      dueDate: inOneWeek,
    },
    {
      matterId: result.privacyMatter.id,
      createdByKey: 'editor' as const,
      assignedToKey: 'editor' as const,
      title: 'Map data processing activities to RA 10173 requirements',
      description: 'Audit all personal data processing in the platform and map to lawful processing bases under Section 12.',
      status: 'done',
      priority: 'high',
      dueDate: yesterday,
      completedAt: yesterday,
    },
    {
      matterId: result.privacyMatter.id,
      createdByKey: 'editor' as const,
      assignedToKey: 'member' as const,
      title: 'Prepare NPC registration documents',
      description: 'Complete National Privacy Commission registration form and supporting documents.',
      status: 'done',
      priority: 'medium',
      dueDate: yesterday,
      completedAt: new Date(now.getTime() - 2 * 86400000),
    },
  ];

  const taskIds: string[] = [];

  for (const seed of taskSeeds) {
    const task = await prisma.task.create({
      data: {
        organizationId: users.orgId,
        matterId: seed.matterId,
        createdByUserId: users[seed.createdByKey].id,
        assignedToUserId: seed.assignedToKey ? users[seed.assignedToKey].id : null,
        title: seed.title,
        description: seed.description,
        status: seed.status,
        priority: seed.priority,
        dueDate: seed.dueDate,
        completedAt: (seed as Record<string, unknown>)['completedAt'] as Date | undefined ?? null,
      },
    });
    taskIds.push(task.id);
  }

  console.log(`  ${taskSeeds.length} tasks seeded.`);

  // Task comments
  console.log('  Seeding task comments...');
  const taskComments = [
    { taskId: taskIds[0]!, userId: users.member.id, body: 'Found 3 relevant cases so far. People v. Cagoco is the most directly on point.' },
    { taskId: taskIds[0]!, userId: users.editor.id, body: 'Check also People v. Escote (G.R. No. 140756) for the "swift and unexpected" test.' },
    { taskId: taskIds[2]!, userId: users.member.id, body: 'Computed: 3 employees × Php 30,000 = Php 90,000 nominal damages exposure. Memo sent to client.' },
  ];

  for (const comment of taskComments) {
    await prisma.taskComment.create({ data: comment });
  }

  // Matter comments
  const matterComments = [
    { matterId: result.santosMatter.id, userId: users.member.id, body: 'Initial research complete. Key issue is whether the "attack from behind" finding can be challenged based on conflicting medical evidence.' },
    { matterId: result.agabonMatter.id, userId: users.editor.id, body: 'Note: client should implement proper notice procedures immediately to avoid future exposure.' },
  ];

  for (const comment of matterComments) {
    await prisma.matterComment.create({ data: comment });
  }

  console.log(`  ${taskComments.length} task comments, ${matterComments.length} matter comments.`);

  // =========================================================================
  // NOTES
  // =========================================================================
  console.log('  Seeding notes...');

  const noteSeeds = [
    {
      userId: users.member.id,
      matterId: result.santosMatter.id,
      title: 'Treachery Elements — Quick Reference',
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two-Element Test for Treachery' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Means of execution gave victim no opportunity to defend or retaliate' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Means were deliberately or consciously adopted' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'Source: People v. Santos, Doctrine section' }] },
        ],
      },
      visibility: 'private',
    },
    {
      userId: users.member.id,
      matterId: result.agabonMatter.id,
      title: 'Twin Notice Checklist',
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Twin Notice Requirement' }] },
          { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First notice: specific acts/omissions for which dismissal is sought' }] }] },
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second notice: employer decision to dismiss' }] }] },
          ]},
        ],
      },
      visibility: 'org_shared',
    },
    {
      userId: users.editor.id,
      matterId: result.privacyMatter.id,
      title: 'RA 10173 Compliance Gaps',
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Key findings from the compliance review:' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Privacy policy needs updating for camera scan feature' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'NPC registration form submitted 2026-03-15' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Data processing agreement templates drafted' }] }] },
          ]},
        ],
      },
      visibility: 'org_shared',
    },
    {
      userId: users.student.id,
      matterId: null,
      title: 'Criminal Law — Self-Defense Study Notes',
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Three elements of self-defense (Art. 11(1) RPC):' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unlawful aggression (ESSENTIAL — conditio sine qua non)' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reasonable necessity of means employed' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lack of sufficient provocation' }] }] },
          ]},
        ],
      },
      visibility: 'private',
    },
    {
      userId: users.student.id,
      matterId: null,
      title: 'Obligations Outline — Bar Review',
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sources (Art. 1157)' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'LCCQQ: Law, Contracts, Quasi-contracts, delicts (Crimes), Quasi-delicts' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Extinguishment (Art. 1231)' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'PLCCCN: Payment, Loss, Condonation, Confusion, Compensation, Novation' }] },
        ],
      },
      visibility: 'private',
    },
  ];

  for (const seed of noteSeeds) {
    await prisma.note.create({
      data: {
        organizationId: users.orgId,
        userId: seed.userId,
        matterId: seed.matterId,
        title: seed.title,
        body: seed.body,
        visibility: seed.visibility,
      },
    });
  }

  console.log(`  ${noteSeeds.length} notes seeded.`);

  // =========================================================================
  // BOOKMARKS
  // =========================================================================
  console.log('  Seeding bookmarks...');

  const bookmarkSeeds = [
    {
      userId: users.member.id,
      legalDocumentId: docs.peopleVSantos.id,
      sectionKey: 'Doctrine',
      note: 'Key doctrine on treachery — cite in MR',
    },
    {
      userId: users.member.id,
      legalDocumentId: docs.agabonVNlrc.id,
      sectionKey: 'Doctrine',
      note: 'Agabon doctrine — nominal damages framework',
    },
    {
      userId: users.student.id,
      legalDocumentId: docs.civilCodeObligations.id,
      sectionKey: 'Article 1231',
      note: 'Memorize 6 modes of extinguishment!',
    },
    {
      userId: users.student.id,
      legalDocumentId: docs.rulesOfCourtRule16.id,
      sectionKey: 'Section 1 — Grounds',
      note: '10 grounds for MTD — bar exam favorite',
    },
  ];

  for (const seed of bookmarkSeeds) {
    const sectionId = seed.sectionKey
      ? docs[Object.keys(docs).find((k) =>
          docs[k as keyof SeededDocuments].id === seed.legalDocumentId
        ) as keyof SeededDocuments]?.sectionIds[seed.sectionKey] ?? null
      : null;

    await prisma.bookmark.create({
      data: {
        userId: seed.userId,
        legalDocumentId: seed.legalDocumentId,
        legalDocumentSectionId: sectionId,
        note: seed.note,
      },
    });
  }

  console.log(`  ${bookmarkSeeds.length} bookmarks seeded.`);

  // =========================================================================
  // ANNOTATIONS
  // =========================================================================
  console.log('  Seeding annotations...');

  const annotationSeeds = [
    {
      userId: users.member.id,
      legalDocumentId: docs.peopleVSantos.id,
      sectionKey: 'Ruling',
      textAnchor: { startOffset: 0, endOffset: 140, anchorText: 'The appeal is DENIED. The conviction of the accused for murder qualified by treachery is AFFIRMED with MODIFICATION.' },
      annotationText: 'Dispositive — conviction affirmed. Note the modification (damages adjusted).',
      color: 'green',
    },
    {
      userId: users.member.id,
      legalDocumentId: docs.agabonVNlrc.id,
      sectionKey: 'Ruling',
      textAnchor: { startOffset: 500, endOffset: 720, anchorText: 'the non-compliance with the procedural requirement of the twin notice rule does NOT make the dismissal illegal or void' },
      annotationText: 'THIS IS THE AGABON DOCTRINE. Departure from Serrano.',
      color: 'yellow',
    },
    {
      userId: users.student.id,
      legalDocumentId: docs.peopleVSantos.id,
      sectionKey: 'Doctrine',
      textAnchor: { startOffset: 0, endOffset: 200, anchorText: 'Treachery as a qualifying circumstance for murder requires proof that' },
      annotationText: 'Two-element test — memorize for bar exam!',
      color: 'blue',
    },
    {
      userId: users.student.id,
      legalDocumentId: docs.civilCodeObligations.id,
      sectionKey: 'Article 1159',
      textAnchor: { startOffset: 0, endOffset: 120, anchorText: 'Obligations arising from contracts have the force of law between the contracting parties' },
      annotationText: 'Pacta sunt servanda — binding force of contracts.',
      color: 'purple',
    },
  ];

  for (const seed of annotationSeeds) {
    // Resolve section ID from document
    const docEntry = Object.values(docs).find((d) => d.id === seed.legalDocumentId);
    const sectionId = docEntry?.sectionIds[seed.sectionKey] ?? null;

    await prisma.annotation.create({
      data: {
        userId: seed.userId,
        legalDocumentId: seed.legalDocumentId,
        sectionId,
        textAnchor: seed.textAnchor,
        annotationText: seed.annotationText,
        color: seed.color,
      },
    });
  }

  console.log(`  ${annotationSeeds.length} annotations seeded.`);

  return result;
}
