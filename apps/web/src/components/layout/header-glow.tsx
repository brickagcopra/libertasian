import { Owl } from '@/components/brand/owl';

/**
 * HeaderGlow — decorative ambient glass layer for header/nav surfaces.
 *
 * Renders soft radial-gradient blobs (warm accent tokens only) that drift
 * slowly via transform-only CSS animations (compositor-friendly, no JS),
 * plus a faint bobbing owl mascot peeking into the surface. Blob/owl styles
 * and @keyframes live in `globals.css` under "Ambient glass header
 * decoration". Purely decorative: aria-hidden and pointer-events-none so it
 * never intercepts interaction or reaches the accessibility tree (the
 * aria-hidden wrapper also removes the Owl's role="img" from the tree).
 *
 * Mount inside a positioned container (the header itself) and keep sibling
 * content at `relative z-10` so text always renders above the glow.
 *
 * Variants:
 * - `band` (default): taller surfaces — public header, auth top band (h-40).
 *   Larger owl peeking up from the bottom edge.
 * - `bar`: the h-14 dashboard header. Smaller owl, bottom-cropped so just
 *   the head/ears peek into the bar.
 */
export type HeaderGlowVariant = 'band' | 'bar';

const OWL_SIZE: Record<HeaderGlowVariant, number> = {
  band: 132,
  bar: 80,
};

interface HeaderGlowProps {
  variant?: HeaderGlowVariant;
}

export function HeaderGlow({ variant = 'band' }: HeaderGlowProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div className="header-glow-blob header-glow-blob-1" />
      <div className="header-glow-blob header-glow-blob-2" />
      <div className="header-glow-blob header-glow-blob-3" />
      <div className={`header-glow-owl header-glow-owl-${variant}`}>
        <Owl size={OWL_SIZE[variant]} />
      </div>
    </div>
  );
}
