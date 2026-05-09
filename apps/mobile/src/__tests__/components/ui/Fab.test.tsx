import { fireEvent, render } from '@testing-library/react-native';
import { Fab } from '@/components/ui/Fab';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

describe('Fab', () => {
  it('renders the default camera icon', () => {
    const { getByTestId } = render(<Fab />);
    expect(getByTestId('icon-camera')).toBeTruthy();
  });

  it('uses the provided icon override', () => {
    const { getByTestId, queryByTestId } = render(<Fab icon="add" />);
    expect(getByTestId('icon-add')).toBeTruthy();
    expect(queryByTestId('icon-camera')).toBeNull();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<Fab onPress={onPress} />);
    fireEvent.press(getByLabelText('Scan'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses a custom accessibility label when provided', () => {
    const { getByLabelText } = render(<Fab accessibilityLabel="Add note" />);
    expect(getByLabelText('Add note')).toBeTruthy();
  });

  it('renders without crashing at custom size and offsets', () => {
    const tree = render(<Fab size={72} bottom={120} right={24} />).toJSON();
    expect(tree).toBeTruthy();
  });
});
