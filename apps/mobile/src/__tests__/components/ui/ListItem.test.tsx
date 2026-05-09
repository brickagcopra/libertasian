import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ListItem } from '@/components/ui/ListItem';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text: T } = require('react-native');
    return <T testID={`icon-${name}`}>{name}</T>;
  },
}));

describe('ListItem', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(<ListItem title="Settings" subtitle="App preferences" />);
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('App preferences')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<ListItem title="Tap" onPress={onPress} />);
    fireEvent.press(getByText('Tap'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders leading icon when provided', () => {
    const { getByTestId } = render(<ListItem title="Profile" leadingIcon="person-outline" />);
    expect(getByTestId('icon-person-outline')).toBeTruthy();
  });

  it('renders chevron by default and hides it with showChevron=false', () => {
    const { getByTestId, queryByTestId, rerender } = render(<ListItem title="A" />);
    expect(getByTestId('icon-chevron-forward')).toBeTruthy();
    rerender(<ListItem title="A" showChevron={false} />);
    expect(queryByTestId('icon-chevron-forward')).toBeNull();
  });

  it('renders custom trailing element instead of chevron', () => {
    const { getByText, queryByTestId } = render(
      <ListItem title="A" trailing={<Text>NEW</Text>} />,
    );
    expect(getByText('NEW')).toBeTruthy();
    expect(queryByTestId('icon-chevron-forward')).toBeNull();
  });
});
