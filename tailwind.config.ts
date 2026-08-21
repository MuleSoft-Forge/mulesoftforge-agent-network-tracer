import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Anypoint colors
        primary: {
          DEFAULT: '#5e66f9', // indigo-50
          foreground: '#ffffff',
        },
        'core-blue': {
          3: '#0176d3',
        },
        teal: '#00b5d1',
        navy: '#178bea',
        violet: '#9a63f9',
        background: '#ffffff',
        foreground: '#2e2e2e',
        composer: {
          surface: 'var(--composer-surface)',
          'surface-muted': 'var(--composer-surface-muted)',
          border: 'var(--composer-border)',
          label: 'var(--composer-label)',
          'label-muted': 'var(--composer-label-muted)',
        },
      },
      borderRadius: {
        'anypoint': '8px',
        'anypoint-button': '36px',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Ubuntu',
          'Cantarell',
          'Noto Sans',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
