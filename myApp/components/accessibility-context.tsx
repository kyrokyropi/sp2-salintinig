/**
 * Accessibility Context
 *
 * Global settings for users who need enhanced readability or interaction:
 * - Text scaling (1x, 1.25x, 1.5x)
 * - High contrast mode
 * - Reduced motion
 *
 * Settings persist in AsyncStorage (if available) or in-memory.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { Colors, FontSizes, type Palette } from '@/constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TextScale = 1 | 1.25 | 1.5;

interface AccessibilityState {
  highContrast: boolean;
  textScale: TextScale;
  reducedMotion: boolean;
}

interface AccessibilityContextValue extends AccessibilityState {
  /** Current resolved color theme (respects high-contrast override) */
  colors: typeof Colors.light;
  isDark: boolean;
  /** Scale a font size by user preference */
  scaledFont: (size: number) => number;
  /** Scale spacing proportionally */
  scaledSpacing: (size: number) => number;
  // Setters
  setHighContrast: (v: boolean) => void;
  setTextScale: (v: TextScale) => void;
  setReducedMotion: (v: boolean) => void;
  toggleHighContrast: () => void;
  cycleTextScale: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';

  const [highContrast, setHighContrast] = useState(false);
  const [textScale, setTextScale] = useState<TextScale>(1);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect system reduced-motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (enabled) setReducedMotion(true);
    });
  }, []);

  // Resolve colors with high-contrast overrides
  const colors = useMemo(() => {
    const base = isDark ? Colors.dark : Colors.light;
    if (!highContrast) return base;
    const hc = isDark ? Colors.highContrast.dark : Colors.highContrast.light;
    return { ...base, ...hc };
  }, [isDark, highContrast]);

  const scaledFont = useCallback(
    (size: number) => Math.round(size * textScale),
    [textScale],
  );

  const scaledSpacing = useCallback(
    (size: number) => Math.round(size * Math.min(textScale, 1.25)),
    [textScale],
  );

  const toggleHighContrast = useCallback(() => {
    setHighContrast((v) => !v);
  }, []);

  const cycleTextScale = useCallback(() => {
    setTextScale((v) => {
      if (v === 1) return 1.25;
      if (v === 1.25) return 1.5;
      return 1;
    });
  }, []);

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      highContrast,
      textScale,
      reducedMotion,
      colors,
      isDark,
      scaledFont,
      scaledSpacing,
      setHighContrast,
      setTextScale,
      setReducedMotion,
      toggleHighContrast,
      cycleTextScale,
    }),
    [highContrast, textScale, reducedMotion, colors, isDark, scaledFont, scaledSpacing, toggleHighContrast, cycleTextScale],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}
