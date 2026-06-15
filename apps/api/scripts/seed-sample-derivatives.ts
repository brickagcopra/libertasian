/**
 * Idempotent seed for illustrative Library sample documents.
 *
 * Surfaces two edu-gated Library derivative types — `sample_pleading` and
 * `sample_contract` — as native DerivativeArtifact rows. No bridge code is
 * needed: the generic list / subjectsSummaryByType / findOne paths in
 * derivatives.service.ts already serve any derivativeType, so these rows are
 * picked up automatically. Gating + type-aware server-side redaction is handled
 * in derivatives.service.ts (GATED_DERIVATIVE_TYPES + redactGatedContent).
 *
 * Every document below is HAND-AUTHORED and CLEARLY ILLUSTRATIVE Philippine-law
 * content — blanks (____, [CITY]) and generic party names make it obvious these
 * are templates, "illustrative only, not for filing". Each row attaches the
 * active content disclaimer for its content class.
 *
 * Idempotent: re-runnable. For each document we skip if a row already exists
 * with the same (derivativeType, title), and skip the subject assignment if the
 * artifact already has one. If the disclaimer for a content class is missing we
 * log + skip that row rather than crash.
 *
 * Usage (run from repo root) — operator runs this on prod separately; it is NOT
 * run in CI and NOT part of any deploy:
 *   pnpm --filter @libertasian/api exec ts-node scripts/seed-sample-derivatives.ts
 */
import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const TAXONOMY_VERSION = 'study_8';

// content_rights: the DTO carries an @IsIn guard (CONTENT_RIGHTS =
// public_domain_government | ai_generated_derivative | mixed). Because a guard
// restricts the allowed values and 'platform_template' is not among them, we
// use the closest in-set value: 'ai_generated_derivative'.
const CONTENT_RIGHTS = 'ai_generated_derivative';

