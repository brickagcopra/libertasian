/**
 * Seed subject taxonomy rows: subjects, sub-topics, and equivalences.
 *
 * Two coexisting taxonomy systems:
 *   - study_8:     8-subject bar review study taxonomy (primary)
 *   - bar_admin_6: 6-subject SC administrative grouping (secondary overlay)
 *
 * Sub-topics sourced from the Respicio summary of Bar Bulletin No. 1,
 * mapped to study_8 parent subjects.
 *
 * Equivalence mappings bridge bar_admin_6 → study_8 for compatibility.
 *
 * Idempotent: upsert by unique constraints. Re-running refreshes data
 * without duplicating rows.
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// study_8 subjects (primary taxonomy)
// ---------------------------------------------------------------------------

interface SubjectSeed {
  code: string;
  name: string;
  taxonomyVersion: string;
  weightPercent: number | null;
  effectiveFrom: number | null;
  effectiveTo: number | null;
  displayOrder: number;
  description: string | null;
}

const STUDY_8_SUBJECTS: SubjectSeed[] = [
  {
    code: 'political_law',
    name: 'Political Law and Public International Law',
    taxonomyVersion: 'study_8',
    weightPercent: 15.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 1,
    description: null,
  },
  {
    code: 'labor_law',
    name: 'Labor Law and Social Legislation',
    taxonomyVersion: 'study_8',
    weightPercent: 10.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 2,
    description: null,
  },
  {
    code: 'civil_law',
    name: 'Civil Law',
    taxonomyVersion: 'study_8',
    weightPercent: 15.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 3,
    description: null,
  },
  {
    code: 'taxation',
    name: 'Taxation',
    taxonomyVersion: 'study_8',
    weightPercent: 10.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 4,
    description: null,
  },
  {
    code: 'mercantile_law',
    name: 'Mercantile (Commercial) Law',
    taxonomyVersion: 'study_8',
    weightPercent: 15.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 5,
    description: null,
  },
  {
    code: 'criminal_law',
    name: 'Criminal Law',
    taxonomyVersion: 'study_8',
    weightPercent: 10.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 6,
    description: null,
  },
  {
    code: 'remedial_law',
    name: 'Remedial Law',
    taxonomyVersion: 'study_8',
    weightPercent: 20.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 7,
    description: null,
  },
  {
    code: 'legal_ethics',
    name: 'Legal and Judicial Ethics',
    taxonomyVersion: 'study_8',
    weightPercent: 5.0,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder: 8,
    description: null,
  },
];

// ---------------------------------------------------------------------------
// bar_admin_6 subjects (secondary taxonomy)
// ---------------------------------------------------------------------------

const BAR_ADMIN_6_SUBJECTS: SubjectSeed[] = [
  {
    code: 'political_pil',
    name: 'Political and Public International Law',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 15.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 1,
    description: null,
  },
  {
    code: 'commercial_taxation',
    name: 'Commercial and Taxation Laws',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 20.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 2,
    description: null,
  },
  {
    code: 'civil_land_titles',
    name: 'Civil Law and Land Titles and Deeds',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 20.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 3,
    description: null,
  },
  {
    code: 'labor_social',
    name: 'Labor Law and Social Legislation',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 10.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 4,
    description: null,
  },
  {
    code: 'criminal',
    name: 'Criminal Law',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 10.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 5,
    description: null,
  },
  {
    code: 'remedial_ethics_practical',
    name: 'Remedial Law, Legal and Judicial Ethics with Practical Exercises',
    taxonomyVersion: 'bar_admin_6',
    weightPercent: 25.0,
    effectiveFrom: 2025,
    effectiveTo: null,
    displayOrder: 6,
    description: null,
  },
];

// ---------------------------------------------------------------------------
// Equivalence mappings: study_8 ↔ bar_admin_6
// ---------------------------------------------------------------------------

interface EquivalenceSeed {
  studyCode: string;
  barAdminCode: string;
  relationship: string;
  notes: string | null;
}

const EQUIVALENCE_SEEDS: EquivalenceSeed[] = [
  { studyCode: 'political_law', barAdminCode: 'political_pil', relationship: 'equivalent', notes: null },
  { studyCode: 'mercantile_law', barAdminCode: 'commercial_taxation', relationship: 'partial', notes: 'One of two study subjects in the bucket' },
  { studyCode: 'taxation', barAdminCode: 'commercial_taxation', relationship: 'partial', notes: 'One of two study subjects in the bucket' },
  { studyCode: 'civil_law', barAdminCode: 'civil_land_titles', relationship: 'equivalent', notes: 'Land Titles is a sub-topic within civil_law' },
  { studyCode: 'labor_law', barAdminCode: 'labor_social', relationship: 'equivalent', notes: null },
  { studyCode: 'criminal_law', barAdminCode: 'criminal', relationship: 'equivalent', notes: null },
  { studyCode: 'remedial_law', barAdminCode: 'remedial_ethics_practical', relationship: 'partial', notes: 'One of two study subjects in the bucket' },
  { studyCode: 'legal_ethics', barAdminCode: 'remedial_ethics_practical', relationship: 'partial', notes: 'One of two study subjects in the bucket' },
];

// ---------------------------------------------------------------------------
// Sub-topics under study_8 subjects (from Respicio bar bulletin summary)
// ---------------------------------------------------------------------------

interface TopicSeed {
  parentCode: string;
  code: string;
  name: string;
  displayOrder: number;
}

const TOPIC_SEEDS: TopicSeed[] = [
  // political_law
  { parentCode: 'political_law', code: 'political_law.constitutional_doctrines', name: 'Fundamental constitutional doctrines', displayOrder: 1 },
  { parentCode: 'political_law', code: 'political_law.government_powers', name: 'Powers and functions of governmental branches', displayOrder: 2 },
  { parentCode: 'political_law', code: 'political_law.sovereignty_territory', name: 'State sovereignty and territorial questions', displayOrder: 3 },
  { parentCode: 'political_law', code: 'political_law.bill_of_rights', name: 'Bill of Rights (due process, equal protection, privacy, speech, religion)', displayOrder: 4 },
  { parentCode: 'political_law', code: 'political_law.election_law', name: 'Election law', displayOrder: 5 },
  { parentCode: 'political_law', code: 'political_law.administrative_law', name: 'Administrative law', displayOrder: 6 },
  { parentCode: 'political_law', code: 'political_law.public_officers', name: 'Law on public officers', displayOrder: 7 },
  { parentCode: 'political_law', code: 'political_law.public_international_law', name: 'Public international law (treaties, international organisations, human rights, humanitarian law, maritime law)', displayOrder: 8 },

  // mercantile_law
  { parentCode: 'mercantile_law', code: 'mercantile_law.corporation_law', name: 'Corporation Law', displayOrder: 1 },
  { parentCode: 'mercantile_law', code: 'mercantile_law.securities_regulation', name: 'Securities Regulation Code', displayOrder: 2 },
  { parentCode: 'mercantile_law', code: 'mercantile_law.transportation', name: 'Transportation (common carriers)', displayOrder: 3 },
  { parentCode: 'mercantile_law', code: 'mercantile_law.insurance', name: 'Insurance Code', displayOrder: 4 },
  { parentCode: 'mercantile_law', code: 'mercantile_law.intellectual_property', name: 'Intellectual Property Code', displayOrder: 5 },
  { parentCode: 'mercantile_law', code: 'mercantile_law.banking', name: 'Banking Laws', displayOrder: 6 },

  // taxation
  { parentCode: 'taxation', code: 'taxation.general_principles', name: 'General principles of taxation', displayOrder: 1 },
  { parentCode: 'taxation', code: 'taxation.nirc', name: 'National Internal Revenue Code (TRAIN, CREATE, Ease of Paying Taxes Act)', displayOrder: 2 },
  { parentCode: 'taxation', code: 'taxation.tariff_customs', name: 'Tariff and Customs Code', displayOrder: 3 },
  { parentCode: 'taxation', code: 'taxation.local_government', name: 'Local Government taxation', displayOrder: 4 },
  { parentCode: 'taxation', code: 'taxation.real_property', name: 'Real Property taxation', displayOrder: 5 },
  { parentCode: 'taxation', code: 'taxation.tax_remedies', name: 'Tax remedies', displayOrder: 6 },

  // civil_law
  { parentCode: 'civil_law', code: 'civil_law.persons_family', name: 'Persons and Family Relations (Family Code)', displayOrder: 1 },
  { parentCode: 'civil_law', code: 'civil_law.property', name: 'Property (possession, ownership, easements)', displayOrder: 2 },
  { parentCode: 'civil_law', code: 'civil_law.obligations_contracts', name: 'Obligations and Contracts', displayOrder: 3 },
  { parentCode: 'civil_law', code: 'civil_law.special_contracts', name: 'Special Contracts (sales, lease, partnership, agency, credit transactions)', displayOrder: 4 },
  { parentCode: 'civil_law', code: 'civil_law.succession', name: 'Succession and wills', displayOrder: 5 },
  { parentCode: 'civil_law', code: 'civil_law.quasi_contracts_delicts', name: 'Quasi-contracts, quasi-delicts, damages', displayOrder: 6 },
  { parentCode: 'civil_law', code: 'civil_law.land_titles', name: 'Land Titles and Deeds (Torrens system, P.D. 1529)', displayOrder: 7 },

  // labor_law
  { parentCode: 'labor_law', code: 'labor_law.labor_standards', name: 'Labor standards (wages, hours, conditions)', displayOrder: 1 },
  { parentCode: 'labor_law', code: 'labor_law.labor_relations', name: 'Labor relations (unions, collective bargaining, strikes)', displayOrder: 2 },
  { parentCode: 'labor_law', code: 'labor_law.termination', name: 'Termination and due process', displayOrder: 3 },
  { parentCode: 'labor_law', code: 'labor_law.social_legislation', name: 'Social legislation (SSS, GSIS, PhilHealth, Pag-IBIG)', displayOrder: 4 },
  { parentCode: 'labor_law', code: 'labor_law.ofw_regulations', name: 'POEA Rules and Regulations for OFWs', displayOrder: 5 },

  // criminal_law
  { parentCode: 'criminal_law', code: 'criminal_law.rpc_book_1', name: 'Book I of the Revised Penal Code (general principles, felonies, penalties)', displayOrder: 1 },
  { parentCode: 'criminal_law', code: 'criminal_law.rpc_book_2', name: 'Book II of the Revised Penal Code (specific felonies)', displayOrder: 2 },
  { parentCode: 'criminal_law', code: 'criminal_law.special_penal_laws', name: 'Special penal laws (Dangerous Drugs, Anti-Hazing, Anti-VAWC, Cybercrime, Anti-Terrorism)', displayOrder: 3 },

  // remedial_law
  { parentCode: 'remedial_law', code: 'remedial_law.civil_procedure', name: 'Civil Procedure (Rules of Court, Rules 1\u201371)', displayOrder: 1 },
  { parentCode: 'remedial_law', code: 'remedial_law.special_proceedings', name: 'Special Proceedings', displayOrder: 2 },
  { parentCode: 'remedial_law', code: 'remedial_law.evidence', name: 'Evidence', displayOrder: 3 },
  { parentCode: 'remedial_law', code: 'remedial_law.criminal_procedure', name: 'Criminal Procedure', displayOrder: 4 },

  // legal_ethics
  { parentCode: 'legal_ethics', code: 'legal_ethics.professional_responsibility', name: 'Code of Professional Responsibility and Accountability', displayOrder: 1 },
  { parentCode: 'legal_ethics', code: 'legal_ethics.judicial_ethics', name: 'New Code of Judicial Conduct', displayOrder: 2 },
  { parentCode: 'legal_ethics', code: 'legal_ethics.practical_exercises', name: 'Practical Exercises (drafting pleadings, notarial acts, bar forms)', displayOrder: 3 },
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

export async function seedSubjects(prisma: PrismaClient): Promise<void> {
  // 1. Upsert all subjects (study_8 + bar_admin_6)
  const allSubjects = [...STUDY_8_SUBJECTS, ...BAR_ADMIN_6_SUBJECTS];

  for (const seed of allSubjects) {
    await prisma.subject.upsert({
      where: {
        code_taxonomyVersion: {
          code: seed.code,
          taxonomyVersion: seed.taxonomyVersion,
        },
      },
      update: {
        name: seed.name,
        weightPercent: seed.weightPercent,
        effectiveFrom: seed.effectiveFrom,
        effectiveTo: seed.effectiveTo,
        displayOrder: seed.displayOrder,
        description: seed.description,
      },
      create: {
        code: seed.code,
        name: seed.name,
        taxonomyVersion: seed.taxonomyVersion,
        weightPercent: seed.weightPercent,
        effectiveFrom: seed.effectiveFrom,
        effectiveTo: seed.effectiveTo,
        displayOrder: seed.displayOrder,
        description: seed.description,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`  \u2713 Seeded ${allSubjects.length} subjects`);

  // 2. Upsert sub-topics (need parent subject IDs)
  // Build a lookup map: code → subject.id for study_8 subjects
  const study8Subjects = await prisma.subject.findMany({
    where: { taxonomyVersion: 'study_8' },
    select: { id: true, code: true },
  });
  const study8Map = new Map(study8Subjects.map((s) => [s.code, s.id]));

  let topicCount = 0;
  for (const topic of TOPIC_SEEDS) {
    const subjectId = study8Map.get(topic.parentCode);
    if (!subjectId) {
      // eslint-disable-next-line no-console
      console.warn(`  ! Skipping topic ${topic.code}: parent subject ${topic.parentCode} not found`);
      continue;
    }

    await prisma.subjectTopic.upsert({
      where: {
        subjectId_code: {
          subjectId,
          code: topic.code,
        },
      },
      update: {
        name: topic.name,
        displayOrder: topic.displayOrder,
      },
      create: {
        subjectId,
        code: topic.code,
        name: topic.name,
        displayOrder: topic.displayOrder,
      },
    });
    topicCount++;
  }

  // eslint-disable-next-line no-console
  console.log(`  \u2713 Seeded ${topicCount} topics`);

  // 3. Upsert equivalence mappings
  // Build a lookup map for bar_admin_6 subjects
  const barAdmin6Subjects = await prisma.subject.findMany({
    where: { taxonomyVersion: 'bar_admin_6' },
    select: { id: true, code: true },
  });
  const barAdmin6Map = new Map(barAdmin6Subjects.map((s) => [s.code, s.id]));

  let eqCount = 0;
  for (const eq of EQUIVALENCE_SEEDS) {
    const studySubjectId = study8Map.get(eq.studyCode);
    const barAdminSubjectId = barAdmin6Map.get(eq.barAdminCode);

    if (!studySubjectId || !barAdminSubjectId) {
      // eslint-disable-next-line no-console
      console.warn(
        `  ! Skipping equivalence ${eq.studyCode} <-> ${eq.barAdminCode}: ` +
          `study=${studySubjectId ?? 'missing'}, barAdmin=${barAdminSubjectId ?? 'missing'}`,
      );
      continue;
    }

    await prisma.subjectEquivalence.upsert({
      where: {
        studySubjectId_barAdminSubjectId: {
          studySubjectId,
          barAdminSubjectId,
        },
      },
      update: {
        relationship: eq.relationship,
        notes: eq.notes,
      },
      create: {
        studySubjectId,
        barAdminSubjectId,
        relationship: eq.relationship,
        notes: eq.notes,
      },
    });
    eqCount++;
  }

  // eslint-disable-next-line no-console
  console.log(`  \u2713 Seeded ${eqCount} equivalences`);

  // eslint-disable-next-line no-console
  console.log(`  Seeded ${allSubjects.length} subjects, ${topicCount} topics, ${eqCount} equivalences`);
}

// Allow running standalone: `npx ts-node prisma/seed-subjects.ts`
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient();
  seedSubjects(prisma)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
