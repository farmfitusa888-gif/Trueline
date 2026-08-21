/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Scanned is amber because it is a warning, not a state. Verified is not
        // green — green reads as "done" and a verified wall is just a wall that
        // is right. Ink on paper is what a drawing looks like.
        scanned: '#b45309',
        verified: '#0f172a',
        derived: '#64748b',
      },
    },
  },
};
