import { render } from '@testing-library/react-native';
import { Logo } from '@/components/ui/Logo';

describe('Logo', () => {
  it('renders the wordmark by default', () => {
    const { getByText } = render(<Logo />);
    expect(getByText('Libertasian')).toBeTruthy();
    expect(getByText('L')).toBeTruthy();
  });

  it('renders only the mark when markOnly=true', () => {
    const { queryByText, getByText } = render(<Logo markOnly />);
    expect(queryByText('Libertasian')).toBeNull();
    expect(getByText('L')).toBeTruthy();
  });

  it('accepts a size prop without crashing', () => {
    const { getByText } = render(<Logo size={48} />);
    expect(getByText('Libertasian')).toBeTruthy();
  });
});
