import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fir: { DEFAULT: '#0369A1', deep: '#0C4A6E', soft: '#0EA5E9' },
        leaf: { DEFAULT: '#0EA5E9', soft: '#38BDF8' },
        mint: { DEFAULT: '#F0F9FF', deep: '#E0F2FE' },
        ink: '#0F172A',
        paper: '#F8FBFF',
        amber: { warn: '#F59E0B' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        lift: '0 8px 30px rgba(12,74,110,0.12)',
        card: '0 2px 12px rgba(12,74,110,0.08)',
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
