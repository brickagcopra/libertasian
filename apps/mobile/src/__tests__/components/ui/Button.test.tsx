import { fireEvent, render } from '@testing-library/react-native';
import { Button, type ButtonVariant } from '@/components/ui/Button';

describe('Button', () => {
  it('renders the label', () => {
    const { getByText } = render(<Button label="Save" />);
    expect(getByText('Save')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Tap me" onPress={onPress} />);
    fireEvent.press(getByText('Tap me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Off" onPress={onPress} disabled />);
    fireEvent.press(getByText('Off'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each<ButtonVariant>(['primary', 'accent', 'secondary', 'ghost', 'soft', 'destructive'])(
    'renders variant %s without crashing',
    (variant) => {
      const { getByText } = render(<Button label={variant} variant={variant} />);
      expect(getByText(variant)).toBeTruthy();
    },
  );

  it('respects the full prop', () => {
    const { getByText } = render(<Button label="Full width" full />);
    expect(getByText('Full width')).toBeTruthy();
  });
});
