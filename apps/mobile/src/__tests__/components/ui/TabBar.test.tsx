import { fireEvent, render } from '@testing-library/react-native';
import { TabBar } from '@/components/ui/TabBar';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

describe('TabBar', () => {
  it('renders all four default labels', () => {
    const { getByText } = render(<TabBar active="home" />);
    expect(getByText('Read')).toBeTruthy();
    expect(getByText('Library')).toBeTruthy();
    expect(getByText('Search')).toBeTruthy();
    expect(getByText('Me')).toBeTruthy();
  });

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
});
