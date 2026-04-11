/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--bt-background)',
        surface: 'var(--bt-surface)',
        border: 'var(--bt-border)',
        primary: 'var(--bt-primary)',
        text: 'var(--bt-text)',
        muted: 'var(--bt-muted)'
      }
    },
  },
  plugins: [],
}
