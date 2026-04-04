/**
 * Digests Seed Data — 6 digests linked to Phase 1 legal documents,
 * with provenance records, digest reviews, and doctrine extracts.
 *
 * Digests:
 *   1. People v. Santos — official_pipeline, approved, public_editorial
 *   2. Agabon v. NLRC — official_pipeline, approved, public_editorial
 *   3. RA 10173 — official_pipeline, ai_generated (pending review), org
 *   4. People v. Santos — user_scan, private, draft (student-generated)
 *   5. Civil Code Obligations — admin_generated, approved, public_editorial
 *   6. Rules of Court Rule 16 — official_pipeline, needs_human_review, org
 */

import { PrismaClient } from '@prisma/client';
import { SeededUsers } from './dev-users';
import { SeededDocuments } from './legal-documents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DigestSeed {
  docKey: keyof SeededDocuments;
  userKey: keyof Omit<SeededUsers, 'orgId'>;
  sourceOrigin: string;
  digestType: string;
  title: string;
  summary: string;
  facts: string;
  issues: string;
  ruling: string;
  doctrine: string;
  dispositive: string;
  petitionerArguments: string | null;
  respondentArguments: string | null;
  citedAuthorities: string[];
  confidenceScore: number;
  reviewStatus: string;
  visibility: string;
  /** Section types to link provenance records to */
  provenanceSections: string[];
}

export interface SeededDigests {
  peopleVSantosDigest: { id: string };
  agabonDigest: { id: string };
  ra10173Digest: { id: string };
  studentScanDigest: { id: string };
  civilCodeDigest: { id: string };
  rule16Digest: { id: string };
}

// ---------------------------------------------------------------------------
// Digest Data
// ---------------------------------------------------------------------------

