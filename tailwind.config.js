/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Noto Sans TC"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Noto Sans TC"', 'monospace'],
      },
    },
  },
  plugins: [],
};
