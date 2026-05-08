import { fireEvent, render } from '@testing-library/react-native';
import { Chip, type ChipTone } from '@/components/ui/Chip';

describe('Chip', () => {
  it('renders the label', () => {
    const { getByText } = render(<Chip label="All" />);
    expect(getByText('All')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Chip label="Active" onPress={onPress} />);
    fireEvent.press(getByText('Active'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each<ChipTone>(['neutral', 'accent'])(
    'renders tone %s in selected and unselected state',
    (tone) => {
      const { getByText, rerender } = render(
        <Chip label={`${tone}-off`} tone={tone} selected={false} />,
      );
      expect(getByText(`${tone}-off`)).toBeTruthy();
      rerender(<Chip label={`${tone}-on`} tone={tone} selected />);
      expect(getByText(`${tone}-on`)).toBeTruthy();
    },
  );
});
