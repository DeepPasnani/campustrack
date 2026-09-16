/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        deck:  '#F3EFE2',
        panel: '#FBF9F2',
        rim:   '#DFD4B8',
        ink:   { DEFAULT: '#2A2419', mute: '#6E6444' },
        annotation: '#6E6444',
        accent:     { DEFAULT: '#2F5D56', light: '#4C8078', dark: '#1E4038' },
        verify:     { DEFAULT: '#4B7B3F', light: '#6E9B60', dark: '#365C2C' },
        alert:      { DEFAULT: '#AE4331', light: '#C96952', dark: '#8A3324' },
        clarify:    { DEFAULT: '#565C86', light: '#7A80A8', dark: '#3F4566' },
        trophy:     {
          gold:    { DEFAULT: '#A07E2B', light: '#C49E44', dark: '#6E541C' },
          silver:  { DEFAULT: '#8A938B', light: '#AFB7B0', dark: '#555C56' },
          bronze:  { DEFAULT: '#A56E45', light: '#C68A5E', dark: '#6E4826' },
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs:   ['0.75rem',   { lineHeight: '1.125rem' }],
        sm:   ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem',  { lineHeight: '1.375rem' }],
        lg:   ['1rem',      { lineHeight: '1.5rem' }],
        xl:   ['1.25rem',   { lineHeight: '1.75rem' }],
        '2xl':['1.5rem',    { lineHeight: '2rem' }],
        '3xl':['2rem',      { lineHeight: '2.5rem' }],
      },
      spacing: {
        '0.5': '0.125rem', '1': '0.25rem', '1.5': '0.375rem',
        '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem',
        '3.5': '0.875rem', '4': '1rem', '5': '1.25rem',
        '6': '1.5rem', '7': '1.75rem', '8': '2rem',
        '10': '2.5rem', '12': '3rem',
      },
      boxShadow: {
        'surface': '0 1px 3px rgba(42,36,25,0.08)',
        'raised':  '0 4px 12px rgba(42,36,25,0.08)',
        'modal':   '0 8px 30px rgba(42,36,25,0.16)',
        'tooltip': '0 12px 36px rgba(42,36,25,0.22)',
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'timer-urgent': 'timerUrgent 1s ease-in-out infinite',
        'fade-up':      'fadeUp 0.25s ease-out both',
        'fade-in':      'fadeIn 0.2s ease-out both',
        'slide-in':     'slideIn 0.2s ease-out both',
      },
      keyframes: {
        timerUrgent: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%':   { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
