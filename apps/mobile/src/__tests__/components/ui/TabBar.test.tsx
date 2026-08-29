import { fireEvent, render } from '@testing-library/react-native';
import { TabBar } from '@/components/ui/TabBar';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

describe('TabBar', () => {
  // The bar filters itself by entitlement, so every case has to say which
  // account it is standing in. Entitled is the baseline here; the free-tier
  // cases have their own block at the bottom.
  beforeEach(() => {
    setEntitled();
  });

  it('renders all eight default labels, in order', () => {
    const { getByText } = render(<TabBar active="home" />);
    for (const label of ['Read', 'Library', 'Search', 'Digests', 'Study', 'Feed', 'Work', 'Me']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  // Scan keeps its FAB (components/ui/Fab.tsx) — it is deliberately not a slot
  // in the bar, and adding it would be a ninth item on a 375pt screen.
  it('does not include a Scan slot', () => {
    const { queryByText } = render(<TabBar active="home" />);
    expect(queryByText('Scan')).toBeNull();
  });

  // Eight slots on a 375pt screen is ~44pt each, so "Digests" is the label most
  // at risk of clipping at 360pt. One line, no ellipsis: losing a character is
  // preferable to shrinking the type below 9pt.
  it('keeps labels to a single line without truncating them', () => {
    const { getByText } = render(<TabBar active="home" />);
    expect(getByText('Digests').props.numberOfLines).toBe(1);
    expect(getByText('Digests').props.ellipsizeMode).toBeUndefined();
  });

  it.each(['digests', 'study', 'feed', 'workspace'] as const)(
    'can mark the new %s tab active',
    (id) => {
      const labels = {
        digests: 'Digests',
        study: 'Study',
        feed: 'Feed',
        workspace: 'Work',
      } as const;
      const { getByLabelText } = render(<TabBar active={id} />);
      expect(getByLabelText(labels[id]).props.accessibilityState).toMatchObject({
        selected: true,
      });
    },
  );

  it('marks the active tab with selected accessibilityState', () => {
    const { getByLabelText } = render(<TabBar active="docs" />);
    const docsTab = getByLabelText('Library');
    expect(docsTab.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('uses solid icon for the active tab and outline for inactive', () => {
    const { getByTestId, queryByTestId } = render(<TabBar active="me" />);
    expect(getByTestId('icon-person')).toBeTruthy();
    expect(getByTestId('icon-home-outline')).toBeTruthy();
    expect(queryByTestId('icon-person-outline')).toBeNull();
  });

  it('fires onPress with the tab id', () => {
    const onPress = jest.fn();
    const { getByText } = render(<TabBar active="home" onPress={onPress} />);
    fireEvent.press(getByText('Search'));
    expect(onPress).toHaveBeenCalledWith('search');
  });

  describe('free tier', () => {
    beforeEach(() => {
      setFreeTier();
    });

    it.each(['Study', 'Work'])(
      'drops the %s slot entirely — no label, no lock, no notice',
      (label) => {
        const { queryByText } = render(<TabBar active="home" />);

        expect(queryByText(label)).toBeNull();
        // Hidden means hidden: nothing takes its place.
        for (const word of ['Locked', 'Upgrade', 'Pro', 'Plan', 'Premium']) {
          expect(queryByText(word)).toBeNull();
        }
      },
    );

    it('keeps Library — the corpus browser is the way in to the free codals', () => {
      const { getByText } = render(<TabBar active="home" />);
      expect(getByText('Library')).toBeTruthy();
    });

    it('keeps the other five slots', () => {
      const { getByText } = render(<TabBar active="home" />);
      for (const label of ['Read', 'Library', 'Search', 'Digests', 'Feed', 'Me']) {
        expect(getByText(label)).toBeTruthy();
      }
    });

    it('still honours an explicit items prop', () => {
      const { getByText } = render(
        <TabBar
          active="study"
          items={[{ id: 'study', label: 'Study', icon: 'school' }]}
        />,
      );
      // A caller passing its own list has already decided what belongs there.
      expect(getByText('Study')).toBeTruthy();
    });
  });
});
