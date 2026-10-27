/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#eef2fb',
          100: '#d9e1f5',
          200: '#b3c3ea',
          300: '#8299d4',
          700: '#1b2d6b',
          800: '#14234f',
          900: '#0e1a3d',
          950: '#08112a',
        },
        royal: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#bcd0ff',
          500: '#2f5fe0',
          600: '#2450c8',
          700: '#1d40a6',
        },
        gold: {
          100: '#f7eed6',
          300: '#e9cf8a',
          400: '#d9b55a',
          500: '#c49a3a',
          600: '#a37d27',
        },
      },
      fontFamily: {
        sans: ['Inter', '"Hind Siliguri"', 'system-ui', 'sans-serif'],
        display: ['Poppins', '"Hind Siliguri"', 'Inter', 'sans-serif'],
        bengali: ['"Hind Siliguri"', '"Noto Sans Bengali"', 'Inter', 'sans-serif'],
      },
      maxWidth: { content: '76rem' },
    },
  },
  plugins: [],
};