type SampleDoc = {
  derivativeType: 'sample_pleading' | 'sample_contract';
  title: string;
  subjectCode: string;
  contentPlainText: string;
  contentJson: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// PLEADINGS (subject: remedial_law)
// ---------------------------------------------------------------------------

const PLEADINGS: SampleDoc[] = [
  {
    derivativeType: 'sample_pleading',
    title: 'Motion to Dismiss (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Motion to Dismiss under the Rules of Court — template only, not for filing.',
    contentJson: {
      pleadingType: 'Motion to Dismiss',
      caption: {
        court: 'REGIONAL TRIAL COURT, BRANCH __, [CITY]',
        caseTitle: 'JUAN DELA CRUZ, Plaintiff, -versus- PEDRO SANTOS, Defendant.',
        caseNumber: 'Civil Case No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz',
        defendant: 'Pedro Santos',
        counsel: 'Atty. ___, Counsel for Defendant',
      },
      preamble: 'Defendant, by counsel, respectfully states:',
      sections: [
        {
          heading: 'Timeliness',
          paragraphs: [
            'This Motion is filed within the period to respond under the Rules of Court.',
          ],
        },
        {
          heading: 'Grounds',
          paragraphs: [
            'The Complaint should be dismissed for failure to state a cause of action under Rule 16, in that the allegations, even if hypothetically admitted, do not entitle Plaintiff to relief.',
            'The court lacks jurisdiction over the subject matter because the principal relief sought falls outside its jurisdictional competence.',
          ],
        },
        {
          heading: 'Discussion',
          paragraphs: [
            'Under settled doctrine, a complaint states no cause of action when, on its face, it shows no right of the plaintiff that has been violated by the defendant.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Defendant respectfully prays that the Complaint be DISMISSED, with such other relief as may be just and equitable.',
      verification:
        'I, Pedro Santos, of legal age, under oath state that I have read the foregoing and that its allegations are true of my personal knowledge.',
      proofOfService:
        "A copy of this Motion was served on Plaintiff's counsel by personal service on ____.",
    },
  },
  {
    derivativeType: 'sample_pleading',
    title: 'Motion for Reconsideration (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Motion for Reconsideration — template only, not for filing.',
    contentJson: {
      pleadingType: 'Motion for Reconsideration',
      caption: {
        court: 'REGIONAL TRIAL COURT, BRANCH __, [CITY]',
        caseTitle: 'JUAN DELA CRUZ, Plaintiff, -versus- PEDRO SANTOS, Defendant.',
        caseNumber: 'Civil Case No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz',
        defendant: 'Pedro Santos',
        counsel: 'Atty. ___, Counsel for Plaintiff',
      },
      preamble:
        'Plaintiff, by counsel, respectfully moves for reconsideration of the Order dated ____, and states:',
      sections: [
        {
          heading: 'Timeliness',
          paragraphs: [
            'This Motion is filed within fifteen (15) days from receipt of the assailed Order on ____.',
          ],
        },
        {
          heading: 'Grounds',
          paragraphs: [
            'The Order is contrary to the evidence on record, which preponderantly establishes Plaintiff’s claim.',
            'The Order is contrary to law and applicable jurisprudence on the matter in issue.',
          ],
        },
        {
          heading: 'Arguments',
          paragraphs: [
            'A motion for reconsideration must point out specifically the findings or conclusions said to be unsupported by the evidence or contrary to law; the assailed Order overlooked material facts duly proven during trial.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Plaintiff respectfully prays that the Order dated ____ be RECONSIDERED and SET ASIDE, with such other relief as may be just and equitable.',
      verification:
        'I, Juan Dela Cruz, of legal age, under oath state that I have read the foregoing and that its allegations are true of my personal knowledge.',
      proofOfService:
        "A copy of this Motion was served on the adverse party's counsel by accredited courier on ____.",
    },
  },
  {
    derivativeType: 'sample_pleading',
    title: 'Complaint for Sum of Money (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Complaint for a sum of money — template only, not for filing.',
    contentJson: {
      pleadingType: 'Complaint',
      caption: {
        court: 'REGIONAL TRIAL COURT, BRANCH __, [CITY]',
        caseTitle: 'JUAN DELA CRUZ, Plaintiff, -versus- PEDRO SANTOS, Defendant.',
        caseNumber: 'Civil Case No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz',
        defendant: 'Pedro Santos',
        counsel: 'Atty. ___, Counsel for Plaintiff',
      },
      preamble:
        'Plaintiff, by counsel, respectfully alleges:',
      sections: [
        {
          heading: 'The Parties',
          paragraphs: [
            'Plaintiff is of legal age, Filipino, and a resident of [ADDRESS], where he may be served with court processes.',
            'Defendant is of legal age, Filipino, and a resident of [ADDRESS], where he may be served with summons.',
          ],
        },
        {
          heading: 'Cause of Action',
          paragraphs: [
            'On or about ____, Defendant obtained a loan from Plaintiff in the principal amount of PHP ____, evidenced by a promissory note attached as Annex "A".',
            'The obligation became due on ____, but despite repeated demands, the last of which was a demand letter dated ____ (Annex "B"), Defendant failed and refused to pay.',
          ],
        },
        {
          heading: 'Interest and Damages',
          paragraphs: [
            'By reason of Defendant’s unjustified refusal to pay, Plaintiff was constrained to engage counsel for an agreed fee and to incur costs of litigation.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Plaintiff respectfully prays that judgment be rendered ordering Defendant to pay the principal sum of PHP ____ plus legal interest, attorney’s fees, and costs of suit, with such other relief as may be just and equitable.',
      verification:
        'I, Juan Dela Cruz, of legal age, under oath state that I caused the preparation of the foregoing Complaint, that I have read its contents, and that the allegations are true of my personal knowledge and based on authentic records.',
      proofOfService:
        'This Complaint is filed with the Court; summons and a copy hereof will be served on Defendant at the address stated above.',
    },
  },
  {
    derivativeType: 'sample_pleading',
    title: 'Petition for Certiorari under Rule 65 (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Petition for Certiorari under Rule 65 — template only, not for filing.',
    contentJson: {
      pleadingType: 'Petition for Certiorari (Rule 65)',
      caption: {
        court: 'COURT OF APPEALS, MANILA',
        caseTitle:
          'JUAN DELA CRUZ, Petitioner, -versus- HON. PRESIDING JUDGE, RTC BRANCH __, [CITY], and PEDRO SANTOS, Respondents.',
        caseNumber: 'CA-G.R. SP No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz (Petitioner)',
        defendant: 'Hon. Presiding Judge, RTC Branch __ and Pedro Santos (Respondents)',
        counsel: 'Atty. ___, Counsel for Petitioner',
      },
      preamble:
        'Petitioner, by counsel, respectfully states that this Petition for Certiorari under Rule 65 of the Rules of Court alleges:',
      sections: [
        {
          heading: 'Timeliness',
          paragraphs: [
            'This Petition is filed within sixty (60) days from notice of the denial of Petitioner’s motion for reconsideration on ____.',
          ],
        },
        {
          heading: 'Grounds',
          paragraphs: [
            'Public respondent acted without or in excess of jurisdiction, or with grave abuse of discretion amounting to lack or excess of jurisdiction, in issuing the assailed Order dated ____.',
            'There is no appeal, nor any plain, speedy, and adequate remedy in the ordinary course of law available to Petitioner.',
          ],
        },
        {
          heading: 'Discussion',
          paragraphs: [
            'Grave abuse of discretion implies a capricious and whimsical exercise of judgment equivalent to lack of jurisdiction; here, the assailed Order disregarded undisputed facts on record.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Petitioner respectfully prays that the assailed Order be ANNULLED and SET ASIDE, and that such other relief as may be just and equitable be granted.',
      verification:
        'I, Juan Dela Cruz, of legal age, under oath state that I have read the foregoing Petition and certify that the allegations are true of my personal knowledge, and that I have not commenced any other action involving the same issues (certification against forum shopping).',
      proofOfService:
        'Copies of this Petition were served on public respondent and on private respondent’s counsel by personal service on ____.',
    },
  },
  {
    derivativeType: 'sample_pleading',
    title: 'Answer with Affirmative Defenses (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Answer with affirmative defenses — template only, not for filing.',
    contentJson: {
      pleadingType: 'Answer with Affirmative Defenses',
      caption: {
        court: 'REGIONAL TRIAL COURT, BRANCH __, [CITY]',
        caseTitle: 'JUAN DELA CRUZ, Plaintiff, -versus- PEDRO SANTOS, Defendant.',
        caseNumber: 'Civil Case No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz',
        defendant: 'Pedro Santos',
        counsel: 'Atty. ___, Counsel for Defendant',
      },
      preamble: 'Defendant, by counsel, respectfully states:',
      sections: [
        {
          heading: 'Specific Denials',
          paragraphs: [
            'Defendant specifically denies the allegations in paragraphs ____ of the Complaint, the truth being as set forth in the affirmative defenses below.',
            'Defendant admits only the allegations as to the parties’ personal circumstances and denies the rest for lack of knowledge sufficient to form a belief as to their truth.',
          ],
        },
        {
          heading: 'Affirmative Defenses',
          paragraphs: [
            'The claim is barred by the applicable statute of limitations, the obligation, if any, having prescribed before the filing of the Complaint.',
            'The Complaint states no cause of action, the alleged obligation having already been extinguished by payment.',
          ],
        },
        {
          heading: 'Compulsory Counterclaim',
          paragraphs: [
            'By reason of the unfounded suit, Defendant was constrained to engage counsel and incur litigation expenses for which Plaintiff should be held liable.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Defendant respectfully prays that the Complaint be DISMISSED and that, on the counterclaim, Plaintiff be ordered to pay attorney’s fees and costs, with such other relief as may be just and equitable.',
      verification:
        'I, Pedro Santos, of legal age, under oath state that I have read the foregoing Answer and that its allegations are true of my personal knowledge.',
      proofOfService:
        "A copy of this Answer was served on Plaintiff's counsel by personal service on ____.",
    },
  },
  {
    derivativeType: 'sample_pleading',
    title: 'Notice of Appeal (Illustrative Sample)',
    subjectCode: 'remedial_law',
    contentPlainText:
      'Illustrative sample Notice of Appeal — template only, not for filing.',
    contentJson: {
      pleadingType: 'Notice of Appeal',
      caption: {
        court: 'REGIONAL TRIAL COURT, BRANCH __, [CITY]',
        caseTitle: 'JUAN DELA CRUZ, Plaintiff, -versus- PEDRO SANTOS, Defendant.',
        caseNumber: 'Civil Case No. ____',
      },
      parties: {
        plaintiff: 'Juan Dela Cruz',
        defendant: 'Pedro Santos',
        counsel: 'Atty. ___, Counsel for Plaintiff-Appellant',
      },
      preamble:
        'Plaintiff-Appellant, by counsel, respectfully gives notice that:',
      sections: [
        {
          heading: 'Notice',
          paragraphs: [
            'Plaintiff hereby appeals to the Court of Appeals from the Decision dated ____, a copy of which was received on ____.',
          ],
        },
        {
          heading: 'Scope of Appeal',
          paragraphs: [
            'The appeal is taken on both questions of fact and of law, the Decision being contrary to the evidence and to applicable law.',
          ],
        },
        {
          heading: 'Timeliness',
          paragraphs: [
            'This Notice of Appeal is filed within the fifteen (15)-day reglementary period reckoned from receipt of the Decision.',
          ],
        },
      ],
      prayer:
        'WHEREFORE, Plaintiff respectfully prays that this Notice of Appeal be given due course and that the records be elevated to the Court of Appeals in due time.',
      verification:
        'A notice of appeal need not be verified; the undersigned counsel certifies that the appeal is taken in good faith and within the reglementary period.',
      proofOfService:
        "A copy of this Notice was served on the adverse party's counsel by personal service on ____, and the appellate docket fees are paid herewith.",
    },
  },
];

// ---------------------------------------------------------------------------
// CONTRACTS
// ---------------------------------------------------------------------------

const CONTRACTS: SampleDoc[] = [
  {
    derivativeType: 'sample_contract',
    title: 'Contract of Lease (Illustrative Sample)',
    subjectCode: 'civil_law',
    contentPlainText:
      'Illustrative sample Contract of Lease — template only, not for execution.',
    contentJson: {
      contractType: 'Contract of Lease',
      parties: [
        { role: 'Lessor', name: 'Juan Dela Cruz', address: '[ADDRESS]' },
        { role: 'Lessee', name: 'Pedro Santos', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the Lessor is the registered owner of the property described below;',
        'WHEREAS, the Lessee desires to lease the property and the Lessor is willing to lease it on the terms herein;',
      ],
      clauses: [
        {
          heading: 'Leased Premises',
          text: 'The Lessor leases to the Lessee the property located at [ADDRESS], covered by TCT No. ____.',
          subclauses: [
            { heading: 'Use', text: 'The premises shall be used solely for [RESIDENTIAL/COMMERCIAL] purposes.' },
          ],
        },
        {
          heading: 'Term',
          text: 'The lease shall be for a period of ____ year(s) commencing on ____, renewable upon mutual written agreement.',
          subclauses: [],
        },
        {
          heading: 'Rent and Deposit',
          text: 'The Lessee shall pay monthly rent of PHP ____, payable on or before the ____ day of each month, and a security deposit equivalent to ____ month(s) rent.',
          subclauses: [
            { heading: 'Late Payment', text: 'A late charge of ____% per month shall apply to overdue rent.' },
          ],
        },
        {
          heading: 'Maintenance and Repairs',
          text: 'The Lessee shall keep the premises in good condition; major structural repairs shall be for the account of the Lessor.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Inventory of Fixtures', text: 'List of fixtures and their condition at turnover (____).' },
      ],
      signatureBlocks: [
        { role: 'Lessor', name: 'Juan Dela Cruz' },
        { role: 'Lessee', name: 'Pedro Santos' },
      ],
    },
  },
  {
    derivativeType: 'sample_contract',
    title: 'Deed of Absolute Sale of Real Property (Illustrative Sample)',
    subjectCode: 'civil_law',
    contentPlainText:
      'Illustrative sample Deed of Absolute Sale of real property — template only, not for execution.',
    contentJson: {
      contractType: 'Deed of Absolute Sale',
      parties: [
        { role: 'Vendor', name: 'Juan Dela Cruz', address: '[ADDRESS]' },
        { role: 'Vendee', name: 'Pedro Santos', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the Vendor is the absolute owner of the parcel of land described below;',
        'WHEREAS, the Vendor has agreed to sell, and the Vendee to buy, the said property free from liens and encumbrances;',
      ],
      clauses: [
        {
          heading: 'Subject Property',
          text: 'A parcel of land located at [ADDRESS], covered by TCT No. ____, with an area of ____ square meters, more particularly described in the title.',
          subclauses: [],
        },
        {
          heading: 'Consideration',
          text: 'For and in consideration of the sum of PHP ____, receipt of which is hereby acknowledged, the Vendor sells, transfers, and conveys the property absolutely to the Vendee.',
          subclauses: [],
        },
        {
          heading: 'Warranties',
          text: 'The Vendor warrants valid title and peaceful possession, and that the property is free from all liens, encumbrances, and adverse claims.',
          subclauses: [
            { heading: 'Eviction', text: 'The Vendor shall answer for eviction as provided by the Civil Code.' },
          ],
        },
        {
          heading: 'Taxes and Fees',
          text: 'Capital gains tax shall be for the account of the Vendor; documentary stamp tax, transfer tax, and registration fees shall be for the account of the Vendee, unless otherwise agreed.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Technical Description', text: 'Technical description as appearing on TCT No. ____.' },
      ],
      signatureBlocks: [
        { role: 'Vendor', name: 'Juan Dela Cruz' },
        { role: 'Vendee', name: 'Pedro Santos' },
      ],
    },
  },
  {
    derivativeType: 'sample_contract',
    title: 'Contract of Loan (Illustrative Sample)',
    subjectCode: 'civil_law',
    contentPlainText:
      'Illustrative sample Contract of Loan — template only, not for execution.',
    contentJson: {
      contractType: 'Contract of Loan',
      parties: [
        { role: 'Creditor', name: 'Juan Dela Cruz', address: '[ADDRESS]' },
        { role: 'Debtor', name: 'Pedro Santos', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the Debtor has applied for a loan and the Creditor has agreed to extend it on the terms herein;',
      ],
      clauses: [
        {
          heading: 'Loan Amount',
          text: 'The Creditor lends to the Debtor the principal sum of PHP ____, receipt of which the Debtor acknowledges.',
          subclauses: [],
        },
        {
          heading: 'Interest',
          text: 'The loan shall bear interest at ____% per annum, computed on the outstanding balance, subject to the limits allowed by law.',
          subclauses: [],
        },
        {
          heading: 'Repayment',
          text: 'The Debtor shall repay the loan in ____ equal monthly installments beginning on ____ until fully paid.',
          subclauses: [
            { heading: 'Acceleration', text: 'Default in any installment shall render the entire balance immediately due and demandable.' },
          ],
        },
        {
          heading: 'Default',
          text: 'Upon default, the Creditor may pursue all remedies available under law, including collection and recovery of attorney’s fees and costs.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Amortization', text: 'Amortization schedule of ____ installments (illustrative).' },
      ],
      signatureBlocks: [
        { role: 'Creditor', name: 'Juan Dela Cruz' },
        { role: 'Debtor', name: 'Pedro Santos' },
      ],
    },
  },
  {
    derivativeType: 'sample_contract',
    title: 'Employment Contract (Illustrative Sample)',
    subjectCode: 'labor_law',
    contentPlainText:
      'Illustrative sample Employment Contract — template only, not for execution.',
    contentJson: {
      contractType: 'Employment Contract',
      parties: [
        { role: 'Employer', name: '[COMPANY NAME], Inc.', address: '[ADDRESS]' },
        { role: 'Employee', name: 'Pedro Santos', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the Employer desires to engage the services of the Employee, and the Employee accepts such engagement on the terms herein, consistent with the Labor Code;',
      ],
      clauses: [
        {
          heading: 'Position and Duties',
          text: 'The Employee is engaged as ____ and shall perform the duties reasonably assigned, reporting to ____.',
          subclauses: [],
        },
        {
          heading: 'Compensation and Benefits',
          text: 'The Employee shall receive a monthly salary of PHP ____, statutory benefits (SSS, PhilHealth, Pag-IBIG), 13th month pay, and such other benefits as company policy provides.',
          subclauses: [
            { heading: 'Hours of Work', text: 'Normal hours shall not exceed eight (8) hours a day, with overtime governed by the Labor Code.' },
          ],
        },
        {
          heading: 'Probationary Period',
          text: 'The Employee shall be on probation for ____ months, during which regularization is subject to reasonable standards made known at the time of engagement.',
          subclauses: [],
        },
        {
          heading: 'Termination',
          text: 'Employment may be terminated only for just or authorized causes and with due process, as provided by the Labor Code.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Job Description', text: 'Detailed job description for the position of ____.' },
      ],
      signatureBlocks: [
        { role: 'Employer', name: 'Authorized Representative, [COMPANY NAME], Inc.' },
        { role: 'Employee', name: 'Pedro Santos' },
      ],
    },
  },
  {
    derivativeType: 'sample_contract',
    title: 'Service Agreement (Illustrative Sample)',
    subjectCode: 'civil_law',
    contentPlainText:
      'Illustrative sample Service Agreement — template only, not for execution.',
    contentJson: {
      contractType: 'Service Agreement',
      parties: [
        { role: 'Client', name: '[CLIENT NAME]', address: '[ADDRESS]' },
        { role: 'Service Provider', name: '[PROVIDER NAME]', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the Client desires to engage the Service Provider to render the services described below, and the Service Provider is willing and able to render them;',
      ],
      clauses: [
        {
          heading: 'Scope of Services',
          text: 'The Service Provider shall render the following services: ____, in accordance with the standards and timelines set out herein.',
          subclauses: [],
        },
        {
          heading: 'Fees and Payment',
          text: 'The Client shall pay the Service Provider the fee of PHP ____, payable as follows: ____.',
          subclauses: [
            { heading: 'Taxes', text: 'Applicable withholding taxes shall be deducted and remitted as required by law.' },
          ],
        },
        {
          heading: 'Independent Contractor',
          text: 'The Service Provider is an independent contractor; nothing herein creates an employer-employee relationship between the parties.',
          subclauses: [],
        },
        {
          heading: 'Term and Termination',
          text: 'This Agreement is effective from ____ until ____, and may be terminated by either party upon ____ days’ written notice.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Deliverables', text: 'List of deliverables and acceptance criteria (illustrative).' },
      ],
      signatureBlocks: [
        { role: 'Client', name: '[CLIENT NAME]' },
        { role: 'Service Provider', name: '[PROVIDER NAME]' },
      ],
    },
  },
  {
    derivativeType: 'sample_contract',
    title: 'Non-Disclosure Agreement (Illustrative Sample)',
    subjectCode: 'mercantile_law',
    contentPlainText:
      'Illustrative sample Non-Disclosure Agreement — template only, not for execution.',
    contentJson: {
      contractType: 'Non-Disclosure Agreement',
      parties: [
        { role: 'Disclosing Party', name: '[DISCLOSING PARTY]', address: '[ADDRESS]' },
        { role: 'Receiving Party', name: '[RECEIVING PARTY]', address: '[ADDRESS]' },
      ],
      recitals: [
        'WHEREAS, the parties wish to explore a potential business relationship and, in the course thereof, may disclose confidential information to each other;',
      ],
      clauses: [
        {
          heading: 'Definition of Confidential Information',
          text: 'Confidential Information means any non-public information disclosed by one party to the other, whether oral, written, or electronic, that is marked or reasonably understood to be confidential.',
          subclauses: [],
        },
        {
          heading: 'Obligations of the Receiving Party',
          text: 'The Receiving Party shall use the Confidential Information solely for the agreed purpose and shall not disclose it to third parties without prior written consent.',
          subclauses: [
            { heading: 'Standard of Care', text: 'The Receiving Party shall protect the information with at least the same degree of care it uses for its own confidential information.' },
          ],
        },
        {
          heading: 'Exclusions',
          text: 'Obligations do not apply to information that is or becomes public through no fault of the Receiving Party, or that is independently developed without use of the Confidential Information.',
          subclauses: [],
        },
        {
          heading: 'Term and Remedies',
          text: 'Confidentiality obligations survive for ____ years from disclosure; breach may entitle the disclosing party to injunctive relief and damages.',
          subclauses: [],
        },
      ],
      schedules: [
        { heading: 'Schedule A — Permitted Recipients', text: 'List of representatives authorized to receive the Confidential Information (illustrative).' },
      ],
      signatureBlocks: [
        { role: 'Disclosing Party', name: '[DISCLOSING PARTY]' },
        { role: 'Receiving Party', name: '[RECEIVING PARTY]' },
      ],
    },
  },
];

const ALL_DOCS: SampleDoc[] = [...PLEADINGS, ...CONTRACTS];

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  let created = 0;
  let skippedExisting = 0;
  let skippedNoDisclaimer = 0;
  let skippedNoSubject = 0;
  let assignmentsCreated = 0;

  try {
    // Cache disclaimer lookups per content class (one query per type).
    const disclaimerByClass = new Map<string, string | null>();
    const resolveDisclaimerId = async (contentClass: string): Promise<string | null> => {
      if (disclaimerByClass.has(contentClass)) {
        return disclaimerByClass.get(contentClass) ?? null;
      }
      const disclaimer = await prisma.contentDisclaimer.findFirst({
        where: { contentClass },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      disclaimerByClass.set(contentClass, disclaimer?.id ?? null);
      return disclaimer?.id ?? null;
    };

    // Cache subject lookups per code (taxonomy_version=study_8).
    const subjectByCode = new Map<string, string | null>();
    const resolveSubjectId = async (code: string): Promise<string | null> => {
      if (subjectByCode.has(code)) {
        return subjectByCode.get(code) ?? null;
      }
      const subject = await prisma.subject.findFirst({
        where: { code, taxonomyVersion: TAXONOMY_VERSION },
        select: { id: true },
      });
      subjectByCode.set(code, subject?.id ?? null);
      return subject?.id ?? null;
    };

    for (const doc of ALL_DOCS) {
      // Idempotency: skip if a row already exists with the same (type, title).
      const existing = await prisma.derivativeArtifact.findFirst({
        where: { derivativeType: doc.derivativeType, title: doc.title },
        select: { id: true },
      });
      if (existing) {
        skippedExisting += 1;
        console.log(`[skip:exists] ${doc.derivativeType} — ${doc.title}`);
        // Ensure a subject assignment exists even for a pre-existing artifact.
        const hasAssignment = await prisma.documentSubjectAssignment.findFirst({
          where: { derivativeArtifactId: existing.id },
          select: { id: true },
        });
        if (!hasAssignment) {
          const subjectId = await resolveSubjectId(doc.subjectCode);
          if (subjectId) {
            await prisma.documentSubjectAssignment.create({
              data: {
                derivativeArtifactId: existing.id,
                subjectId,
                isPrimary: true,
                classifiedBy: 'manual',
                confidence: null,
                manualOverride: false,
              },
            });
            assignmentsCreated += 1;
            console.log(`  -> added missing subject assignment (${doc.subjectCode})`);
          }
        }
        continue;
      }

      const contentDisclaimerId = await resolveDisclaimerId(doc.derivativeType);
      if (!contentDisclaimerId) {
        skippedNoDisclaimer += 1;
        console.log(
          `[skip:no-disclaimer] missing content_disclaimer for class '${doc.derivativeType}' — ${doc.title}`,
        );
        continue;
      }

      const subjectId = await resolveSubjectId(doc.subjectCode);
      if (!subjectId) {
        skippedNoSubject += 1;
        console.log(
          `[skip:no-subject] missing subject '${doc.subjectCode}' (${TAXONOMY_VERSION}) — ${doc.title}`,
        );
        continue;
      }

      const contentHash = sha256Hex(JSON.stringify(doc.contentJson));

      const artifact = await prisma.derivativeArtifact.create({
        data: {
          derivativeType: doc.derivativeType,
          title: doc.title,
          contentJson: doc.contentJson as object,
          contentPlainText: doc.contentPlainText,
          contentHash,
          reviewStatus: 'approved',
          visibility: 'public_editorial',
          audience: 'both',
          language: 'en',
          taxonomyVersion: TAXONOMY_VERSION,
          confidenceScore: null,
          publishedAt: new Date(),
          contentRights: CONTENT_RIGHTS,
          contentDisclaimerId,
        },
        select: { id: true },
      });
      created += 1;

      await prisma.documentSubjectAssignment.create({
        data: {
          derivativeArtifactId: artifact.id,
          subjectId,
          isPrimary: true,
          classifiedBy: 'manual',
          confidence: null,
          manualOverride: false,
        },
      });
      assignmentsCreated += 1;

      console.log(`[create] ${doc.derivativeType} — ${doc.title} (${doc.subjectCode})`);
    }

    console.log('---');
    console.log(`Created artifacts:        ${created}`);
    console.log(`Subject assignments made: ${assignmentsCreated}`);
    console.log(`Skipped (already exist):  ${skippedExisting}`);
    console.log(`Skipped (no disclaimer):  ${skippedNoDisclaimer}`);
    console.log(`Skipped (no subject):     ${skippedNoSubject}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
