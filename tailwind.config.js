/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B2220',
        paper: '#F4F1E9',
        'paper-dim': '#ECE7D9',
        surface2: '#ECE7D9',
        petrol: {
          DEFAULT: '#2C5A52',
          dark: '#1F433D',
          light: '#3E7A6F',
        },
        brass: {
          DEFAULT: '#C08A34',
          dark: '#75521C',
          light: '#D9AC63',
        },
        stone: '#DBD3C2',
        'stone-dark': '#C7BCA3',
        slate: '#5B615C',
        status: {
          lead: '#4E6D93',
          onboarding: '#B8842F',
          active: '#3F7A54',
          paused: '#6E736C',
          churned: '#9A4128',
        },
      },
      fontFamily: {
        display: ['"Zilla Slab"', 'Georgia', 'serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      maxWidth: {
        content: '1180px',
      },
      letterSpacing: {
        tightish: '-0.01em',
        wideish: '0.06em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 34, 32, 0.06), 0 8px 24px -12px rgba(27, 34, 32, 0.18)',
      },
    },
  },
  plugins: [],
}
