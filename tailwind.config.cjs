/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './workbench.html',
    './src/workbench/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        wb: {
          start: '#22c55e',
          summarize: '#3b82f6',
          process: '#a855f7',
          end: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
