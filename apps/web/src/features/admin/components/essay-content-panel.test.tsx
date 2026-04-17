import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EssayContentPanel } from './essay-content-panel';
import type { JobEssayResponse } from '../types';

type Essay = NonNullable<JobEssayResponse['essay']>;

function makeEssay(overrides?: Partial<Essay>): Essay {
  return {
    id: 'art-1',
    title: 'Essay on Command Responsibility',
    contentPlainText: null,
    confidenceScore: 0.85,
    reviewStatus: 'draft',
    validatorVerdict: 'publish',
    visibility: 'private',
    publishedAt: null,
    createdAt: '2026-04-17T00:00:00Z',
    contentDisclaimer: { id: 'disc-1', bodyPlain: 'AI-generated content.' },
    essayPrompt: {
      promptText: 'Discuss the doctrine of command responsibility.',
      suggestedTimeMinutes: 30,
      modelAnswerJson: null,
      rubricJson: null,
      subjectTopicId: null,
      barExamSittingId: null,
    },
    ...overrides,
  };
}

describe('EssayContentPanel', () => {
  it('renders prompt text, badges, and disclaimer', () => {
    const essay = makeEssay();

    render(<EssayContentPanel essay={essay} />);

    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('publish')).toBeInTheDocument();
    expect(screen.getByText('85% confidence')).toBeInTheDocument();
    expect(screen.getByText('private')).toBeInTheDocument();
    expect(screen.getByText('Discuss the doctrine of command responsibility.')).toBeInTheDocument();
    expect(screen.getByText('Suggested time: 30 minutes')).toBeInTheDocument();
    expect(screen.getByText('AI-generated content.')).toBeInTheDocument();
  });

  it('renders ALAC-shaped model answer with all 4 headings', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: 45,
        modelAnswerJson: {
          Answer: 'The respondent is liable under command responsibility.',
          Law: 'Article 1 of the Geneva Convention establishes...',
          Application: 'Applying the law to the facts, the respondent...',
          Conclusion: 'Therefore, the respondent is liable.',
        },
        rubricJson: null,
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    expect(screen.getByText('answer')).toBeInTheDocument();
    expect(screen.getByText('law')).toBeInTheDocument();
    expect(screen.getByText('application')).toBeInTheDocument();
    expect(screen.getByText('conclusion')).toBeInTheDocument();
    expect(screen.getByText('The respondent is liable under command responsibility.')).toBeInTheDocument();
    expect(screen.getByText('Article 1 of the Geneva Convention establishes...')).toBeInTheDocument();
  });

  it('renders plain string model answer', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: null,
        modelAnswerJson: 'This is a plain text model answer discussing command responsibility.',
        rubricJson: null,
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    expect(
      screen.getByText('This is a plain text model answer discussing command responsibility.'),
    ).toBeInTheDocument();
  });

  it('renders "No model answer provided" when modelAnswerJson is null', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: null,
        modelAnswerJson: null,
        rubricJson: null,
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    expect(screen.getByText('No model answer provided')).toBeInTheDocument();
  });

  it('renders rubric with criteria list', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: null,
        modelAnswerJson: null,
        rubricJson: {
          totalPoints: 100,
          criteria: [
            { name: 'Issue ID', maxPoints: 20, description: 'Identifies the issue' },
            { name: 'Knowledge', maxPoints: 30, description: 'Shows legal knowledge' },
            { name: 'Analysis', maxPoints: 50, description: 'Applies law to facts' },
          ],
        },
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    expect(screen.getByText('Total points: 100')).toBeInTheDocument();
    expect(screen.getByText(/Issue ID.*20 pts/)).toBeInTheDocument();
    expect(screen.getByText(/Knowledge.*30 pts/)).toBeInTheDocument();
  });

  it('renders outlineSections ALAC structure', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: 45,
        modelAnswerJson: {
          outlineSections: [
            {
              heading: 'Answer',
              paragraphs: ['The respondent is liable under the doctrine of command responsibility.'],
              citedSectionIds: ['11111111-1111-1111-1111-111111111111'],
            },
            {
              heading: 'Law',
              paragraphs: [
                'Article 28 of the Rome Statute establishes the doctrine.',
                'Philippine jurisprudence adopts this principle in People v. Santos.',
              ],
              citedSectionIds: [
                '22222222-2222-2222-2222-222222222222',
                '33333333-3333-3333-3333-333333333333',
              ],
            },
            {
              heading: 'Application',
              paragraphs: ['Applying the law to the facts, the respondent knew or should have known.'],
              citedSectionIds: [
                '44444444-4444-4444-4444-444444444444',
                '44444444-4444-4444-4444-444444444444',
              ],
            },
            {
              heading: 'Conclusion',
              paragraphs: ['Therefore, the respondent is liable.'],
              citedSectionIds: ['55555555-5555-5555-5555-555555555555'],
            },
          ],
        },
        rubricJson: null,
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    const { container } = render(<EssayContentPanel essay={essay} />);

    // Headings rendered uppercase
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Law')).toBeInTheDocument();
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();

    // Paragraph text present
    expect(
      screen.getByText('The respondent is liable under the doctrine of command responsibility.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Article 28 of the Rome Statute establishes the doctrine.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Philippine jurisprudence adopts this principle in People v. Santos.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Applying the law to the facts, the respondent knew or should have known.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Therefore, the respondent is liable.')).toBeInTheDocument();

    // Citation counts: Answer=1, Law=2 distinct, Application=2 dupes→1, Conclusion=1
    const singleCites = screen.getAllByText('Cites 1 source');
    expect(singleCites).toHaveLength(3); // Answer, Application (deduplicated), Conclusion
    expect(screen.getByText('Cites 2 sources')).toBeInTheDocument(); // Law (2 distinct ids)

    // Raw UUIDs must NOT appear
    expect(container.textContent).not.toContain('11111111-1111-1111-1111-111111111111');
    expect(container.textContent).not.toContain('22222222-2222-2222-2222-222222222222');
    expect(container.textContent).not.toContain('44444444-4444-4444-4444-444444444444');
  });

  it('falls back to ALAC-direct-keys branch when outlineSections absent', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: null,
        modelAnswerJson: {
          Answer: 'Direct answer text.',
          Law: 'Direct law text.',
          Application: 'Direct application text.',
          Conclusion: 'Direct conclusion text.',
        },
        rubricJson: null,
        subjectTopicId: null,
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    // ALAC-direct-keys renders lowercase heading labels
    expect(screen.getByText('answer')).toBeInTheDocument();
    expect(screen.getByText('law')).toBeInTheDocument();
    expect(screen.getByText('application')).toBeInTheDocument();
    expect(screen.getByText('conclusion')).toBeInTheDocument();
    expect(screen.getByText('Direct answer text.')).toBeInTheDocument();
  });

  it('renders footer metadata when subjectTopicId present', () => {
    const essay = makeEssay({
      essayPrompt: {
        promptText: 'Discuss command responsibility.',
        suggestedTimeMinutes: null,
        modelAnswerJson: null,
        rubricJson: null,
        subjectTopicId: 'topic-abc',
        barExamSittingId: null,
      },
    });

    render(<EssayContentPanel essay={essay} />);

    expect(screen.getByText(/Subject Topic: topic-abc/)).toBeInTheDocument();
  });
});
