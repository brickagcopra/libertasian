import type { DerivativeDetail, DerivativeType } from '../../types';

export function makeDetail(
  type: DerivativeType,
  contentJson: unknown,
  overrides: Partial<DerivativeDetail> = {},
): DerivativeDetail {
  return {
    id: 'test-id',
    title: 'Test Artifact',
    derivativeType: type,
    confidenceScore: 0.85,
    createdAt: '2026-04-20T10:00:00Z',
    publishedAt: null,
    audience: 'both',
    language: 'en',
    sourceDocument: null,
    subjects: [
      {
        code: 'criminal_law',
        name: 'Criminal Law',
        taxonomyVersion: 'study_8',
        isPrimary: true,
      },
    ],
    disclaimer: { id: 'cd-1', contentClass: String(type), version: 1 },
    isGated: false,
    upgradeTier: null,
    contentJson,
    contentPlainText: null,
    disclaimerBody: { bodyHtml: '<p>disc</p>', bodyPlain: 'disclaimer' },
    mcqQuestion: null,
    essayPrompt: null,
    ...overrides,
  };
}

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
