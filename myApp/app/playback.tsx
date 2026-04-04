import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { fetchTTS, type TTSLanguage } from '@/components/tts-service';
import { useAccessibility } from '@/components/accessibility-context';
import { Radius } from '@/constants/theme';

type PlayStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export default function PlaybackScreen() {
  const { colors, isDark, scaledFont } = useAccessibility();
  const { text, lang } = useLocalSearchParams<{ text: string; lang: string }>();
  const language = (lang === 'tl' ? 'tl' : 'en') as TTSLanguage;
  const langLabel = language === 'tl' ? 'Tagalog' : 'Ingles';

  const [status, setStatus] = useState<PlayStatus>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioUriRef = useRef<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Load TTS audio once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const base64Audio = await fetchTTS(text ?? '', language);
        if (cancelled) return;

        const uri = FileSystem.cacheDirectory + `tts_playback_${language}.mp3`;
        await FileSystem.writeAsStringAsync(uri, base64Audio, {
          encoding: FileSystem.EncodingType.Base64,
        });

        audioUriRef.current = uri;
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
        if (cancelled) {
          sound.unloadAsync();
          return;
        }

        sound.setOnPlaybackStatusUpdate((s) => {
          if (!s.isLoaded) return;
          if (s.didJustFinish) setStatus('paused');
          else if (s.isPlaying) setStatus('playing');
          else setStatus('paused');
        });

        soundRef.current = sound;
        setStatus('ready');
      } catch (e: unknown) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlayPause = async () => {
    const sound = soundRef.current;
    if (!sound) return;

    if (status === 'playing') {
      await sound.pauseAsync();
    } else {
      const s = await sound.getStatusAsync();
      if (s.isLoaded && s.positionMillis >= (s.durationMillis ?? 0) - 200) {
        await sound.setPositionAsync(0);
      }
      await sound.playAsync();
    }
  };

  const isPlayable = status === 'ready' || status === 'playing' || status === 'paused';

  const downloadMp3 = async () => {
    const src = audioUriRef.current;
    if (!src) return;
    try {
      setDownloading(true);
      const dest = FileSystem.documentDirectory + `salin_${language}_${Date.now()}.mp3`;
      await FileSystem.copyAsync({ from: src, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'audio/mpeg', UTI: 'public.mp3' });
      } else {
        Alert.alert('Nai-save', 'Nai-save ang audio sa mga dokumento ng app.');
      }
    } catch (e: unknown) {
      Alert.alert('May Error', e instanceof Error ? e.message : 'Hindi na-save ang audio.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.accentLight }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityLabel="Bumalik"
          accessibilityRole="button">
          <Text style={[styles.backIcon, { color: colors.accent }]}>←</Text>
        </TouchableOpacity>
        <Text
          style={[styles.title, { color: colors.text, fontSize: scaledFont(18) }]}
          accessibilityRole="header">
          Pakinggan sa {langLabel}
        </Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Language badge */}
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: colors.accentLight }]}>
          <View style={[styles.badgeDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.badgeText, { color: colors.accent, fontSize: scaledFont(12) }]}>
            TEKSTONG {langLabel.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Text card */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: isDark ? colors.border : 'transparent', borderWidth: isDark ? 1 : 0 }]}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text
            style={[styles.bodyText, { color: colors.text, fontSize: scaledFont(17), lineHeight: scaledFont(28) }]}
            selectable
            accessibilityLabel={text || 'Walang ibinigay na teksto'}>
            {text || 'Walang ibinigay na teksto.'}
          </Text>
        </ScrollView>
      </View>

      {/* Playback controls */}
      <View style={styles.controls}>
        {status === 'loading' && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text
              style={[styles.loadingText, { color: colors.textSecondary, fontSize: scaledFont(16) }]}
              accessibilityLiveRegion="polite">
              Inihahanda ang audio...
            </Text>
          </View>
        )}

        {status === 'error' && (
          <Text style={[styles.errorText, { color: colors.error, fontSize: scaledFont(16) }]}>
            {errorMsg || 'Hindi na-load ang audio.'}
          </Text>
        )}

        {isPlayable && (
          <>
            <TouchableOpacity
              style={[styles.playBtn, { backgroundColor: colors.accent, shadowColor: colors.accent }]}
              onPress={togglePlayPause}
              activeOpacity={0.8}
              accessibilityLabel={status === 'playing' ? 'I-pause ang audio' : 'I-play ang audio'}
              accessibilityRole="button">
              <Text style={styles.playIcon}>{status === 'playing' ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <Text style={[styles.statusLabel, { color: colors.textSecondary, fontSize: scaledFont(15) }]}>
              {status === 'playing' ? 'Tumutugtog...' : status === 'ready' ? 'Pindutin para i-play' : 'Naka-pause'}
            </Text>
            <TouchableOpacity
              style={[
                styles.downloadBtn,
                { borderColor: colors.accent, backgroundColor: colors.accentLight },
                downloading && styles.downloadBtnDisabled,
              ]}
              onPress={downloadMp3}
              disabled={downloading}
              activeOpacity={0.75}
              accessibilityLabel={downloading ? 'Nagse-save ng audio' : 'I-download ang MP3'}
              accessibilityRole="button">
              <Text style={[styles.downloadBtnText, { color: colors.accent, fontSize: scaledFont(16) }]}>
                {downloading ? 'Nagse-save...' : 'I-download ang MP3'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: { fontSize: 24, lineHeight: 28, fontWeight: '600' },
  title: { fontWeight: '700', flex: 1, textAlign: 'center' },

  // badge
  badgeRow: { paddingHorizontal: 20, paddingBottom: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: {
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // card
  card: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: Radius.xl,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  scroll: { flex: 1 },
  bodyText: {},

  // controls
  controls: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 16,
    minHeight: 160,
    justifyContent: 'center',
  },
  loadingWrap: { alignItems: 'center', gap: 14 },
  loadingText: { fontWeight: '500' },
  errorText: { textAlign: 'center', paddingHorizontal: 12, fontWeight: '600' },
  playBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  playIcon: { fontSize: 34, color: '#fff' },
  statusLabel: { fontWeight: '600', letterSpacing: 0.3 },
  downloadBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    borderWidth: 2,
    minHeight: 52,
    justifyContent: 'center',
  },
  downloadBtnDisabled: { opacity: 0.5 },
  downloadBtnText: { fontWeight: '700' },
});
