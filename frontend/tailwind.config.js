/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'fade-in':       'fadeIn 0.4s ease-out both',
        'slide-up':      'slideUp 0.4s ease-out both',
        'slide-in-left': 'slideInLeft 0.35s ease-out both',
        'slide-in-right':'slideInRight 0.35s ease-out both',
        'bounce-in':     'bounceIn 0.5s cubic-bezier(0.68,-0.55,0.265,1.55) both',
        'shimmer':       'shimmer 1.8s infinite linear',
        'float':         'float 3s ease-in-out infinite',
        'pulse-soft':    'pulseSoft 2s ease-in-out infinite',
        'spin-slow':     'spin 3s linear infinite',
        'wiggle':        'wiggle 0.7s ease-in-out 1',
        'pulse-ring':    'pulseSoft 1.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%':   { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%':   { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        bounceIn: {
          '0%':   { opacity: '0', transform: 'scale(0.4)' },
          '60%':  { opacity: '1', transform: 'scale(1.08)' },
          '80%':  { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-7px)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.6' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(0deg)' },
          '15%':     { transform: 'rotate(-4deg)' },
          '30%':     { transform: 'rotate(4deg)' },
          '45%':     { transform: 'rotate(-3deg)' },
          '60%':     { transform: 'rotate(3deg)' },
          '75%':     { transform: 'rotate(-1deg)' },
        },
      },
    },
  },
  plugins: [],
}
