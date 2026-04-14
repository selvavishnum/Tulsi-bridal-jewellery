/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          50:  '#fdf8ee',
          100: '#faefd0',
          200: '#f5dfa0',
          300: '#efc86a',
          400: '#e8b040',
          500: '#d4922a',
          600: '#b87333',
          700: '#9a5c28',
          800: '#7d4a26',
          900: '#673d23',
        },
        maroon: {
          50:  '#fdf2f2',
          100: '#fce4e4',
          200: '#f9cdcd',
          300: '#f4a8a8',
          400: '#ec7070',
          500: '#df4040',
          600: '#c62222',
          700: '#a61818',
          800: '#8b1818',
          900: '#741919',
          950: '#800020',
        },
        cream: '#FFF8F0',
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      },
    },
  },
  plugins: [],
};
