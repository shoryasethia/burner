import { DEFAULT_CATEGORIES, UNTAGGED } from './config.js';

const CAT_IDS = [...DEFAULT_CATEGORIES.map((c) => c.id), UNTAGGED.id];
export const PAPER_CATEGORY_COLORS = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.color.toLowerCase()]));
const PAPER_DEFAULT = PAPER_CATEGORY_COLORS;

// Per-theme category hues tuned for contrast on each background.
const PALETTES = {
  paper: {
    coding: '#2563eb',
    debugging: '#dc2626',
    planning: '#059669',
    research: '#475569',
    writing: '#b45309',
    analysis: '#0d9488',
    review: '#c2410c',
    learning: '#64748b',
    other: '#94a3b8',
    untagged: '#a8a29e',
  },
  dark: {
    coding: '#60a5fa',
    debugging: '#f87171',
    planning: '#4ade80',
    research: '#94a3b8',
    writing: '#fbbf24',
    analysis: '#2dd4bf',
    review: '#fb923c',
    learning: '#cbd5e1',
    other: '#9ca3af',
    untagged: '#6b7280',
  },
  thermal: {
    coding: '#1d4ed8',
    debugging: '#b91c1c',
    planning: '#047857',
    research: '#57534e',
    writing: '#a16207',
    analysis: '#0f766e',
    review: '#c2410c',
    learning: '#78716c',
    other: '#a8a29e',
    untagged: '#a8a29e',
  },
  matrix: {
    coding: '#22d3ee',
    debugging: '#fb7185',
    planning: '#4ade80',
    research: '#86efac',
    writing: '#fde047',
    analysis: '#2dd4bf',
    review: '#f97316',
    learning: '#a3e635',
    other: '#6ee7b7',
    untagged: '#3f6212',
  },
};

const SHARED = `
  --accent-fg: var(--page-bg);
  --warn: #dc2626;
  --shadow: rgba(0,0,0,.12);
  --shadow-lg: rgba(0,0,0,.22);
`;

function catVars(theme) {
  const p = PALETTES[theme];
  return CAT_IDS.map((id) => `--cat-${id}:${p[id]}`).join(';');
}

// Injected into report, receipt, and settings <style> blocks.
export function themeCss() {
  return `
:root[data-theme="paper"]{
  --bg:#f4f1e8;--ink:#2b2b26;--dim:#8a8478;--rule:#b8b2a2;--page-bg:#e7e2d3;
  --accent:#2b2b26;--chart-bar:#b45309;--chart-bar-alt:#2563eb;
  ${SHARED}${catVars('paper')}
}
:root[data-theme="dark"]{
  --bg:#1c1f26;--ink:#e8eaed;--dim:#8b919c;--rule:#3d4450;--page-bg:#0f1115;
  --accent:#e8eaed;--chart-bar:#fb923c;--chart-bar-alt:#60a5fa;
  --warn:#f87171;--shadow:rgba(0,0,0,.45);--shadow-lg:rgba(0,0,0,.65);
  ${catVars('dark')}
}
:root[data-theme="thermal"]{
  --bg:#fdf6e3;--ink:#3d3424;--dim:#9a8b6e;--rule:#d4c4a0;--page-bg:#efe6c8;
  --accent:#7c4a03;--chart-bar:#c2410c;--chart-bar-alt:#1d4ed8;
  ${SHARED}${catVars('thermal')}
}
:root[data-theme="matrix"]{
  --bg:#061408;--ink:#5efc8e;--dim:#2d6b3f;--rule:#1a4d2a;--page-bg:#020a04;
  --accent:#7dffab;--chart-bar:#4ade80;--chart-bar-alt:#22d3ee;
  --warn:#fb7185;--shadow:rgba(0,40,0,.5);--shadow-lg:rgba(0,60,0,.7);
  ${catVars('matrix')}
}`;
}

// User-edited category colors in config override the theme palette.
export function categoryOverrideCss(categories) {
  const lines = [];
  for (const c of categories) {
    const paper = PAPER_DEFAULT[c.id];
    if (!paper || String(c.color).toLowerCase() === paper) continue;
    lines.push(`--cat-${c.id}:${c.color}`);
  }
  if (!lines.length) return '';
  return `:root{${lines.join(';')}}`;
}

export function resolveCategoryColor(theme, categoryId, storedColor) {
  const paper = PAPER_DEFAULT[categoryId];
  const stored = String(storedColor ?? '').toLowerCase();
  if (paper && stored && stored !== paper) return storedColor;
  return PALETTES[theme]?.[categoryId] ?? storedColor ?? '#888';
}

export function categoryColorsForTheme(theme, categories) {
  const map = {};
  for (const c of categories) map[c.id] = resolveCategoryColor(theme, c.id, c.color);
  map[UNTAGGED.id] = resolveCategoryColor(theme, UNTAGGED.id, UNTAGGED.color);
  return map;
}
