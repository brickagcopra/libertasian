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
