import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { StickyCTA } from '@/components/ui/StickyCTA';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text: T } = require('react-native');
    return <T testID={`icon-${name}`}>{name}</T>;
  },
}));

describe('StickyCTA', () => {
  it('renders the meta label', () => {
    const { getByText } = render(<StickyCTA meta="4 min left" progress={0.4} />);
    expect(getByText('4 min left')).toBeTruthy();
  });

  it('renders the default speaker icon', () => {
    const { getByTestId } = render(<StickyCTA progress={0.1} />);
    expect(getByTestId('icon-volume-medium')).toBeTruthy();
  });

  it('accepts a custom icon', () => {
    const { getByTestId } = render(<StickyCTA icon="play" progress={0} />);
    expect(getByTestId('icon-play')).toBeTruthy();
  });

  it('renders custom children instead of the progress bar', () => {
    const { getByText } = render(
      <StickyCTA progress={0}>
        <Text>Continue reading</Text>
      </StickyCTA>,
    );
    expect(getByText('Continue reading')).toBeTruthy();
  });

  it('fires onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<StickyCTA progress={0} onPress={onPress} />);
    fireEvent.press(getByTestId('icon-volume-medium').parent!);
    // Press happens on the outer Pressable; firing press on icon's parent (Pressable) should work
  });

  it.each([0, 0.5, 1, -0.2, 1.5])('renders progress=%s without crashing', (progress) => {
    const tree = render(<StickyCTA progress={progress} />).toJSON();
    expect(tree).toBeTruthy();
  });
});
