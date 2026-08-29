import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import LibraryHubScreen from '@/app/(tabs)/library/index';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

const DERIVATIVE_LABELS = [
  'Case Digests',
  'Doctrine Extracts',
  'MCQs',
  'Essay Prompts',
  'Subject Outlines',
  'Flashcards',
  'Essay Model Answers',
  'Suggested Bar Answers',
  'Sample Pleadings',
  'Sample Contracts',
  'One-Page Summaries',
];

describe('LibraryHubScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('entitled account', () => {
    beforeEach(() => {
      setEntitled();
    });

    it('renders a tile for each of the 11 derivative types', () => {
      const { queryByText } = render(<LibraryHubScreen />);
      for (const label of DERIVATIVE_LABELS) {
        expect({ label, present: queryByText(label) !== null }).toEqual({
          label,
          present: true,
        });
      }
    });

    it('routes to /library/<slug> when a tile is pressed', () => {
      const { getByLabelText } = render(<LibraryHubScreen />);
      fireEvent.press(getByLabelText('Browse Case Digests'));
      expect(router.push).toHaveBeenCalledWith('/library/digests');
    });
  });

  describe('free tier', () => {
    beforeEach(() => {
      setFreeTier();
    });

    it('omits every derivative type — a catalogue of what it cannot open', () => {
      const { queryByText } = render(<LibraryHubScreen />);
      for (const label of DERIVATIVE_LABELS) {
        expect({ label, present: queryByText(label) !== null }).toEqual({
          label,
          present: false,
        });
      }
    });

    it('omits rather than disables — nothing takes their place', () => {
      const { queryByText } = render(<LibraryHubScreen />);
      for (const word of ['Locked', 'Upgrade', 'Pro', 'Plan', 'Premium']) {
        expect(queryByText(word)).toBeNull();
      }
    });

    it('still offers the free corpus, so the tab is never empty', () => {
      const { getByText } = render(<LibraryHubScreen />);
      expect(getByText('Codals')).toBeTruthy();
      expect(getByText('Legal Documents')).toBeTruthy();
    });

    it('routes to the ungated codal reader', () => {
      // The one corpus the free tier is entitled to read. It used to sit
      // inside the guarded /study subtree and redirect on entry.
      const { getByLabelText } = render(<LibraryHubScreen />);
      fireEvent.press(getByLabelText('Browse Codals'));
      expect(router.push).toHaveBeenCalledWith('/codals/');
    });

    it('routes to the document browser', () => {
      // Its only other entry point is the Study tab, which is hidden — so
      // without this tile a free account cannot reach /documents at all.
      const { getByLabelText } = render(<LibraryHubScreen />);
      fireEvent.press(getByLabelText('Browse Legal Documents'));
      expect(router.push).toHaveBeenCalledWith('/documents');
    });
  });

  it('keeps the corpus entries for an entitled account too', () => {
    setEntitled();
    const { getByText } = render(<LibraryHubScreen />);
    expect(getByText('Codals')).toBeTruthy();
    expect(getByText('Legal Documents')).toBeTruthy();
  });
});
