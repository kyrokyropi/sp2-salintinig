import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { useAccessibility } from '@/components/accessibility-context';

export default function TabLayout() {
  const { colors, isDark, scaledFont } = useAccessibility();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: isDark ? colors.card : '#FFFFFF',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 90 : 68,
          paddingBottom: Platform.OS === 'ios' ? 26 : 10,
          paddingTop: 10,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontSize: scaledFont(13),
          fontWeight: '700',
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Pag-scan',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={28} name={focused ? 'scan' : 'scan-outline'} color={color} />
          ),
          tabBarAccessibilityLabel: 'Tab ng Pag-scan. Pindutin para mag-scan ng teksto mula sa larawan.',
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Kasaysayan',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={28} name={focused ? 'time' : 'time-outline'} color={color} />
          ),
          tabBarAccessibilityLabel: 'Tab ng Kasaysayan. Pindutin para makita ang mga na-save na scan at album.',
        }}
      />
    </Tabs>
  );
}
