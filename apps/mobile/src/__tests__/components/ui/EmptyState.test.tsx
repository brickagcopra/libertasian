import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { EmptyState } from '@/components/ui/EmptyState';

describe('EmptyState', () => {
  it('renders heading only', () => {
    const { getByText } = render(<EmptyState heading="Nothing here" />);
    expect(getByText('Nothing here')).toBeTruthy();
  });

  it('renders body when provided', () => {
    const { getByText } = render(<EmptyState heading="H" body="Some explanation" />);
    expect(getByText('Some explanation')).toBeTruthy();
  });

  it('renders illustration slot', () => {
    const { getByText } = render(
      <EmptyState heading="H" illustration={<Text>ILLUS</Text>} />,
    );
    expect(getByText('ILLUS')).toBeTruthy();
  });

  it('fires primaryCta and secondaryCta onPress', () => {
    const primaryCta = { label: 'Create', onPress: jest.fn() };
    const secondaryCta = { label: 'Learn more', onPress: jest.fn() };
    const { getByText } = render(
      <EmptyState heading="H" primaryCta={primaryCta} secondaryCta={secondaryCta} />,
    );
    fireEvent.press(getByText('Create'));
    fireEvent.press(getByText('Learn more'));
    expect(primaryCta.onPress).toHaveBeenCalledTimes(1);
    expect(secondaryCta.onPress).toHaveBeenCalledTimes(1);
  });
});
