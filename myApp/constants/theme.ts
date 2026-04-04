/**
 * SalinTinig Design System
 *
 * Blue + off-white palette designed for accessibility.
 * Primary users: children, elderly, visually impaired.
 *
 * WCAG AA contrast ratios:
 *   - Primary text on background  ≥ 7:1
 *   - Large text on background    ≥ 4.5:1
 *   - Interactive elements         ≥ 3:1
 */

import { Platform } from 'react-native';

// ── Core palette ──────────────────────────────────────────────────────────────

export const Palette = {
  // Primary blue scale
  honey:       '#1F6FEB',  // Primary accent – vivid blue
  honeyLight:  '#EAF2FF',  // Tinted backgrounds
  honeyMuted:  '#CFE0FF',  // Card highlights, badges
  honeyDark:   '#174EA6',  // Pressed states, high-contrast accent

  // Off-whites & neutrals
  cream:       '#F9FAF7',  // Main background (off-white)
  parchment:   '#F4F6F8',  // Card background
  sand:        '#DEE4EA',  // Dividers, subtle fills
  warmGray:    '#5F6B7A',  // Secondary text
  charcoal:    '#182230',  // Primary text

  // Dark mode
  night:       '#1A1814',  // Dark background
  nightCard:   '#2A2620',  // Dark card surface
  nightBorder: '#3D382F',  // Dark borders

  // Semantic
  success:     '#4CAF50',  // Green – good confidence
  warning:     '#FF9800',  // Orange – medium confidence
  error:       '#E53935',  // Red – low confidence / errors
  info:        '#3A86FF',  // Blue – informational

  white:       '#FFFFFF',
  black:       '#000000',
  overlay:     'rgba(0,0,0,0.5)',
  overlayLight:'rgba(0,0,0,0.25)',
};

// ── Light & dark themes ───────────────────────────────────────────────────────

export const Colors = {
  light: {
    text:             Palette.charcoal,
    textSecondary:    Palette.warmGray,
    background:       Palette.cream,
    surface:          Palette.parchment,
    card:             Palette.white,
    border:           Palette.sand,
    accent:           Palette.honey,
    accentLight:      Palette.honeyLight,
    accentMuted:      Palette.honeyMuted,
    accentDark:       Palette.honeyDark,
    tint:             Palette.honey,
    icon:             Palette.warmGray,
    tabIconDefault:   Palette.warmGray,
    tabIconSelected:  Palette.honey,
    // Semantic
    success:          Palette.success,
    warning:          Palette.warning,
    error:            Palette.error,
    info:             Palette.info,
    // Buttons
    primaryBtn:       Palette.honey,
    primaryBtnText:   Palette.white,
    ghostBtnBorder:   Palette.sand,
    ghostBtnText:     Palette.charcoal,
  },
  dark: {
    text:             '#F5F0E6',
    textSecondary:    '#A89E8C',
    background:       Palette.night,
    surface:          Palette.nightCard,
    card:             Palette.nightCard,
    border:           Palette.nightBorder,
    accent:           Palette.honey,
    accentLight:      'rgba(31,111,235,0.18)',
    accentMuted:      'rgba(31,111,235,0.26)',
    accentDark:       '#4E8EF0',
    tint:             Palette.honey,
    icon:             '#A89E8C',
    tabIconDefault:   '#6B6357',
    tabIconSelected:  Palette.honey,
    // Semantic
    success:          '#66BB6A',
    warning:          '#FFB74D',
    error:            '#EF5350',
    info:             '#7CB8F2',
    // Buttons
    primaryBtn:       Palette.honey,
    primaryBtnText:   Palette.white,
    ghostBtnBorder:   Palette.nightBorder,
    ghostBtnText:     '#F5F0E6',
  },

  // High-contrast overrides (layered on top of light/dark)
  highContrast: {
    light: {
      text:           '#000000',
      textSecondary:  '#3D3D3D',
      background:     '#FFFFFF',
      card:           '#FFFFFF',
      border:         '#000000',
      accent:         '#174EA6',
      accentDark:     '#103B80',
      primaryBtn:     '#174EA6',
      ghostBtnBorder: '#000000',
      ghostBtnText:   '#000000',
    },
    dark: {
      text:           '#FFFFFF',
      textSecondary:  '#E0E0E0',
      background:     '#000000',
      card:           '#1A1A1A',
      border:         '#FFFFFF',
      accent:         '#63A4FF',
      accentDark:     '#9BC7FF',
      primaryBtn:     '#63A4FF',
      ghostBtnBorder: '#FFFFFF',
      ghostBtnText:   '#FFFFFF',
    },
  },
};

// ── Typography scale ──────────────────────────────────────────────────────────
// Base sizes designed for readability; multiplied by user text scale factor

export const FontSizes = {
  xs:    12,
  sm:    14,
  base:  16,
  md:    18,
  lg:    22,
  xl:    28,
  xxl:   34,
  hero:  42,
};

export const LineHeights = {
  tight:  1.2,
  normal: 1.5,
  relaxed:1.75,
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

// ── Spacing & radius ──────────────────────────────────────────────────────────

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl:48,
};

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  full: 9999,
};
