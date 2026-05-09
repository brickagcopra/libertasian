import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card, type CardTone } from '@/components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    const { getByText } = render(
      <Card>
        <Text>hello</Text>
      </Card>,
    );
    expect(getByText('hello')).toBeTruthy();
  });

  it('renders unpadded when padded={false}', () => {
    const { getByText } = render(
      <Card padded={false}>
        <Text>tight</Text>
      </Card>,
    );
    expect(getByText('tight')).toBeTruthy();
  });

  it.each<CardTone>(['surface', 'muted', 'pill', 'accent-soft'])(
    'renders tone %s without crashing',
    (tone) => {
      const { getByText } = render(
        <Card tone={tone}>
          <Text>{tone}</Text>
        </Card>,
      );
      expect(getByText(tone)).toBeTruthy();
    },
  );

  it('accepts an explicit radius', () => {
    const { getByText } = render(
      <Card radius={4}>
        <Text>tight-radius</Text>
      </Card>,
    );
    expect(getByText('tight-radius')).toBeTruthy();
  });
});
