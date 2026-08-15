import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Fab } from '@/components/ui/Fab';
import {
  TabBar,
  TAB_BAR_HEIGHT,
  TAB_BAR_BOTTOM_INSET,
} from '@/components/ui/TabBar';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

/**
 * The global safe-area mock in src/test/setup.ts reports bottom: 34 — the
 * notched-iPhone case where this collision actually happened.
 */
const INSET_BOTTOM = 34;

/** Where the top edge of the TabBar sits, measured from the bottom of the screen. */
const TAB_BAR_TOP_EDGE =
  Math.max(TAB_BAR_BOTTOM_INSET, INSET_BOTTOM) + TAB_BAR_HEIGHT;

function flattenStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, number>;
}

describe('TabBar / FAB clearance', () => {
  it('puts the TabBar top edge at 98 on a notched device', () => {
    // Guards the arithmetic the rest of this suite depends on: 34 + 64.
    expect(TAB_BAR_TOP_EDGE).toBe(98);
  });

  it('positions the TabBar against the safe-area inset, not the design value', () => {
    // The bar is the single root node the component renders.
    const bar = render(<TabBar active="home" />).toJSON() as {
      props: { style?: unknown };
    };
    const style = flattenStyle(bar);
    expect(style['bottom']).toBe(Math.max(TAB_BAR_BOTTOM_INSET, INSET_BOTTOM));
    expect(style['height']).toBe(TAB_BAR_HEIGHT);
  });

  it("resolves the FAB's bottom above the TabBar's top edge", () => {
    const { getByLabelText } = render(<Fab />);
    const style = flattenStyle(getByLabelText('Scan') as never);

    // The regression this fixes: the old default was 90, i.e. 8pt BELOW the
    // bar's top edge, so the bar painted over the FAB.
    expect(style['bottom']).toBeGreaterThan(TAB_BAR_TOP_EDGE);
    expect(style['bottom']).not.toBe(90);
  });

  it('still honours an explicit bottom override', () => {
    const { getByLabelText } = render(<Fab bottom={200} />);
    expect(flattenStyle(getByLabelText('Scan') as never)['bottom']).toBe(200);
  });
});
