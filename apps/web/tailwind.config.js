/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2F6F73', light: '#E3F0EF', dark: '#24585B' },
        accent: { DEFAULT: '#D9A86C', light: '#F6EADB' },
        bg: '#FAF7F2',
        surface: '#FFFFFF',
        ink: { DEFAULT: '#2B2B2B', muted: '#6B6B6B' },
        line: '#E6E1D8',
        severity: { high: '#B4483C', medium: '#C98A2E', low: '#5A7FA6' },
        sev: { highbg: '#F7E4E1', mediumbg: '#F8EDDB', lowbg: '#E4ECF5' },
        // Darker text shades of the severity colors so labels on tinted backgrounds meet WCAG AA.
        sevtext: { high: '#8C2F25', medium: '#7A4F12', low: '#34567D' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        // Patient/caregiver views use the 18px base via `.text-patient` on the layout root.
        base: ['1rem', { lineHeight: '1.5' }],
      },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: {
        card: '0 1px 2px rgba(43, 43, 43, 0.04), 0 2px 8px -2px rgba(43, 43, 43, 0.06)',
        pop: '0 12px 32px -8px rgba(43, 43, 43, 0.18), 0 2px 6px rgba(43, 43, 43, 0.06)',
      },
    },
  },
  plugins: [],
};
