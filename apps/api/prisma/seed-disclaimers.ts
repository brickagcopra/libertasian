/**
 * Seed canonical content_disclaimers rows.
 *
 * Source of truth: §8.2 and §8.6 of
 * `docs/architecture/corpus-platform-target-architecture.md`.
 *
 * Authorship note: the disclaimer text below is authored by Claude (prod,
 * acting as software architect for this project), reviewed by the user, not
 * by counsel. The "LIBERTASIAN is an educational research platform. Nothing
 * it generates or retrieves is legal advice." sentence is load-bearing and
 * must appear in every row.
 *
 * Four of the five rows (ai_digest, ai_mcq, sample_pleading, sample_contract)
 * are verbatim copies of the canonical drafts in §8.2. The fifth
 * (ai_suggested_bar_answer) was authored for this seed following the
 * structural pattern described at the end of §8.2 — bold one-line framing,
 * paragraph on how the content was produced, paragraph on what it is not,
 * closing load-bearing sentence — because §8.2 describes the pattern but
 * does not ship the bodyHtml verbatim for that class.
 *
 * Idempotent: upsert by `contentClass`. Re-running refreshes text without
 * duplicating rows. Version is set explicitly (not auto-incremented here).
 */

import type { PrismaClient } from '@prisma/client';

export interface DisclaimerSeed {
  contentClass: string;
  bodyHtml: string;
  bodyPlain: string;
  version: number;
  isActive: boolean;
  authorNote: string;
}

const COMMON_AUTHOR_NOTE =
  'Authored by Claude (prod) as software architect, reviewed by user, not by counsel. ' +
  'Canonical text from §8.2 of docs/architecture/corpus-platform-target-architecture.md. ' +
  'The "not legal advice" closing sentence is load-bearing, not ornamental.';

const AUTHOR_NOTE_PATTERN_ONLY =
  'Authored by Claude (prod) as software architect, reviewed by user, not by counsel. ' +
  'Structural pattern from §8.2 of docs/architecture/corpus-platform-target-architecture.md ' +
  '(bold framing → how produced → what it is not → load-bearing closing sentence). ' +
  'bodyHtml verbatim is not in §8.2 for this class; drafted at seed-data authoring time ' +
  'per the instruction at the end of §8.2.';

