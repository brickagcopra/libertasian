/**
 * Canonical sample content for the 11 `derivative_artifacts.content_json`
 * shapes.
 *
 * These started life in
 * `apps/web/src/features/derivatives/renderers/__fixtures__/fixtures.ts` as
 * renderer test fixtures. They moved here when the API gained a second
 * consumer (`derivative-extract.ts`), because `apps/api` cannot import
 * `apps/web/src` — `apps/api/tsconfig.json` pins `rootDir` to `./src`, so a
 * cross-app relative import fails `tsc` with TS6059 and breaks the lint gate.
 * Duplicating the shapes into the API would let the two copies drift, which is
 * precisely the failure this file exists to prevent: the extractor and the
 * renderers must agree on the shapes, forever.
 *
 * The web fixtures module re-exports every constant below, so renderer tests
 * keep importing from their original path.
 *
 * These are shape contracts, not merely test data. Treat a change here as a
 * change to the derivative content schema: update the renderers AND the API
 * extractor together.
 */

export const MCQ_CONTENT = {
  questionStem: 'Under what doctrine is evidence obtained via unlawful search excluded?',
  options: [
    { label: 'A', text: 'Fruit of the poisonous tree', isCorrect: true, rationale: 'Correct doctrine name.' },
    { label: 'B', text: 'Res ipsa loquitur', isCorrect: false, rationale: 'Tort doctrine, not evidence.' },
    { label: 'C', text: 'Stare decisis', isCorrect: false, rationale: 'Binding-precedent rule.' },
    { label: 'D', text: 'Ejusdem generis', isCorrect: false, rationale: 'Interpretation canon.' },
  ],
  explanation: 'Art. III, §2 of the 1987 Constitution and the exclusionary rule.',
};

export const ESSAY_CONTENT = {
  promptText: 'Discuss the exclusionary rule under the 1987 Constitution.',
  suggestedTimeMinutes: 45,
  modelAnswer: {
    outlineSections: [
      {
        heading: 'Answer',
        paragraphs: ['The exclusionary rule bars illegally obtained evidence.'],
        citedSectionIds: ['sec-1'],
      },
      {
        heading: 'Law',
        paragraphs: ['Art. III, Sec. 2 and Sec. 3(2) of the 1987 Constitution.'],
        citedSectionIds: ['sec-2'],
      },
    ],
  },
  rubric: {
    totalPoints: 100,
    criteria: [
      { name: 'Issue Identification', maxPoints: 20, description: 'Name the right.' },
      { name: 'Legal Knowledge', maxPoints: 40, description: 'Cite the provision.' },
      { name: 'Application', maxPoints: 40, description: 'Apply to facts.' },
    ],
  },
};

export const DIGEST_CONTENT = {
  summary: 'Petitioner challenges the validity of a warrantless search.',
  facts: 'Police stopped the accused at a checkpoint and discovered firearms.',
  petitionerArguments: 'The search violated Art. III, Sec. 2.',
  respondentArguments: 'The checkpoint qualifies under the plain-view doctrine.',
  issues: ['Whether the warrantless search was valid.'],
  ruling: 'The Court held the search invalid.',
  doctrine: 'Warrantless searches must fall within recognised exceptions.',
  dispositive: 'Petition granted.',
};

export const DOCTRINE_CONTENT = {
  doctrines: [
    {
      text: 'The exclusionary rule bars use of illegally obtained evidence.',
      doctrine_type: 'rule',
      confidence: 0.92,
    },
    {
      text: 'Fruit of the poisonous tree extends the exclusionary rule to derivative evidence.',
      doctrine_type: 'rule',
      confidence: 0.88,
    },
  ],
};

export const OUTLINE_CONTENT = {
  topic: 'Constitutional Criminal Procedure',
  sections: [
    {
      heading: 'Search and Seizure',
      paragraphs: ['Overview of Art. III, Sec. 2.'],
      subSections: [
        { heading: 'Warrantless Exceptions', paragraphs: ['Plain view, consent, etc.'] },
      ],
    },
    {
      heading: 'Right to Counsel',
      paragraphs: ['Coverage of Art. III, Sec. 12.'],
    },
  ],
};

export const FLASHCARD_CONTENT = {
  cards: [
    { front: 'What is the exclusionary rule?', back: 'Illegally obtained evidence is inadmissible.' },
    { front: 'Fruit of the poisonous tree?', back: 'Derivative evidence is also excluded.' },
  ],
};

