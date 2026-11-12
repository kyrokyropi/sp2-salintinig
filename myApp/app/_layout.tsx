import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AccessibilityProvider } from '@/components/accessibility-context';
import { Palette } from '@/constants/theme';
import { initDb } from '@/components/db-service';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Warm-tinted navigation themes
const WarmLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Palette.honey,
    background: Palette.cream,
    card: Palette.white,
    text: Palette.charcoal,
    border: Palette.sand,
  },
};

const WarmDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Palette.honey,
    background: Palette.night,
    card: Palette.nightCard,
    text: '#F5F0E6',
    border: Palette.nightBorder,
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    initDb().then(
      () => { if (active) setReady(true); },
      (error: unknown) => { if (active) setError(String(error)); },
    );
    return () => { active = false; };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {error ? <Text accessibilityRole="alert">Could not open the database: {error}</Text> : <ActivityIndicator accessibilityLabel="Opening database" />}
      </View>
    );
  }

  return (
    <AccessibilityProvider>
      <ThemeProvider value={colorScheme === 'dark' ? WarmDarkTheme : WarmLightTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Dialogo' }} />
          <Stack.Screen
            name="playback"
            options={{ headerShown: false, presentation: 'card', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="album/[id]"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AccessibilityProvider>
  );
}
