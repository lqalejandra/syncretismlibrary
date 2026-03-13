/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#f7f5f0',
        'bg-card': '#ffffff',
        text: '#1a1a1a',
        muted: '#6b6b6b',
        accent: '#1a1a1a',
        border: '#e5e0d8',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
