import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Colours are the wireframe's tokens (src/index.css), so light and dark switch by class.
const v = (name: string) => `var(--${name})`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: v('page'),
        surface: v('surface'),
        nav: { DEFAULT: v('nav'), on: v('nav-on'), 'on-fg': v('nav-on-fg') },
        primary: { DEFAULT: v('primary'), foreground: '#FFFFFF' },
        ink: { DEFAULT: v('ink'), strong: v('ink-strong'), 2: v('ink2'), 3: v('ink3') },
        muted: v('muted'),
        disabled: v('disabled'),
        line: { DEFAULT: v('line'), 2: v('line2') },
        ctl: v('ctl'),
        chip: v('chip'),
        selected: v('selected'),
        danger: v('danger'),
        ok: { bg: v('ok-bg'), fg: v('ok-fg') },
        warn: { bg: v('warn-bg'), fg: v('warn-fg') },
        bad: { bg: v('bad-bg'), fg: v('bad-fg') },
        plan: { bg: v('plan-bg'), fg: v('plan-fg') },
        chart: { 1: v('chart1'), 2: v('chart2'), 3: v('chart3') },
        brand: { navy: '#0B2350', green: '#00C700' }
      },
      borderColor: { DEFAULT: v('line') },
      borderRadius: { ctl: '10px', card: '14px' },
      fontFamily: {
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: { pop: '0 12px 32px rgba(11, 35, 80, 0.18)' }
    }
  },
  plugins: [animate]
} satisfies Config;
