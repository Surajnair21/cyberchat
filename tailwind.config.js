/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        terminal: '0 0 0 1px rgba(34, 211, 238, 0.18), 0 24px 80px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [],
};
