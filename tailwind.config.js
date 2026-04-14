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
        /* Velvet dark-brown — the backdrop/display stand color in catalog photos */
        velvet: {
          50:  '#f9f0ed',
          100: '#f0d9d2',
          200: '#deb4a5',
          300: '#c48772',
          400: '#a85f4a',
          500: '#8b3e2a',
          600: '#6b2d1e',
          700: '#4a1e14',   /* main velvet */
          800: '#3d1a11',   /* dark velvet bg */
          900: '#2d1209',
          950: '#1a0b05',
        },
        /* Wine / burgundy — product name text color */
        wine:  '#7a1f3a',
        /* Catalog cream backgrounds */
        cream: {
          DEFAULT: '#FFF8F0',
          100: '#fdf6ef',
          200: '#f8f0e4',
          300: '#f2e8d5',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      },
      letterSpacing: {
        catalog: '0.22em',
        wide2:   '0.35em',
      },
    },
  },
  plugins: [],
};
