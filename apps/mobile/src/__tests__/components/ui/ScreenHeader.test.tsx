import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';

const mockBack = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack(),
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text: T } = require('react-native');
    return <T testID={`icon-${name}`}>{name}</T>;
  },
}));

describe('ScreenHeader', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockCanGoBack.mockReset();
    mockCanGoBack.mockReturnValue(true);
  });

  it('renders the title', () => {
    const { getByText } = render(<ScreenHeader title="Matters" />);
    expect(getByText('Matters')).toBeTruthy();
  });

  it('renders back button by default', () => {
    const { getByLabelText } = render(<ScreenHeader title="X" />);
    expect(getByLabelText('Go back')).toBeTruthy();
  });

  it('hides back button when showBack=false', () => {
    const { queryByLabelText } = render(<ScreenHeader title="X" showBack={false} />);
    expect(queryByLabelText('Go back')).toBeNull();
  });

  it('calls router.back() when back is pressed and history exists', () => {
    const { getByLabelText } = render(<ScreenHeader title="X" />);
    fireEvent.press(getByLabelText('Go back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not call router.back() when canGoBack() is false', () => {
    mockCanGoBack.mockReturnValue(false);
    const { getByLabelText } = render(<ScreenHeader title="X" />);
    fireEvent.press(getByLabelText('Go back'));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('uses custom onBack when provided', () => {
    const onBack = jest.fn();
    const { getByLabelText } = render(<ScreenHeader title="X" onBack={onBack} />);
    fireEvent.press(getByLabelText('Go back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('renders rightAction slot', () => {
    const { getByText } = render(
      <ScreenHeader title="X" rightAction={<Text>EDIT</Text>} />,
    );
    expect(getByText('EDIT')).toBeTruthy();
  });
});