const DIGESTS: DigestSeed[] = [
  // =========================================================================
  // 1. People v. Santos — Official pipeline, approved
  // =========================================================================
  {
    docKey: 'peopleVSantos',
    userKey: 'admin',
    sourceOrigin: 'official_pipeline',
    digestType: 'case_digest',
    title: 'Digest: People v. Santos (G.R. No. 147678)',
    summary:
      'The Supreme Court affirmed the conviction of the accused for murder qualified by treachery. The Court held that an attack from behind on an unsuspecting victim constitutes treachery. The plea of self-defense failed because the accused could not establish unlawful aggression by the victim.',
    facts:
      'On June 15, 2001, the accused Roberto Santos stabbed Juan Reyes from behind without warning in Barangay San Lorenzo, Quezon City. Witness Maria Clara positively identified the accused. The victim died of hemorrhagic shock from multiple stab wounds. The accused claimed self-defense but no weapon was recovered from the victim.',
    issues:
      'I. Whether treachery was sufficiently proven.\nII. Whether the trial court erred in crediting prosecution witness Maria Clara.\nIII. Whether self-defense was established.',
    ruling:
      'The Court denied the appeal. Treachery was established — the attack was from behind, sudden, and on an unsuspecting victim. The trial court\'s credibility assessment was upheld. Self-defense failed because no unlawful aggression was proven; no weapon was found on the victim, and the wound locations were inconsistent with a defensive posture.',
    doctrine:
      'Treachery requires proof that: (1) the means of execution gave the victim no opportunity to defend or retaliate; and (2) the means were deliberately adopted. An attack from behind on an unarmed, unsuspecting victim constitutes treachery. Self-defense shifts the burden to the accused to prove all three requisites under Article 11(1) RPC.',
    dispositive:
      'WHEREFORE, the conviction for Murder is AFFIRMED with MODIFICATION. The accused is sentenced to reclusion perpetua without parole eligibility and ordered to pay civil indemnity (Php 75,000), moral damages (Php 50,000), temperate damages (Php 25,000), and exemplary damages (Php 30,000), all with 6% interest per annum.',
    petitionerArguments: null,
    respondentArguments: null,
    citedAuthorities: [
      'People v. Cagoco, G.R. No. 148853 (2002)',
      'People v. Mateo, G.R. No. 147678-87 (2004)',
      'Article 11(1), Revised Penal Code',
    ],
    confidenceScore: 0.92,
    reviewStatus: 'approved',
    visibility: 'public_editorial',
    provenanceSections: ['facts', 'issues', 'ruling', 'doctrine', 'dispositive'],
  },

  // =========================================================================
  // 2. Agabon v. NLRC — Official pipeline, approved
  // =========================================================================
  {
    docKey: 'agabonVNlrc',
    userKey: 'admin',
    sourceOrigin: 'official_pipeline',
    digestType: 'case_digest',
    title: 'Digest: Agabon v. NLRC (G.R. No. 158693)',
    summary:
      'The Supreme Court en banc abandoned the Serrano doctrine, holding that a dismissal for just cause but without procedural due process is valid but entitles the employee to nominal damages. The Agabon doctrine distinguishes substantive validity from procedural compliance in termination cases.',
    facts:
      'Petitioners Virgilio and Jenny Agabon, gypsum board installers at Riviera Home Improvements, were dismissed on February 23, 1999, allegedly for abandonment. They filed an illegal dismissal complaint. The Labor Arbiter found illegal dismissal; the NLRC reversed, finding valid cause but procedural non-compliance. The case was elevated to the Supreme Court en banc to re-examine the Serrano doctrine.',
    issues:
      'I. Whether the petitioners were dismissed for just cause.\nII. Whether the employer complied with procedural due process.\nIII. What is the effect of failure to comply with procedural due process when dismissal is for just cause.',
    ruling:
      'The Court found valid dismissal for abandonment (just cause). However, Riviera failed to comply with the twin notice requirement. The Court ABANDONED the Serrano doctrine: non-compliance with procedural due process does NOT render a substantively valid dismissal illegal. Instead, the employer must pay nominal damages (Php 30,000 for just cause; Php 50,000 for authorized cause).',
    doctrine:
      'The Agabon doctrine: where dismissal is for a just or authorized cause but the employer failed to observe procedural due process (twin notice rule), the dismissal remains valid. The employer is liable for nominal damages for violation of the employee\'s right to procedural due process. This abandons the Serrano ruling that equated procedural deficiency with illegality.',
    dispositive:
      'WHEREFORE, the petition is DENIED. The CA decision finding valid dismissal for abandonment is AFFIRMED. Riviera is ORDERED to pay each petitioner Php 30,000.00 as nominal damages. The Serrano doctrine is ABANDONED insofar as it declares a dismissal for just/authorized cause without due process as ineffectual.',
    petitionerArguments:
      'The petitioners argued that they were illegally dismissed without just cause and without compliance with procedural due process. They contended that they did not abandon their work and that the employer failed to serve the required twin notices.',
    respondentArguments:
      'Riviera contended that the petitioners were validly dismissed for abandonment of work, as they failed to report for work beginning February 23, 1999, despite verbal and written notices to return.',
    citedAuthorities: [
      'Serrano v. NLRC, G.R. No. 117040 (2000)',
      'Article 297, Labor Code (formerly Article 282)',
      'Article 292(b), Labor Code (formerly Article 277(b))',
    ],
    confidenceScore: 0.95,
    reviewStatus: 'approved',
    visibility: 'public_editorial',
    provenanceSections: ['facts', 'issues', 'ruling', 'doctrine', 'dispositive'],
  },

  // =========================================================================
  // 3. RA 10173 (Data Privacy Act) — AI-generated, pending review
  // =========================================================================
  {
    docKey: 'ra10173',
    userKey: 'admin',
    sourceOrigin: 'official_pipeline',
    digestType: 'statute_summary',
    title: 'Digest: Data Privacy Act of 2012 (RA 10173)',
    summary:
      'Republic Act No. 10173, the Data Privacy Act of 2012, establishes a comprehensive framework for the protection of personal information in both government and private sector systems. It creates the National Privacy Commission, defines data subject rights, and imposes criminal penalties for unauthorized processing.',
    facts:
      'Enacted on August 15, 2012, RA 10173 was the Philippines\' first comprehensive data privacy legislation. It established the National Privacy Commission as an independent regulatory body and introduced principles of transparency, legitimate purpose, and proportionality in personal data processing.',
    issues:
      'Key regulatory areas: (1) scope of application including extraterritorial reach; (2) criteria for lawful processing of personal and sensitive information; (3) rights of data subjects; (4) security obligations of information controllers; (5) criminal penalties for unauthorized processing and data breaches.',
    ruling:
      'The Act provides for lawful processing based on consent, contractual necessity, legal obligation, vital interests, national emergency, and legitimate interests. Sensitive personal information receives heightened protection. Penalties range from 1-6 years imprisonment and Php 500,000 to Php 4,000,000 in fines.',
    doctrine:
      'RA 10173 enshrines the principles of: (1) transparency — data subjects must be informed of processing; (2) legitimate purpose — data must be collected for declared, specific purposes; (3) proportionality — processing must be adequate and not excessive. The National Privacy Commission has enforcement authority including investigation, compliance orders, and penalty recommendations.',
    dispositive:
      'This Act takes effect fifteen (15) days after its complete publication in at least two (2) newspapers of general circulation. (Section 36)',
    petitionerArguments: null,
    respondentArguments: null,
    citedAuthorities: [
      'Republic Act No. 10173 (2012)',
      'Article III, Section 3, 1987 Philippine Constitution (Privacy of Communication)',
    ],
    confidenceScore: 0.78,
    reviewStatus: 'ai_generated',
    visibility: 'org',
    provenanceSections: [
      'declaration_of_policy',
      'definition',
      'scope',
      'provision_4',
      'provision_5',
      'provision_7',
      'provision_8',
      'provision_9',
    ],
  },

  // =========================================================================
  // 4. People v. Santos — Student scan, private, draft
  // =========================================================================
  {
    docKey: 'peopleVSantos',
    userKey: 'student',
    sourceOrigin: 'user_scan',
    digestType: 'study_digest',
    title: 'My Notes: People v. Santos — Self-Defense & Treachery',
    summary:
      'Study digest for Criminal Law review. Key case on treachery as qualifying circumstance and burden of proof in self-defense claims.',
    facts:
      'Accused stabbed victim from behind without warning. Witness saw everything from 5 meters away. Accused claimed self-defense but no weapon found on victim.',
    issues:
      '1. Was treachery proven? YES\n2. Was witness credible? YES\n3. Was self-defense valid? NO',
    ruling:
      'Conviction affirmed. Attack from behind = treachery. Trial court credibility assessment respected on appeal. Self-defense burden shifts to accused — must prove all 3 elements of Art. 11(1) RPC.',
    doctrine:
      'Treachery = sudden attack on unsuspecting victim with no chance to defend. Self-defense requires: (1) unlawful aggression, (2) reasonable necessity, (3) lack of provocation.',
    dispositive:
      'Guilty of murder, reclusion perpetua, damages totaling Php 180,000.',
    petitionerArguments: null,
    respondentArguments: null,
    citedAuthorities: [
      'Article 11(1), Revised Penal Code',
      'Article 248, Revised Penal Code (Murder)',
    ],
    confidenceScore: 0.55,
    reviewStatus: 'draft',
    visibility: 'private',
    provenanceSections: ['facts', 'issues', 'ruling', 'doctrine'],
  },

  // =========================================================================
  // 5. Civil Code Obligations — Admin-generated, approved
  // =========================================================================
  {
    docKey: 'civilCodeObligations',
    userKey: 'editor',
    sourceOrigin: 'admin_generated',
    digestType: 'statute_summary',
    title: 'Digest: Civil Code — Book IV, Title I: Obligations (Arts. 1156-1304)',
    summary:
      'Comprehensive summary of the law on obligations under the Philippine Civil Code, covering definitions, sources, types (pure, conditional, with a period, alternative, joint/solidary), performance, and modes of extinguishment.',
    facts:
      'Book IV, Title I of the Civil Code of the Philippines codifies the general law on obligations. Article 1156 defines an obligation as a juridical necessity to give, to do, or not to do. Article 1157 enumerates the five sources: law, contracts, quasi-contracts, delicts, and quasi-delicts.',
    issues:
      'Key topics: (1) nature and sources of obligations; (2) types of obligations (pure, conditional, with a term, alternative, joint and solidary); (3) performance and breach; (4) modes of extinguishment (payment, loss, condonation, confusion, compensation, novation).',
    ruling:
      'Articles 1156-1304 establish the foundational rules. Obligations from contracts have the force of law (Art. 1159). Fraud, negligence, delay, or contravention of the obligation make the obligor liable for damages (Art. 1170). Fortuitous events generally excuse performance (Art. 1174). Obligations are extinguished by payment, loss, condonation, confusion, compensation, or novation (Art. 1231).',
    doctrine:
      'The Civil Code regime on obligations is built on good faith (Art. 1159), diligence of a good father of a family (Art. 1163), and the principle that those guilty of fraud, negligence, or delay are liable for damages (Art. 1170). Solidary liability arises only by express stipulation, by law, or by the nature of the obligation (Art. 1207).',
    dispositive:
      'The Civil Code of the Philippines was enacted by Republic Act No. 386 and took effect on August 30, 1950.',
    petitionerArguments: null,
    respondentArguments: null,
    citedAuthorities: [
      'Republic Act No. 386 (Civil Code of the Philippines)',
      'Articles 1156-1304, Civil Code',
    ],
    confidenceScore: 0.88,
    reviewStatus: 'approved',
    visibility: 'public_editorial',
    provenanceSections: [
      'article_0',
      'article_1',
      'article_2',
      'article_4',
      'article_5',
      'article_9',
      'article_11',
    ],
  },

  // =========================================================================
  // 6. Rules of Court Rule 16 — Needs human review
  // =========================================================================
  {
    docKey: 'rulesOfCourtRule16',
    userKey: 'admin',
    sourceOrigin: 'official_pipeline',
    digestType: 'statute_summary',
    title: 'Digest: Rules of Court — Rule 16: Motion to Dismiss',
    summary:
      'Rule 16 governs motions to dismiss in Philippine civil procedure. It enumerates 10 grounds for dismissal, establishes the hearing and resolution process, prescribes the time to plead after denial, and distinguishes between dismissals that bar and do not bar refiling.',
    facts:
      'Rule 16 of the Rules of Court, promulgated by the Supreme Court effective July 1, 1997, provides the procedural framework for pre-answer motions to dismiss in civil cases. It is part of the Rules of Court governing procedure in the regular courts.',
    issues:
      'Key provisions: (1) ten grounds for dismissal (jurisdiction, venue, capacity, litis pendentia, res judicata, prescription, failure to state cause of action, etc.); (2) hearing and resolution procedure; (3) time to plead after denial; (4) which dismissals bar refiling vs. which do not.',
    ruling:
      'Grounds (f), (h), and (i) bar refiling: prior judgment/statute of limitations, claim extinguished, and statute of frauds. Grounds (a)-(e) do not bar refiling: jurisdiction, venue, capacity, and litis pendentia. If no motion to dismiss is filed, grounds may be raised as affirmative defenses in the answer (Section 6).',
    doctrine:
      'Rule 16 establishes the procedural distinction between dilatory and peremptory grounds for dismissal. Peremptory grounds (res judicata, prescription, extinguishment) produce a bar to refiling. Dilatory grounds (jurisdiction, venue, capacity) allow the plaintiff to refile after curing the defect.',
    dispositive:
      'Rule 16 of the Rules of Court, as amended, effective July 1, 1997.',
    petitionerArguments: null,
    respondentArguments: null,
    citedAuthorities: [
      'Rules of Court, Rule 16',
      'Rules of Court, Rule 11 (Time to Plead)',
    ],
    confidenceScore: 0.65,
    reviewStatus: 'needs_human_review',
    visibility: 'org',
    provenanceSections: ['section_0', 'section_2', 'section_4', 'section_5'],
  },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedDigests(
  prisma: PrismaClient,
  users: SeededUsers,
  docs: SeededDocuments,
): Promise<SeededDigests> {
  console.log('\n--- Seeding digests ---');

  const result = {} as SeededDigests;
  const digestKeys = [
    'peopleVSantosDigest',
    'agabonDigest',
    'ra10173Digest',
    'studentScanDigest',
    'civilCodeDigest',
    'rule16Digest',
  ];

  let totalProvenance = 0;

  for (let i = 0; i < DIGESTS.length; i++) {
    const seed = DIGESTS[i];
    const key = digestKeys[i];
    if (!seed || !key) continue;
    const doc = docs[seed.docKey];
    const userId = users[seed.userKey].id;

    // Check if digest already exists (by title + userId + legalDocumentId)
    const existing = await prisma.digest.findFirst({
      where: {
        title: seed.title,
        userId,
        legalDocumentId: doc.id,
      },
    });

    let digest;
    const data = {
      legalDocumentId: doc.id,
      organizationId: users.orgId,
      userId,
      sourceOrigin: seed.sourceOrigin,
      title: seed.title,
      digestType: seed.digestType,
      summary: seed.summary,
      facts: seed.facts,
      issues: seed.issues,
      ruling: seed.ruling,
      doctrine: seed.doctrine,
      dispositive: seed.dispositive,
      petitionerArguments: seed.petitionerArguments,
      respondentArguments: seed.respondentArguments,
      citedAuthoritiesJson: seed.citedAuthorities,
      confidenceScore: seed.confidenceScore,
      reviewStatus: seed.reviewStatus,
      visibility: seed.visibility,
    };

    if (existing) {
      digest = await prisma.digest.update({
        where: { id: existing.id },
        data,
      });
    } else {
      digest = await prisma.digest.create({ data });
    }

    // Provenance records — link digest fields to source sections
    await prisma.provenanceRecord.deleteMany({
      where: { entityType: 'digest', entityId: digest.id },
    });

    for (const sectionKey of seed.provenanceSections) {
      const sectionId = doc.sectionIds[sectionKey];
      if (sectionId) {
        await prisma.provenanceRecord.create({
          data: {
            entityType: 'digest',
            entityId: digest.id,
            sourceDocumentId: doc.id,
            sourceSectionId: sectionId,
            provenanceType: 'derived',
          },
        });
        totalProvenance++;
      }
    }

    result[key as keyof SeededDigests] = { id: digest.id };
    console.log(
      `  Digest: ${seed.title.substring(0, 50)}... (${seed.reviewStatus}, ${seed.visibility})`,
    );
  }

  console.log(`  ${DIGESTS.length} digests seeded, ${totalProvenance} provenance records.`);

  // -------------------------------------------------------------------------
  // Digest Reviews — editor reviews the approved digests
  // -------------------------------------------------------------------------
  console.log('  Seeding digest reviews...');

  const reviewTargets = [
    {
      digestId: result['peopleVSantosDigest'].id,
      verdict: 'approve',
      truthfulness: 0.95,
      completeness: 0.9,
      citationAccuracy: 0.92,
      notes: 'Accurate digest. Treachery elements well-captured. Dispositive amounts verified against source.',
    },
    {
      digestId: result['agabonDigest'].id,
      verdict: 'approve',
      truthfulness: 0.98,
      completeness: 0.95,
      citationAccuracy: 0.97,
      notes: 'Excellent digest. Agabon doctrine clearly articulated. Serrano abandonment correctly noted.',
    },
    {
      digestId: result['civilCodeDigest'].id,
      verdict: 'approve',
      truthfulness: 0.9,
      completeness: 0.85,
      citationAccuracy: 0.88,
      notes: 'Good statutory summary. Could expand on alternative and facultative obligations in future revision.',
    },
  ];

  for (const review of reviewTargets) {
    // Delete existing reviews for this digest by this reviewer
    await prisma.digestReview.deleteMany({
      where: {
        digestId: review.digestId,
        reviewerUserId: users.editor.id,
      },
    });

    await prisma.digestReview.create({
      data: {
        digestId: review.digestId,
        reviewerUserId: users.editor.id,
        verdict: review.verdict,
        notes: review.notes,
        truthfulnessScore: review.truthfulness,
        completenessScore: review.completeness,
        citationAccuracyScore: review.citationAccuracy,
      },
    });
  }

  console.log(`  ${reviewTargets.length} digest reviews created.`);

  // -------------------------------------------------------------------------
  // Doctrine Extracts — from the two approved case digests
  // -------------------------------------------------------------------------
  console.log('  Seeding doctrine extracts...');

  const doctrineData = [
    {
      legalDocumentId: docs.peopleVSantos.id,
      digestId: result['peopleVSantosDigest'].id,
      sourceSectionId: docs.peopleVSantos.sectionIds['Doctrine'],
      text: 'Treachery as a qualifying circumstance for murder requires proof that: (1) the means of execution employed gave the person attacked no opportunity to defend himself or retaliate; and (2) the means of execution were deliberately or consciously adopted.',
      normalizedText: 'treachery qualifying circumstance murder means execution no opportunity defend retaliate deliberately adopted',
      doctrineType: 'criminal_law',
      confidence: 0.93,
      reviewStatus: 'approved',
    },
    {
      legalDocumentId: docs.peopleVSantos.id,
      digestId: result['peopleVSantosDigest'].id,
      sourceSectionId: docs.peopleVSantos.sectionIds['Ruling'],
      text: 'When the accused invokes self-defense, the burden of evidence shifts to him. He must prove by clear and convincing evidence all three elements under Article 11(1) of the Revised Penal Code: unlawful aggression, reasonable necessity, and lack of sufficient provocation.',
      normalizedText: 'self defense burden evidence shifts accused prove unlawful aggression reasonable necessity lack provocation',
      doctrineType: 'criminal_law',
      confidence: 0.91,
      reviewStatus: 'approved',
    },
    {
      legalDocumentId: docs.agabonVNlrc.id,
      digestId: result['agabonDigest'].id,
      sourceSectionId: docs.agabonVNlrc.sectionIds['Doctrine'],
      text: 'Where the dismissal is for a just or authorized cause but the employer failed to comply with the procedural due process requirement (twin notice rule), the dismissal is not rendered illegal. The termination remains valid. However, the employer is liable for nominal damages.',
      normalizedText: 'dismissal just authorized cause employer procedural due process twin notice rule valid nominal damages',
      doctrineType: 'labor_law',
      confidence: 0.96,
      reviewStatus: 'approved',
    },
    {
      legalDocumentId: docs.agabonVNlrc.id,
      digestId: result['agabonDigest'].id,
      sourceSectionId: docs.agabonVNlrc.sectionIds['Ruling'],
      text: 'The distinction between substantive and procedural due process in termination cases is firmly established: the former concerns the validity of the ground for dismissal, while the latter concerns the manner of effecting the dismissal.',
      normalizedText: 'distinction substantive procedural due process termination validity ground dismissal manner effecting',
      doctrineType: 'labor_law',
      confidence: 0.94,
      reviewStatus: 'approved',
    },
  ];

  // Clean existing doctrine extracts for these documents
  const docIdsForDoctrine = [docs.peopleVSantos.id, docs.agabonVNlrc.id];
  await prisma.doctrineExtract.deleteMany({
    where: { legalDocumentId: { in: docIdsForDoctrine } },
  });

  for (const d of doctrineData) {
    await prisma.doctrineExtract.create({ data: d });
  }

  console.log(`  ${doctrineData.length} doctrine extracts created.`);

  return result;
}
