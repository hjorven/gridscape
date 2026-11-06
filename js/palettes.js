// Original GitHub contribution graph colors. The skyline follows the site's light/dark mode,
// exactly like the heatmap on github.com. The plinth is always dark, like GitHub Skyline.
export const PALETTES = {
  dark: {
    label: 'GitHub Dark',
    levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    bg: '#0d1117', base: '#21262d', text: '#e6edf3', muted: '#7d8590', accent: '#39d353',
    plinth: '#21262d', textColor: '#8b949e',
  },
  light: {
    label: 'GitHub Light',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    bg: '#ffffff', base: '#f6f8fa', text: '#1f2328', muted: '#656d76', accent: '#216e39',
    plinth: '#24292f', textColor: '#afb8c1',
  },
};

// Second profile in compare mode: GitHub's blue scale.
export const COMPARE_PALETTES = {
  dark: { ...PALETTES.dark, levels: ['#161b22', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff'], accent: '#58a6ff' },
  light: { ...PALETTES.light, levels: ['#ebedf0', '#b6e3ff', '#54aeff', '#0969da', '#0a3069'], accent: '#0969da' },
};

export const DEFAULT_PALETTE = 'dark';
export const getPalette = (key) => PALETTES[key] || PALETTES[DEFAULT_PALETTE];
export const getComparePalette = (key) => COMPARE_PALETTES[key] || COMPARE_PALETTES[DEFAULT_PALETTE];
