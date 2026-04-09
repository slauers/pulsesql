/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#050913',
        surface: '#0B1220',
        border: '#1A2840',
        primary: '#22C7FF',
        text: '#ECF7FF',
        muted: '#8093B1'
      }
    },
  },
  plugins: [],
}
