/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--bt-background-rgb) / <alpha-value>)',
        surface: 'rgb(var(--bt-surface-rgb) / <alpha-value>)',
        border: 'rgb(var(--bt-border-rgb) / <alpha-value>)',
        primary: 'rgb(var(--bt-primary-rgb) / <alpha-value>)',
        text: 'rgb(var(--bt-text-rgb) / <alpha-value>)',
        muted: 'rgb(var(--bt-muted-rgb) / <alpha-value>)'
      }
    },
  },
  plugins: [],
}
