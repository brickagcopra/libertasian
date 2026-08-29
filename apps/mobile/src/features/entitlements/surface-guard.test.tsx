import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { storage, STORAGE_KEYS } from '../../storage/mmkv';
import { SurfaceGuard } from './surface-guard';

jest.mock('expo-router', () => {
  const { Text: RNText } = require('react-native');
  const Stack = Object.assign(
    ({ children }: { children?: unknown }) => (
      <RNText testID="stack">{'stack'}</RNText>
    ),
    { Screen: () => null },
  );
  return {
    Stack,
    Redirect: ({ href }: { href: string }) => (
      <RNText testID="redirect">{href}</RNText>
    ),
  };
});

// The three real layouts, so this asserts against what actually ships rather
// than a stand-in wrapper.
import CodalsLayout from '../../app/codals/_layout';
import StudyLayout from '../../app/study/_layout';
import WorkspaceLayout from '../../app/workspace/_layout';

const persist = (surfaces: Record<string, boolean>) =>
  storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(surfaces));

const ALL_HIDDEN = {
  scan: false,
  study: false,
  barExams: false,
  digestGeneration: false,
  workspace: false,
};

const ALL_VISIBLE = {
  scan: true,
  study: true,
  barExams: true,
  digestGeneration: true,
  workspace: true,
};

beforeEach(() => {
  storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
});

/**
 * Hiding an entry point removes the way IN, not the route. This is what stands
 * between a deep link and a screen that would load and then refuse.
 */
describe('SurfaceGuard', () => {
  it('renders the subtree when the surface is available', () => {
    persist(ALL_VISIBLE);

    const { getByText, queryByTestId } = render(
      <SurfaceGuard surface="scan">
        <Text>Capture</Text>
      </SurfaceGuard>,
    );

    expect(getByText('Capture')).toBeTruthy();
    expect(queryByTestId('redirect')).toBeNull();
  });

  it('redirects home when the surface is hidden', () => {
    persist(ALL_HIDDEN);

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
    persist({ ...ALL_HIDDEN, scan: true });

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
    persist(ALL_HIDDEN);

    const { queryByText } = render(
      <SurfaceGuard surface="study">
        <Text>Flashcards</Text>
      </SurfaceGuard>,
    );

    for (const word of ['Upgrade', 'Locked', 'Not available', 'Pro', 'Plan']) {
      expect(queryByText(word)).toBeNull();
    }
  });

  /**
   * What a free account can and cannot reach, asserted against the guard
   * itself rather than against any one screen.
   *
   * The mapping, not the mechanism, was the bug: statutory codals are the one
   * corpus the free tier is entitled to read, and they sat inside the guarded
   * `/study` subtree — so the single free feature redirected on entry while
   * the paid catalogue stayed open.
   */
  describe('free tier', () => {
    beforeEach(() => {
      persist(ALL_HIDDEN);
    });

    it('reaches the codal reader — /codals carries no guard at all', () => {
      const { getByTestId, queryByTestId } = render(<CodalsLayout />);

      expect(getByTestId('stack')).toBeTruthy();
      expect(queryByTestId('redirect')).toBeNull();
    });

    it.each([
      ['/study', StudyLayout],
      ['/workspace', WorkspaceLayout],
    ] as const)('is redirected away from %s', (_route, Layout) => {
      const { getByTestId, queryByTestId } = render(<Layout />);

      expect(getByTestId('redirect').props.children).toBe('/(tabs)');
      expect(queryByTestId('stack')).toBeNull();
    });

    it.each([
      ['study', 'Flashcards'],
      ['workspace', 'Matters'],
      ['scan', 'Capture'],
      ['barExams', '2019 Bar'],
      ['digestGeneration', 'Generate digest'],
    ] as const)('redirects away from %s', (surface, child) => {
      const { getByTestId, queryByText } = render(
        <SurfaceGuard surface={surface}>
          <Text>{child}</Text>
        </SurfaceGuard>,
      );

      expect(getByTestId('redirect').props.children).toBe('/(tabs)');
      expect(queryByText(child)).toBeNull();
    });
  });

  it('lets an entitled account through every surface', () => {
    persist(ALL_VISIBLE);

    for (const surface of Object.keys(ALL_VISIBLE) as (keyof typeof ALL_VISIBLE)[]) {
      const { queryByTestId } = render(
        <SurfaceGuard surface={surface}>
          <Text>{surface}</Text>
        </SurfaceGuard>,
      );
      expect({ surface, redirected: queryByTestId('redirect') !== null }).toEqual({
        surface,
        redirected: false,
      });
    }
  });
});
