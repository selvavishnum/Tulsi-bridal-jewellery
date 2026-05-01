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
        /* === Primary brand: deep wine/burgundy === */
        wine: {
          50:  '#fdf2f7',
          100: '#fae6ef',
          200: '#f4c9dd',
          300: '#eba0c1',
          400: '#de6e9d',
          500: '#cc407a',
          600: '#a8235a',
          700: '#8b1a4a',
          800: '#741641',
          900: '#601238',
          950: '#3d0a23',
        },
        /* === Gold accent === */
        gold: {
          50:  '#fdf9ee',
          100: '#faf0d0',
          200: '#f4dfa0',
          300: '#ecc96b',
          400: '#e4b040',
          500: '#c9973a',
          600: '#b87d2a',
          700: '#9a6220',
          800: '#7d4d1c',
          900: '#683f1a',
        },
        /* === Warm ivory backgrounds === */
        ivory: {
          DEFAULT: '#FBF7F0',
          50:  '#FDFAF6',
          100: '#FBF7F0',
          200: '#F5EEE3',
          300: '#EDE3D3',
          400: '#E0D3BF',
        },
        /* === Velvet dark for footer/headers === */
        velvet: {
          50:  '#f9f0ed',
          100: '#f0d9d2',
          200: '#deb4a5',
          300: '#c48772',
          400: '#a85f4a',
          500: '#8b3e2a',
          600: '#6b2d1e',
          700: '#4a1e14',
          800: '#3d1a11',
          900: '#2d1209',
          950: '#1a0b05',
        },
        /* === Warm stone grays === */
        stone: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
        /* Legacy aliases for backward compat */
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
        cream: {
          DEFAULT: '#FFF8F0',
          100: '#fdf6ef',
          200: '#f8f0e4',
          300: '#f2e8d5',
        },
      },
      fontFamily: {
        serif:   ['"Cormorant Garamond"', 'Georgia', '"Times New Roman"', 'serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans:    ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        catalog:  '0.22em',
        wide2:    '0.35em',
        luxury:   '0.08em',
        widest2:  '0.18em',
      },
      boxShadow: {
        'luxury':    '0 4px 24px -4px rgba(139, 26, 74, 0.12)',
        'luxury-lg': '0 12px 48px -8px rgba(139, 26, 74, 0.18)',
        'card':      '0 2px 16px -2px rgba(0,0,0,0.07)',
        'card-hover':'0 8px 32px -4px rgba(0,0,0,0.13)',
        'gold':      '0 4px 20px -4px rgba(201, 151, 58, 0.30)',
      },
      backgroundImage: {
        'luxury-gradient': 'linear-gradient(135deg, #8b1a4a 0%, #601238 50%, #3d0a23 100%)',
        'gold-gradient':   'linear-gradient(135deg, #e4b040 0%, #c9973a 50%, #b87d2a 100%)',
        'ivory-gradient':  'linear-gradient(180deg, #FDFAF6 0%, #FBF7F0 100%)',
      },
      transitionTimingFunction: {
        'luxury': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
      animation: {
        'fade-in':    'fadeIn 0.6s ease forwards',
        'slide-up':   'slideUp 0.5s ease forwards',
        'shimmer':    'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
