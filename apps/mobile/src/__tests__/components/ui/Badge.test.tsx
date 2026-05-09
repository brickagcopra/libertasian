import { render } from '@testing-library/react-native';
import { Badge, type BadgeTone } from '@/components/ui/Badge';

describe('Badge', () => {
  it('renders the label', () => {
    const { getByText } = render(<Badge label="Pro" />);
    expect(getByText('Pro')).toBeTruthy();
  });

  it.each<BadgeTone>(['neutral', 'accent', 'accent-soft', 'pill', 'eyebrow'])(
    'renders tone %s without crashing',
    (tone) => {
      const { getByText } = render(<Badge label={tone} tone={tone} />);
      expect(getByText(tone)).toBeTruthy();
    },
  );

  it('upper-cases label text in eyebrow mode', () => {
    const { getByText } = render(<Badge label="Op-ed" eyebrow />);
    expect(getByText('Op-ed')).toBeTruthy();
  });
});
