import { render } from '@testing-library/react-native';
import { Photo } from '@/components/ui/Photo';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) => (
      <View {...props}>{children}</View>
    ),
  };
});

describe('Photo', () => {
  it('renders without headline or label', () => {
    const tree = render(<Photo />).toJSON();
    expect(tree).toBeTruthy();
  });

  it('renders the headline when provided', () => {
    const { getByText } = render(<Photo headline="A bold headline" />);
    expect(getByText('A bold headline')).toBeTruthy();
  });

  it('renders the eyebrow label when provided', () => {
    const { getByText } = render(<Photo label="hero photo" />);
    expect(getByText('hero photo')).toBeTruthy();
  });

  it.each(['warm', 'cool', 'sage', 'plum', 'sand', 'ink', 'lime'] as const)(
    'renders tone %s',
    (tone) => {
      const tree = render(<Photo tone={tone} headline="t" />).toJSON();
      expect(tree).toBeTruthy();
    },
  );
});
