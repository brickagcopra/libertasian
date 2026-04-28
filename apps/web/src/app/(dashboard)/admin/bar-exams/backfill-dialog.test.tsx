import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BackfillDialog, type BackfillPlan } from './backfill-dialog';

const samplePlan: BackfillPlan = {
  coverage: {
    yearsAvailable: [2018, 2022],
    yearsAbsentOnLawphil: [2019, 2020, 2021],
    absenceReason: '2020 cancelled; 2021 cohort sat in November 2022.',
  },
  sittings: [
    {
      year: 2018,
      subjectSlug: 'criminalQ',
      subjectStudyCode: 'criminal_law',
      subjectAdminCode: 'criminal',
      part: null,
      label: 'Criminal Law',
      status: 'pending',
      existingSittingId: null,
      existingQuestionCount: null,
      sourceUrl: 'https://lawphil.net/courts/bm/barQ/2018/criminalQ.html',
    },
    {
      year: 2018,
      subjectSlug: 'civilQ',
      subjectStudyCode: 'civil_law',
      subjectAdminCode: 'civil_land_titles',
      part: null,
      label: 'Civil Law',
      status: 'already_ingested',
      existingSittingId: 's-2018-civil',
      existingQuestionCount: 22,
      sourceUrl: 'https://lawphil.net/courts/bm/barQ/2018/civilQ.html',
    },
    {
      year: 2018,
      subjectSlug: 'laborQ',
      subjectStudyCode: 'labor_law',
      subjectAdminCode: 'labor_social',
      part: null,
      label: 'Labor Law and Social Legislation',
      status: 'pending',
      existingSittingId: null,
      existingQuestionCount: null,
      sourceUrl: 'https://lawphil.net/courts/bm/barQ/2018/laborQ.html',
    },
  ],
  totals: {
    pending: 2,
    alreadyIngested: 1,
    totalCombinations: 3,
    estimatedQuestionsLow: 40,
    estimatedQuestionsHigh: 50,
    estimatedFetchMinutes: 1,
    estimatedFetchWindowsNeeded: 1,
  },
  configuredFetchWindow: {
    tz: 'America/New_York',
    startHour: 13,
    endHour: 18,
  },
};

function renderDialog(overrides?: Partial<React.ComponentProps<typeof BackfillDialog>>) {
  const props: React.ComponentProps<typeof BackfillDialog> = {
    open: true,
    plan: samplePlan,
    isLoadingPlan: false,
    planError: null,
    isDispatching: false,
    onCancel: vi.fn(),
    onDispatch: vi.fn(),
    ...overrides,
  };
  render(<BackfillDialog {...props} />);
  return props;
}

describe('BackfillDialog', () => {
  it('renders summary card with pending count and time estimate', () => {
    renderDialog();
    expect(
      screen.getByText(/Will fetch 2 new sittings/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/40–50 questions/)).toBeInTheDocument();
    expect(screen.getByText(/1 minute/)).toBeInTheDocument();
    // "1PM–6PM" appears twice (summary card + footer); both must render.
    expect(screen.getAllByText(/1PM–6PM/)).toHaveLength(2);
    expect(
      screen.getByText(/Years absent \(2019, 2020, 2021\)/),
    ).toBeInTheDocument();
  });

  it('renders one row per sitting in the itemized table', () => {
    renderDialog();
    // Three rows in tbody (criminal, civil, labor).
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
  });

  it('default-checks pending rows and disables already_ingested rows', () => {
    renderDialog();
    const civilCheckbox = screen.getByLabelText(
      'Include 2018 Civil Law',
    ) as HTMLInputElement;
    const criminalCheckbox = screen.getByLabelText(
      'Include 2018 Criminal Law',
    ) as HTMLInputElement;

    expect(civilCheckbox.disabled).toBe(true);
    expect(civilCheckbox.checked).toBe(false);
    expect(criminalCheckbox.disabled).toBe(false);
    expect(criminalCheckbox.checked).toBe(true);
  });

  it('updates dispatch count as pending rows are unchecked', () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: /Dispatch 2 sittings/ }),
    ).toBeInTheDocument();

    const criminalCheckbox = screen.getByLabelText('Include 2018 Criminal Law');
    fireEvent.click(criminalCheckbox);

    expect(
      screen.getByRole('button', { name: /Dispatch 1 sitting/ }),
    ).toBeInTheDocument();
  });

  it('disables dispatch when no rows are checked', () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText('Include 2018 Criminal Law'));
    fireEvent.click(
      screen.getByLabelText('Include 2018 Labor Law and Social Legislation'),
    );

    const dispatchBtn = screen.getByRole('button', {
      name: /Dispatch 0 sittings/,
    });
    expect(dispatchBtn).toBeDisabled();
  });

  it('passes only the checked pending rows to onDispatch', () => {
    const onDispatch = vi.fn();
    renderDialog({ onDispatch });

    fireEvent.click(
      screen.getByLabelText('Include 2018 Labor Law and Social Legislation'),
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Dispatch 1 sitting/ }),
    );

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith([
      { year: 2018, subjectSlug: 'criminalQ' },
    ]);
  });

  it('shows loading state when plan is loading', () => {
    renderDialog({ plan: null, isLoadingPlan: true });
    expect(screen.getByText(/Loading plan/i)).toBeInTheDocument();
  });

  it('shows error state when plan failed to load', () => {
    renderDialog({ plan: null, isLoadingPlan: false, planError: 'boom' });
    expect(
      screen.getByText(/Failed to load plan: boom/),
    ).toBeInTheDocument();
  });

  it('invokes onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <BackfillDialog
        open={false}
        plan={samplePlan}
        isLoadingPlan={false}
        planError={null}
        isDispatching={false}
        onCancel={() => {}}
        onDispatch={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
