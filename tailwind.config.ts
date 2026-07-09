import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fir: { DEFAULT: '#0B3D2E', deep: '#062A1F', soft: '#155E48' },
        leaf: { DEFAULT: '#10B981', soft: '#34D399' },
        mint: { DEFAULT: '#ECFDF5', deep: '#D1FAE5' },
        ink: '#0F172A',
        paper: '#FAFDFB',
        amber: { warn: '#F59E0B' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        lift: '0 8px 30px rgba(6,42,31,0.12)',
        card: '0 2px 12px rgba(6,42,31,0.08)',
      },
      keyframes: {
        pulseCross: { '0%,100%': { opacity: '0.5' }, '50%': { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: { rise: 'rise .35s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
