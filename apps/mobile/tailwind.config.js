/* eslint-disable */
// Token values duplicated from src/lib/design-tokens.ts (source of truth).
// Keep both in sync when adding tokens.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: '#FBF8F3',
          card: '#FFFFFF',
          border: '#E4E4E7',
        },
        brand: {
          primary: '#1A56DB',
          'primary-soft': '#DBEAFE',
        },
        accent: {
          teal: '#0D9488',
          amber: '#D97706',
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
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      borderRadius: {
        sm: '8px',
        md: '10px',
        lg: '12px',
        full: '999px',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        medium: ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold: ['Inter_700Bold'],
      },
      fontSize: {
        eyebrow: ['11px', { lineHeight: '15.4px', letterSpacing: '0.5px' }],
        meta: ['13px', { lineHeight: '18.85px' }],
        body: ['15px', { lineHeight: '23.25px' }],
        'body-strong': ['16px', { lineHeight: '24px' }],
        subhead: ['18px', { lineHeight: '23.4px' }],
        heading: ['22px', { lineHeight: '27.5px' }],
        display: ['28px', { lineHeight: '33.6px' }],
      },
    },
  },
  plugins: [],
};
