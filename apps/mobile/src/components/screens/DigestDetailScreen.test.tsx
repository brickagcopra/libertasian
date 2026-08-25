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

/**
 * Bookmark and More shipped as unconditional buttons whose only behaviour was
 * a "coming soon" alert — Guideline 2.1 (App Completeness), the same defect as
 * the dead SSO button removed in #418. Digests are not bookmarkable
 * server-side either (create-bookmark.dto.ts takes a legalDocumentId only), so
 * the fix is removal, not wiring.
 *
 * They now render only when a handler is supplied, which keeps the component
 * reusable for a caller that one day has a real one. Share is unconditional on
 * purpose: it is wired to a genuine Share.share() call.
 */
describe('DigestDetailScreen — header controls', () => {
  const props = {
    headline: 'Spouses Hing v. Choachuy',
    eyebrow: 'Case digest \u00b7 Civil Law',
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

  it('omits Bookmark and More when no handler is supplied, and keeps Share', () => {
    const { queryByLabelText } = render(<DigestDetailScreen {...props} />);

    expect(queryByLabelText('Bookmark')).toBeNull();
    expect(queryByLabelText('More')).toBeNull();
    expect(queryByLabelText('Share')).toBeTruthy();
  });

  it('renders Bookmark and More once real handlers are supplied', () => {
    const { queryByLabelText } = render(
      <DigestDetailScreen {...props} onBookmark={jest.fn()} onMore={jest.fn()} />,
    );

    expect(queryByLabelText('Bookmark')).toBeTruthy();
    expect(queryByLabelText('More')).toBeTruthy();
  });
});
