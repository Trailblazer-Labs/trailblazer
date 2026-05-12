/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f0f0f',
        panel: '#161616',
        border: '#262626',
        muted: '#8a8a8a',
        text: '#e8e8e8',
        accent: '#d97757'
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'sans-serif']
      }
    }
  },
  plugins: []
}
