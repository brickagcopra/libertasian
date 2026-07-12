import type { AnnotationColor } from './types';

/**
 * Highlight palette matching web's Tailwind classes
 * (apps/web/src/app/(dashboard)/reader/[id]/page.tsx — HIGHLIGHT_BG / COLOR_LABELS):
 * tint  ≈ `bg-{color}-200/60` rendered as a low-opacity rgba of the -400 tone
 *         so it blends with either mobile theme background,
 * solid = Tailwind `{color}-400` (swatches, dots, left borders).
 */
export const ANNOTATION_COLOR_STYLES: Record<
  AnnotationColor,
  { tint: string; solid: string }
> = {
  yellow: { tint: 'rgba(250, 204, 21, 0.18)', solid: '#FACC15' },
  green: { tint: 'rgba(74, 222, 128, 0.18)', solid: '#4ADE80' },
  blue: { tint: 'rgba(96, 165, 250, 0.18)', solid: '#60A5FA' },
  red: { tint: 'rgba(248, 113, 113, 0.18)', solid: '#F87171' },
  purple: { tint: 'rgba(192, 132, 252, 0.18)', solid: '#C084FC' },
};

export const ANNOTATION_COLOR_ORDER: AnnotationColor[] = [
  'yellow',
  'green',
  'blue',
  'red',
  'purple',
];

export function annotationColorStyle(color: string): { tint: string; solid: string } {
  return (
    ANNOTATION_COLOR_STYLES[color as AnnotationColor] ?? ANNOTATION_COLOR_STYLES.yellow
  );
}
