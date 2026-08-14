import { render } from '@testing-library/react-native';

import { DigestDetailScreen } from './DigestDetailScreen';

/**
 * The hero used `<Photo label="hero · digest" />`, and `Photo` renders `label`
 * as visible uppercase text over the image. This is a shipping screen, so a
 * design-time placeholder marker was legible to any reviewer opening a digest
 * (App Store guideline 2.1, placeholder content).
 *
 * `Photo`'s `label` prop is legitimate and still used by `OnboardingScreen`;
 * only this call site was wrong. The assertion is therefore on the rendered
 * text of this screen, not on the prop's existence.
 */
describe('DigestDetailScreen — no placeholder markers', () => {
  const props = {
    headline: 'Spouses Hing v. Choachuy',
    eyebrow: 'Case digest · Civil Law',
    author: { name: 'LIBERTASIAN Editorial', meta: '4 min read' },
    intro: 'The Court resolved whether the installation of CCTV cameras...',
    tldr: 'Right to privacy extends to a business office.',
    sections: [
      {
        id: 'facts',
        heading: 'Facts',
        paragraphs: ['Respondents installed cameras overlooking the property.'],
      },
    ],
  };

  it('renders no "hero · digest" placeholder label', () => {
    const { queryByText } = render(<DigestDetailScreen {...props} />);

    expect(queryByText('hero · digest')).toBeNull();
  });

  it('renders no placeholder marker text of any kind over the hero', () => {
    const { queryByText } = render(<DigestDetailScreen {...props} />);

    expect(queryByText(/hero\s*·/i)).toBeNull();
  });

  it('still renders the digest content', () => {
    const { getByText } = render(<DigestDetailScreen {...props} />);

    expect(getByText('Spouses Hing v. Choachuy')).toBeTruthy();
    expect(getByText('Facts')).toBeTruthy();
  });
});