export const DISCLAIMER_SEEDS: DisclaimerSeed[] = [
  // ------------------------------------------------------------------
  // ai_digest — verbatim from §8.2 "ai_digest.v1 — bodyHtml draft"
  // ------------------------------------------------------------------
  {
    contentClass: 'ai_digest',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>AI-generated case digest — educational purposes only.</strong></p>\n' +
      '<p>This digest was produced by an AI system reading the decision text cited below. It is a\n' +
      'study aid, not legal advice, not a substitute for reading the full decision, and not a\n' +
      "statement by LIBERTASIAN, its operators, or any court about the meaning of the ruling.</p>\n" +
      '<p>The AI may have summarised, paraphrased, or reorganised the court\'s language. Before\n' +
      'relying on any proposition stated in this digest — especially for a case, brief, exam\n' +
      'answer, or client matter — read the full decision at the linked source and verify that\n' +
      'the facts, holding, doctrine, and dispositive portion correspond to what appears here.</p>\n' +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'AI-generated case digest — educational purposes only.\n\n' +
      'This digest was produced by an AI system reading the decision text cited below. It is a ' +
      'study aid, not legal advice, not a substitute for reading the full decision, and not a ' +
      "statement by LIBERTASIAN, its operators, or any court about the meaning of the ruling.\n\n" +
      'The AI may have summarised, paraphrased, or reorganised the court\'s language. Before ' +
      'relying on any proposition stated in this digest — especially for a case, brief, exam ' +
      'answer, or client matter — read the full decision at the linked source and verify that ' +
      'the facts, holding, doctrine, and dispositive portion correspond to what appears here.\n\n' +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: COMMON_AUTHOR_NOTE,
  },

  // ------------------------------------------------------------------
  // ai_mcq — verbatim from §8.2 "ai_mcq.v1 — bodyHtml draft"
  // ------------------------------------------------------------------
  {
    contentClass: 'ai_mcq',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>AI-generated multiple-choice question — bar review study aid only.</strong></p>\n' +
      '<p>This question was written by an AI system based on the source material cited below. It\n' +
      'is intended as bar review practice. It is <em>not</em> an actual Philippine Bar Exam\n' +
      'question, is not endorsed by the Supreme Court of the Philippines or any bar review\n' +
      'school, and does not guarantee coverage of what the actual exam tests.</p>\n' +
      '<p>The stem, answer, and distractors have been checked by automated validators against the\n' +
      'source text, but automated validation is not the same as expert review. Treat the correct\n' +
      'answer as a starting point for study, not as a final statement of Philippine law.</p>\n' +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'AI-generated multiple-choice question — bar review study aid only.\n\n' +
      'This question was written by an AI system based on the source material cited below. It ' +
      'is intended as bar review practice. It is NOT an actual Philippine Bar Exam ' +
      'question, is not endorsed by the Supreme Court of the Philippines or any bar review ' +
      'school, and does not guarantee coverage of what the actual exam tests.\n\n' +
      'The stem, answer, and distractors have been checked by automated validators against the ' +
      'source text, but automated validation is not the same as expert review. Treat the correct ' +
      'answer as a starting point for study, not as a final statement of Philippine law.\n\n' +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: COMMON_AUTHOR_NOTE,
  },

  // ------------------------------------------------------------------
  // ai_suggested_bar_answer — authored for seed data per §8.2 pattern
  // (§8.2 ships the short text for this class but not the bodyHtml)
  // ------------------------------------------------------------------
  {
    contentClass: 'ai_suggested_bar_answer',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>AI-generated model answer to a past bar exam question — study reference only.</strong></p>\n' +
      '<p>This suggested answer was written by an AI system based on the bar exam question cited\n' +
      'below and the Philippine legal authorities it purports to apply. It is a study aid for\n' +
      'bar reviewees and law students. It is <em>not</em> the official answer, is not endorsed\n' +
      'by the Supreme Court of the Philippines, the Committee on Bar Examinations, or any bar\n' +
      'review school, and should not be treated as a statement of how an examiner would have\n' +
      'graded a real sitting.</p>\n' +
      '<p>The reasoning, citations, and conclusions in this answer have been checked by automated\n' +
      'validators against the source text, but automated validation is not the same as expert\n' +
      'review. Before relying on any proposition — especially for your own exam preparation —\n' +
      'read the cited authorities in full and compare with your casebook, review notes, and\n' +
      "instructor's guidance.</p>\n" +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'AI-generated model answer to a past bar exam question — study reference only.\n\n' +
      'This suggested answer was written by an AI system based on the bar exam question cited ' +
      'below and the Philippine legal authorities it purports to apply. It is a study aid for ' +
      'bar reviewees and law students. It is NOT the official answer, is not endorsed by the ' +
      'Supreme Court of the Philippines, the Committee on Bar Examinations, or any bar review ' +
      'school, and should not be treated as a statement of how an examiner would have graded a ' +
      'real sitting.\n\n' +
      'The reasoning, citations, and conclusions in this answer have been checked by automated ' +
      'validators against the source text, but automated validation is not the same as expert ' +
      'review. Before relying on any proposition — especially for your own exam preparation — ' +
      'read the cited authorities in full and compare with your casebook, review notes, and ' +
      "instructor's guidance.\n\n" +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: AUTHOR_NOTE_PATTERN_ONLY,
  },

  // ------------------------------------------------------------------
  // ai_essay_model_answer — authored for seed data per §8.2 pattern
  // (§5.4 essay prompt derivative type — disclaimer for AI-generated
  // essay model answers and rubrics)
  // ------------------------------------------------------------------
  {
    contentClass: 'ai_essay_model_answer',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>AI-generated essay model answer — study reference only.</strong></p>\n' +
      '<p>This essay prompt and model answer were generated by an AI system based on the source\n' +
      'material cited below. They are intended as bar review and law school practice aids. They\n' +
      'are <em>not</em> actual Philippine Bar Exam questions or official model answers, are not\n' +
      'endorsed by the Supreme Court of the Philippines, the Committee on Bar Examinations, or\n' +
      'any bar review school.</p>\n' +
      '<p>The model answer, rubric, and scoring criteria have been checked by automated validators\n' +
      'against the source text, but automated validation is not the same as expert review. Before\n' +
      'relying on any legal proposition — especially for your own exam preparation — read the\n' +
      'cited authorities in full and compare with your casebook, review notes, and instructor\'s\n' +
      'guidance.</p>\n' +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'AI-generated essay model answer — study reference only.\n\n' +
      'This essay prompt and model answer were generated by an AI system based on the source ' +
      'material cited below. They are intended as bar review and law school practice aids. They ' +
      'are NOT actual Philippine Bar Exam questions or official model answers, are not endorsed ' +
      'by the Supreme Court of the Philippines, the Committee on Bar Examinations, or any bar ' +
      'review school.\n\n' +
      'The model answer, rubric, and scoring criteria have been checked by automated validators ' +
      'against the source text, but automated validation is not the same as expert review. Before ' +
      'relying on any legal proposition — especially for your own exam preparation — read the ' +
      'cited authorities in full and compare with your casebook, review notes, and instructor\'s ' +
      'guidance.\n\n' +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: AUTHOR_NOTE_PATTERN_ONLY,
  },

  // ------------------------------------------------------------------
  // sample_pleading — verbatim from §8.2 "sample_pleading.v1 — bodyHtml draft"
  // ------------------------------------------------------------------
  {
    contentClass: 'sample_pleading',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>Template pleading — illustrative only. Not a court-ready document.</strong></p>\n' +
      '<p>This sample pleading was generated by an AI system as an educational illustration of\n' +
      'Philippine pleading structure. It contains bracketed placeholders (e.g. <code>[CLIENT\n' +
      'NAME]</code>, <code>[VENUE]</code>) that must be filled in, and its citations should be\n' +
      'independently verified against the current Rules of Court and applicable jurisprudence.</p>\n' +
      '<p>This template is <em>not</em>, and must not be used as, a finished pleading for an\n' +
      'actual case. It has not been reviewed by a Philippine-licensed attorney. It is not a\n' +
      'substitute for consulting one. Filing an unreviewed pleading based on this template may\n' +
      'prejudice your case and may expose non-lawyers to unauthorised-practice-of-law\n' +
      'liability.</p>\n' +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'Template pleading — illustrative only. Not a court-ready document.\n\n' +
      'This sample pleading was generated by an AI system as an educational illustration of ' +
      'Philippine pleading structure. It contains bracketed placeholders (e.g. [CLIENT NAME], ' +
      '[VENUE]) that must be filled in, and its citations should be independently verified ' +
      'against the current Rules of Court and applicable jurisprudence.\n\n' +
      'This template is NOT, and must not be used as, a finished pleading for an actual case. ' +
      'It has not been reviewed by a Philippine-licensed attorney. It is not a substitute for ' +
      'consulting one. Filing an unreviewed pleading based on this template may prejudice your ' +
      'case and may expose non-lawyers to unauthorised-practice-of-law liability.\n\n' +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: COMMON_AUTHOR_NOTE,
  },

  // ------------------------------------------------------------------
  // sample_contract — verbatim from §8.2 "sample_contract.v1 — bodyHtml draft"
  // ------------------------------------------------------------------
  {
    contentClass: 'sample_contract',
    version: 1,
    isActive: true,
    bodyHtml:
      '<p><strong>Template contract — illustrative only. Not a signable instrument.</strong></p>\n' +
      '<p>This sample contract was generated by an AI system as an educational illustration of\n' +
      'Philippine contract structure, grounded in the Civil Code and related special laws. It\n' +
      'contains bracketed placeholders for parties, consideration, dates, and jurisdiction-\n' +
      'specific terms, and its statutory citations should be verified against the current text of\n' +
      'the Civil Code and any applicable special law.</p>\n' +
      '<p>This template is <em>not</em>, and must not be used as, a finalised contract. It has\n' +
      'not been reviewed by a Philippine-licensed attorney. It is not a substitute for consulting\n' +
      'one. Signing an unreviewed contract based on this template may create unintended\n' +
      'obligations or fail to create obligations you intended.</p>\n' +
      '<p>LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is\n' +
      'legal advice.</p>',
    bodyPlain:
      'Template contract — illustrative only. Not a signable instrument.\n\n' +
      'This sample contract was generated by an AI system as an educational illustration of ' +
      'Philippine contract structure, grounded in the Civil Code and related special laws. It ' +
      'contains bracketed placeholders for parties, consideration, dates, and jurisdiction-' +
      'specific terms, and its statutory citations should be verified against the current text ' +
      'of the Civil Code and any applicable special law.\n\n' +
      'This template is NOT, and must not be used as, a finalised contract. It has not been ' +
      'reviewed by a Philippine-licensed attorney. It is not a substitute for consulting one. ' +
      'Signing an unreviewed contract based on this template may create unintended obligations ' +
      'or fail to create obligations you intended.\n\n' +
      'LIBERTASIAN is an educational research platform. Nothing it generates or retrieves is ' +
      'legal advice.',
    authorNote: COMMON_AUTHOR_NOTE,
  },
];

/**
 * Idempotent upsert of the canonical disclaimer rows. Safe to call on every
 * seed run — row text is refreshed to match the current seed constants.
 */
export async function seedContentDisclaimers(prisma: PrismaClient): Promise<void> {
  for (const seed of DISCLAIMER_SEEDS) {
    await prisma.contentDisclaimer.upsert({
      where: { contentClass: seed.contentClass },
      update: {
        bodyHtml: seed.bodyHtml,
        bodyPlain: seed.bodyPlain,
        version: seed.version,
        isActive: seed.isActive,
        authorNote: seed.authorNote,
      },
      create: {
        contentClass: seed.contentClass,
        bodyHtml: seed.bodyHtml,
        bodyPlain: seed.bodyPlain,
        version: seed.version,
        isActive: seed.isActive,
        authorNote: seed.authorNote,
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  ✓ Seeded ${DISCLAIMER_SEEDS.length} content_disclaimers rows`);
}

// Allow running standalone: `ts-node prisma/seed-disclaimers.ts`
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient();
  seedContentDisclaimers(prisma)
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
