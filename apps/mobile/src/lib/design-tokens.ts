// Design tokens — single source of truth for the mobile app's two-theme system.
// Mirrors the Claude Design handoff bundle (.design-bundle/project/screens.jsx).
// tailwind.config.js mirrors a subset of these for static utility classes.

export type ThemeKey = 'A' | 'B';

export interface Theme {
  key: ThemeKey;
  name: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  line: string;
  serif: string;
  sans: string;
  pillBg: string;
  pillInk: string;
  radius: number;
  chipBg: string;
}

export const THEMES: Record<ThemeKey, Theme> = {
  A: {
    key: 'A',
    name: 'Warm Editorial',
    bg: '#F6F1E8',
    surface: '#FFFFFF',
    surfaceMuted: '#EFE7D7',
    ink: '#1C1A14',
    inkSoft: '#5C5448',
    inkFaint: '#9A8F7C',
    accent: '#D87B2A',
    accentInk: '#FFFFFF',
    accentSoft: '#FBE7CF',
    line: 'rgba(28,26,20,0.10)',
    serif: 'Fraunces_500Medium',
    sans: 'Inter_400Regular',
    pillBg: '#1C1A14',
    pillInk: '#F6F1E8',
    radius: 22,
    chipBg: '#EFE7D7',
  },
  B: {
    key: 'B',
    name: 'Confident Modern',
    bg: '#F4F4F2',
    surface: '#FFFFFF',
    surfaceMuted: '#E9E9E4',
    ink: '#0E1116',
    inkSoft: '#4B5260',
    inkFaint: '#8C93A1',
    accent: '#C5F03A',
    accentInk: '#0E1116',
    accentSoft: '#EAF8C7',
    line: 'rgba(14,17,22,0.10)',
    serif: 'InstrumentSerif_400Regular',
    sans: 'Inter_400Regular', // Geist not on @expo-google-fonts; fall back to Inter
    pillBg: '#0E1116',
    pillInk: '#F4F4F2',
    radius: 18,
    chipBg: '#E9E9E4',
  },
};

export const DEFAULT_THEME: ThemeKey = 'A';

// Per-theme font weight map. Used when a primitive needs a specific weight that
// the theme's "sans" or "serif" entry doesn't cover. Theme-aware so we can swap
// font families when themes change.
export const fontWeights = {
  A: {
    sansRegular: 'Inter_400Regular',
    sansMedium: 'Inter_500Medium',
    sansSemibold: 'Inter_600SemiBold',
    sansBold: 'Inter_700Bold',
    serifRegular: 'Fraunces_400Regular',
    serifMedium: 'Fraunces_500Medium',
    serifSemibold: 'Fraunces_600SemiBold',
    serifItalic: 'Fraunces_500Medium', // Fraunces variable handles italic via fontStyle
  },
  B: {
    sansRegular: 'Inter_400Regular',
    sansMedium: 'Inter_500Medium',
    sansSemibold: 'Inter_600SemiBold',
    sansBold: 'Inter_700Bold',
    serifRegular: 'InstrumentSerif_400Regular',
    serifMedium: 'InstrumentSerif_400Regular',
    serifSemibold: 'InstrumentSerif_400Regular',
    serifItalic: 'InstrumentSerif_400Regular_Italic',
  },
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radii = {
  none: 0,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  full: 999,
} as const;

// Type scale — used as numeric base for inline styles. Headline sizes vary
// per-theme via the screens themselves; these are the common building blocks.
export const typeScale = {
  micro: { fontSize: 10, lineHeight: 14, letterSpacing: 0.4 },
  eyebrow: { fontSize: 11, lineHeight: 15.4, letterSpacing: 0.6 },
  meta: { fontSize: 12, lineHeight: 17, letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 19, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 23.25, letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  bodyRead: { fontSize: 17, lineHeight: 26.35, letterSpacing: 0 },
  subhead: { fontSize: 19, lineHeight: 22, letterSpacing: -0.3 },
  heading: { fontSize: 22, lineHeight: 24.2, letterSpacing: -0.4 },
  display: { fontSize: 28, lineHeight: 30.8, letterSpacing: -0.6 },
  hero: { fontSize: 32, lineHeight: 33.3, letterSpacing: -0.9 },
  heroXl: { fontSize: 40, lineHeight: 40.8, letterSpacing: -1.4 },
} as const;

// Photo placeholder palette — gradient tones used by the Photo primitive.
export const photoTones = {
  warm: ['#C77B3D', '#7A4423'],
  cool: ['#4A5D7E', '#1F2A44'],
  sage: ['#7A8B6F', '#3F4F36'],
  plum: ['#8B5E83', '#3F2A45'],
  sand: ['#D4B896', '#7E6448'],
  ink: ['#3A3A40', '#0E1116'],
  lime: ['#A8C44C', '#4F6018'],
} as const;

export type PhotoTone = keyof typeof photoTones;

// ─────────────────────────────────────────────────────────────────
// Backward-compat exports — older code may still import these names.
// Mapped to Warm Editorial (theme A) so unmigrated screens look reasonable.
// ─────────────────────────────────────────────────────────────────
export const colors = {
  surface: {
    canvas: THEMES.A.bg,
    card: THEMES.A.surface,
    border: 'rgba(28,26,20,0.10)',
  },
  brand: {
    primary: THEMES.A.accent,
    'primary-soft': THEMES.A.accentSoft,
  },
  accent: {
    teal: '#0D9488',
    amber: THEMES.A.accent,
    rose: '#E11D48',
  },
  zinc: {
    50: '#FAFAFA',
    100: '#F4F4F5',
    200: '#E4E4E7',
    300: '#D4D4D8',
    400: '#A1A1AA',
    500: '#71717A',
    600: '#52525B',
    700: '#3F3F46',
    800: '#27272A',
    900: '#18181B',
  },
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700', lineHeight: 28 * 1.2 },
  heading: { fontSize: 22, fontWeight: '600', lineHeight: 22 * 1.25 },
  subhead: { fontSize: 18, fontWeight: '600', lineHeight: 18 * 1.3 },
  'body-strong': { fontSize: 16, fontWeight: '500', lineHeight: 16 * 1.5 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 15 * 1.55 },
  meta: { fontSize: 13, fontWeight: '400', lineHeight: 13 * 1.45 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 11 * 1.4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
} as const;

export const fontFamily = {
  sans: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const tailwindTheme = {
  colors: {
    transparent: 'transparent',
    white: '#FFFFFF',
    black: '#000000',
    surface: colors.surface,
    brand: colors.brand,
    accent: colors.accent,
    zinc: colors.zinc,
  },
  spacing: {
    px: 1,
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    12: 48,
  },
  borderRadius: {
    none: 0,
    sm: 8,
    md: 10,
    lg: 12,
    xl: 18,
    '2xl': 22,
    full: 999,
  },
  fontFamily: {
    sans: ['Inter_400Regular'],
    medium: ['Inter_500Medium'],
    semibold: ['Inter_600SemiBold'],
    bold: ['Inter_700Bold'],
  },
  fontSize: {
    eyebrow: [11, { lineHeight: 15.4, letterSpacing: 0.5 }],
    meta: [13, { lineHeight: 18.85 }],
    body: [15, { lineHeight: 23.25 }],
    'body-strong': [16, { lineHeight: 24 }],
    subhead: [18, { lineHeight: 23.4 }],
    heading: [22, { lineHeight: 27.5 }],
    display: [28, { lineHeight: 33.6 }],
  },
} as const;