export const ESSAY_MODEL_ANSWER_CONTENT = {
  promptRef: 'See essay prompt: Discuss the exclusionary rule under the 1987 Constitution.',
  format: 'alac',
  answer: {
    outlineSections: [
      { paragraphs: ['The warrantless search was invalid.'], citedSectionIds: ['sec-a'] },
      { paragraphs: ['Art. III, Sec. 2 of the 1987 Constitution.'], citedSectionIds: ['sec-b'] },
      { paragraphs: ['Applying these rules to the facts above...'] },
      { paragraphs: ['Therefore, the evidence must be excluded.'] },
    ],
  },
  writingTips: ['Lead with the answer.', 'Cite the exact provision.'],
  commonPitfalls: ['Conflating plain view with stop-and-frisk.'],
};

export const SUGGESTED_BAR_ANSWER_CONTENT = {
  barYear: 2019,
  examSubject: 'Political Law',
  questionText: 'When may a warrantless arrest be validly made?',
  suggestedAnswer:
    'A warrantless arrest may be made in the three instances under Rule 113, Section 5...',
  annotations: [
    {
      quote: 'Rule 113, Section 5 of the Rules of Court',
      commentary: 'Enumerates the three instances of valid warrantless arrest.',
    },
  ],
  sourceAttribution: 'UP Law Center Bar Q&A compilation',
};

export const SAMPLE_PLEADING_CONTENT = {
  pleadingType: 'Petition for Review on Certiorari',
  caption: {
    court: 'SUPREME COURT OF THE PHILIPPINES',
    caseTitle: 'Juan Dela Cruz vs. People of the Philippines',
    caseNumber: 'G.R. No. 123456',
  },
  parties: {
    plaintiff: 'Juan Dela Cruz',
    defendant: 'People of the Philippines',
    counsel: 'Atty. Maria Santos',
  },
  preamble: 'Petitioner, by counsel, respectfully states:',
  sections: [
    { heading: 'Statement of Facts', paragraphs: ['On January 1, 2024...'] },
    { heading: 'Assignment of Errors', paragraphs: ['The Court of Appeals gravely erred...'] },
  ],
  prayer: 'WHEREFORE, petitioner prays that the petition be granted.',
  verification: 'I, Juan Dela Cruz, under oath, state...',
  proofOfService: 'Copy served on respondent by registered mail.',
};

export const SAMPLE_CONTRACT_CONTENT = {
  contractType: 'Lease Agreement',
  parties: [
    { role: 'Lessor', name: 'ABC Realty Corp.', address: '123 Makati Ave., Makati City' },
    { role: 'Lessee', name: 'XYZ Trading Inc.', address: '456 Ortigas Ave., Pasig City' },
  ],
  recitals: [
    'Lessor owns the property described in Schedule A.',
    'Lessee wishes to lease the property under the terms below.',
  ],
  clauses: [
    {
      heading: 'Term',
      text: 'The lease shall be for a period of two (2) years.',
      subclauses: [{ heading: 'Renewal', text: 'Renewable by mutual written agreement.' }],
    },
    { heading: 'Rent', text: 'Monthly rent is PHP 100,000.' },
  ],
  schedules: [{ heading: 'Schedule A — Property', text: 'Unit 10A, 123 Makati Ave.' }],
  signatureBlocks: [
    { role: 'Lessor', name: 'ABC Realty Corp.' },
    { role: 'Lessee', name: 'XYZ Trading Inc.' },
  ],
};

export const ONE_PAGE_SUMMARY_CONTENT = {
  topic: 'Warrantless Arrests under Rule 113',
  bottomLine:
    'A warrantless arrest is valid only in the three narrow exceptions enumerated in Rule 113, Section 5.',
  keyPoints: [
    'In flagrante delicto',
    'Hot pursuit',
    'Escapee from lawful custody',
  ],
  highlights: [
    { term: 'In flagrante delicto', definition: 'Arrest during commission of an offense.' },
    { term: 'Hot pursuit', definition: 'Immediate pursuit after commission of an offense.' },
  ],
  quickReference: [
    { label: 'Rule', value: 'Rule 113, Sec. 5' },
    { label: 'Source', value: 'Rules of Court' },
  ],
};
