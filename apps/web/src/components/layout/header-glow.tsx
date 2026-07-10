/**
 * HeaderGlow — decorative ambient glass layer for header/nav surfaces.
 *
 * Renders soft radial-gradient blobs (warm palette tokens only) that drift
 * slowly via transform-only CSS animations (compositor-friendly, no JS).
 * Blob styles + @keyframes live in `globals.css` under "Ambient glass
 * header decoration". Purely decorative: aria-hidden and pointer-events-none
 * so it never intercepts interaction or reaches the accessibility tree.
 *
 * Mount inside a positioned container (the header itself) and keep sibling
 * content at `relative z-10` so text always renders above the glow.
 */
export function HeaderGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div className="header-glow-blob header-glow-blob-1" />
      <div className="header-glow-blob header-glow-blob-2" />
      <div className="header-glow-blob header-glow-blob-3" />
    </div>
  );
}
