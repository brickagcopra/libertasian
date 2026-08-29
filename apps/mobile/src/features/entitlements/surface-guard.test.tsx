import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { storage, STORAGE_KEYS } from '../../storage/mmkv';
import { SurfaceGuard } from './surface-guard';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: RNText } = require('react-native');
    return <RNText testID="redirect">{href}</RNText>;
  },
}));

const persist = (surfaces: Record<string, boolean>) =>
  storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(surfaces));

beforeEach(() => {
  storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
});

/**
 * Hiding an entry point removes the way IN, not the route. This is what stands
 * between a deep link and a screen that would load and then refuse.
 */
describe('SurfaceGuard', () => {
  it('renders the subtree when the surface is available', () => {
    persist({ scan: true, study: true, barExams: true });

    const { getByText, queryByTestId } = render(
      <SurfaceGuard surface="scan">
        <Text>Capture</Text>
      </SurfaceGuard>,
    );

    expect(getByText('Capture')).toBeTruthy();
    expect(queryByTestId('redirect')).toBeNull();
  });

  it('redirects home when the surface is hidden', () => {
    persist({ scan: false, study: false, barExams: false });

    const { getByTestId, queryByText } = render(
      <SurfaceGuard surface="scan">
        <Text>Capture</Text>
      </SurfaceGuard>,
    );

    expect(getByTestId('redirect').props.children).toBe('/(tabs)');
    // The subtree never mounts, so it fires no requests and paints no frame
    // of paid UI before navigating away.
    expect(queryByText('Capture')).toBeNull();
  });

  it('gates each surface independently', () => {
    persist({ scan: true, study: false, barExams: false });

    const scan = render(
      <SurfaceGuard surface="scan">
        <Text>Capture</Text>
      </SurfaceGuard>,
    );
    expect(scan.getByText('Capture')).toBeTruthy();

    const study = render(
      <SurfaceGuard surface="study">
        <Text>Flashcards</Text>
      </SurfaceGuard>,
    );
    expect(study.queryByText('Flashcards')).toBeNull();
  });

  it('redirects before the first resolution', () => {
    // Nothing persisted yet. Sending a brand-new user home is a smaller harm
    // than showing them a refusal, and the answer is remembered afterwards.
    const { getByTestId } = render(
      <SurfaceGuard surface="barExams">
        <Text>2019 Bar</Text>
      </SurfaceGuard>,
    );

    expect(getByTestId('redirect')).toBeTruthy();
  });

  it('shows no explanation of any kind when it redirects', () => {
    persist({ scan: false, study: false, barExams: false });

    const { queryByText } = render(
      <SurfaceGuard surface="study">
        <Text>Flashcards</Text>
      </SurfaceGuard>,
    );

    for (const word of ['Upgrade', 'Locked', 'Not available', 'Pro', 'Plan']) {
      expect(queryByText(word)).toBeNull();
    }
  });
});
