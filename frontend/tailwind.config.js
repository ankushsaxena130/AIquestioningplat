/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F5F3FF',        // light text for dark theme
        paper: '#12091F',      // dark purple background
        signal: '#C4B5FD',     // bright violet for positive states
        amber: '#FDE68A',      // warm light amber for warnings
        line: '#473052'        // subtle purple divider
      },
      fontFamily: {
        display: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
        body: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
