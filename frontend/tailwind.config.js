/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#141B2E',        // deep graphite-navy — base text / surfaces
        paper: '#F6F5F1',      // warm off-white background
        signal: '#2F6F5E',     // muted deep teal — confirmed / confident state
        amber: '#C98A3A',      // warm amber — uncertain / thinking state
        line: '#DEDAD0'        // hairline dividers
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
