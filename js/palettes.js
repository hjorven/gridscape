// Original GitHub contribution graph colors. The skyline follows the site's light/dark mode,
// exactly like the heatmap on github.com.
export const PALETTES = {
  dark: {
    label: 'GitHub Dark',
    levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    bg: '#0d1117', base: '#21262d', text: '#e6edf3', muted: '#7d8590', accent: '#39d353',
  },
  light: {
    label: 'GitHub Light',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    bg: '#ffffff', base: '#f6f8fa', text: '#1f2328', muted: '#656d76', accent: '#216e39',
  },
};

export const DEFAULT_PALETTE = 'dark';
export const getPalette = (key) => PALETTES[key] || PALETTES[DEFAULT_PALETTE];
