/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        darkbg: '#0b1322',
        darkcard: '#131e33',
        darkcardhover: '#1b2a47',
        fintech: {
          teal: '#2dd4bf',
          tealhover: '#14b8a6',
          orange: '#fb923c',
          green: '#10b981',
          red: '#f43f5e',
          accent: '#38bdf8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
