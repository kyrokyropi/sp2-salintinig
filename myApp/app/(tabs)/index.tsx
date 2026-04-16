import { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
  Easing,
  Modal,
  StatusBar,
  FlatList,
  TextInput,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { recognizeImage, correctText } from '@/components/ocr-service';
import { translateTo, type TTSLanguage } from '@/components/tts-service';
import { CropView, type PixelCropRegion } from '@/components/crop-view';
import {
  type Album,
  createAlbum,
  createScan,
  getAlbums,
  initDb,
} from '@/components/db-service';
import { useAccessibility } from '@/components/accessibility-context';
import { Palette, Radius } from '@/constants/theme';

// ─── types ────────────────────────────────────────────────────────────────────

type Screen = 'camera' | 'crop' | 'processing' | 'result';

// ─── component ────────────────────────────────────────────────────────────────

export default function ScannerScreen() {
  const { colors, isDark, scaledFont, highContrast, textScale, toggleHighContrast, cycleTextScale, reducedMotion } = useAccessibility();
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<Screen>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [croppedUri, setCroppedUri] = useState<string | null>(null);
  const [scannedText, setScannedText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [ttsLoading, setTtsLoading] = useState<TTSLanguage | null>(null);
  const [largeFontSize, setLargeFontSize] = useState(false);
  const [showExtraActions, setShowExtraActions] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [savingToAlbum, setSavingToAlbum] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => { initDb(); }, []);

  // ── pulse animation (capture button) ────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim, reducedMotion]);

  // ── spinner animation (processing) ──────────────────────────────────────────
  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (screen !== 'processing') return;
    const loop = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: reducedMotion ? 2400 : 1200, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => { loop.stop(); spinAnim.setValue(0); };
  }, [screen, spinAnim, reducedMotion]);
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── take picture ─────────────────────────────────────────────────────────────
  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: false,
        quality: 1,
        skipProcessing: false,
      });
      if (photo) {
        setCapturedUri(photo.uri);
        setScreen('crop');
      }
    } catch {
      Alert.alert('May Error', 'Hindi makuhanan ng larawan.');
    }
  };

  // ── pick from gallery ────────────────────────────────────────────────────────
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setCapturedUri(result.assets[0].uri);
      setScreen('crop');
    }
  };

  // ── crop confirmed → crop image → run OCR ────────────────────────────────────
  const handleCropConfirm = useCallback(
    async (region: PixelCropRegion) => {
      if (!capturedUri) return;
      setScreen('processing');

      try {
        // 1. Crop the image
        const cropCtx = ImageManipulator.manipulate(capturedUri);
        cropCtx.crop({ originX: region.originX, originY: region.originY, width: region.width, height: region.height });
        const cropRef = await cropCtx.renderAsync();

        // 2. Resize if too large — cap longest side at 1500px to save memory
        const MAX_SIDE = 1500;
        const needsResize = region.width > MAX_SIDE || region.height > MAX_SIDE;
        let finalRef = cropRef;
        if (needsResize) {
          const scale = MAX_SIDE / Math.max(region.width, region.height);
          const resizeCtx = ImageManipulator.manipulate(cropRef.uri);
          resizeCtx.resize({
            width: Math.round(region.width * scale),
            height: Math.round(region.height * scale),
          });
          finalRef = await resizeCtx.renderAsync();
        }

        // 3. Save as JPEG with moderate compression (0.7 is plenty for text)
        const saved = await finalRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
        setCroppedUri(saved.uri);

        if (!saved.base64) throw new Error('No base64 from crop');

        // 4. Extract base64, send to OCR, then let the string get GC'd
        const base64 = saved.base64;
        const result = await recognizeImage(base64);
        setConfidence(result.confidence);
        let finalText = result.text;
        if (result.text.trim()) {
          try {
            finalText = await correctText(result.text);
          } catch {
            // correction failed — fall back to raw OCR text
          }
        }
        setScannedText(finalText);
        setScreen('result');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('OCR pipeline error:', msg);
        Alert.alert('May Error', msg);
        setScreen('camera');
      }
    },
    [capturedUri]
  );

  // ── save to album ────────────────────────────────────────────────────────────
  const hasScannedText = !!scannedText?.trim();
  const displayText = hasScannedText ? (scannedText as string) : 'Walang natukoy na teksto.';

  const openSaveModal = () => {
    if (!hasScannedText) return;
    setAlbums(getAlbums());
    setNewAlbumName('');
    setSaveModalOpen(true);
  };

  const saveToAlbum = async (album: Album) => {
    if (!hasScannedText || !scannedText) return;
    setSavingToAlbum(true);
    try {
      createScan(album.id, `Scan ${new Date().toLocaleString()}`, scannedText, '', '');
      setSaveModalOpen(false);
      Alert.alert('Nai-save', `Nai-save ang scan sa "${album.name}".`);
    } finally {
      setSavingToAlbum(false);
    }
  };

  const saveToNewAlbum = async () => {
    const name = newAlbumName.trim();
    if (!name || !hasScannedText || !scannedText) return;
    setSavingToAlbum(true);
    try {
      const album = createAlbum(name);
      createScan(album.id, `Scan ${new Date().toLocaleString()}`, scannedText, '', '');
      setSaveModalOpen(false);
      setNewAlbumName('');
      Alert.alert('Nai-save', `Nai-save ang scan sa bagong album na "${name}".`);
    } finally {
      setSavingToAlbum(false);
    }
  };

  // ── reset ────────────────────────────────────────────────────────────────────
  const reset = () => {
    setCapturedUri(null);
    setCroppedUri(null);
    setScannedText(null);
    setConfidence(null);
    setImageViewerOpen(false);
    setShowExtraActions(false);
    setScreen('camera');
  };

  // ── download PDF ─────────────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);

  const downloadPdf = async () => {
    if (!hasScannedText || !scannedText) return;
    try {
      setPdfLoading(true);
      const bodyFontSize = largeFontSize ? '24px' : '16px';
      const lineHeight = largeFontSize ? '2' : '1.7';
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8"/>
            <style>
              body { font-family: sans-serif; padding: 40px; color: #1a1a1a; }
              h1 { font-size: 22px; color: ${Palette.honey}; margin-bottom: 4px; }
              .meta { font-size: 12px; color: #888; margin-bottom: 32px; }
              h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 8px; }
              p { font-size: ${bodyFontSize}; line-height: ${lineHeight}; white-space: pre-wrap; }
            </style>
          </head>
          <body>
            <h1>SalinTinig — Resulta ng Scan</h1>
            <div class="meta">${new Date().toLocaleString()}</div>
            <h2>Nakuhang Teksto</h2>
            <p>${scannedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Nai-save', 'Nai-save ang PDF sa mga dokumento ng app.');
      }
    } catch (e: unknown) {
      Alert.alert('May Error', e instanceof Error ? e.message : 'Hindi nagawa ang PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  // ── navigate to playback ─────────────────────────────────────────────────────
  const goToPlayback = async (language: TTSLanguage) => {
    if (!hasScannedText || !scannedText) return;
    try {
      setTtsLoading(language);
      const finalText = await translateTo(scannedText, language);
      router.push({ pathname: '/playback', params: { text: finalText, lang: language } });
    } catch {
      Alert.alert('May Error', 'Hindi naihanda ang audio. Siguraduhing tumatakbo ang backend server.');
    } finally {
      setTtsLoading(null);
    }
  };

  // ── confidence helpers ────────────────────────────────────────────────────────
  const confidenceColor = (c: number) =>
    c >= 80 ? colors.success : c >= 50 ? colors.warning : colors.error;
  const confidenceBg = (c: number) =>
    c >= 80 ? 'rgba(76,175,80,0.12)' : c >= 50 ? 'rgba(255,152,0,0.12)' : 'rgba(229,57,53,0.12)';
  const confidenceLabel = (c: number) =>
    c >= 80 ? 'Mataas na kumpiyansa' : c >= 50 ? 'Katamtamang kumpiyansa' : 'Mababang kumpiyansa';

  // ─── Accessibility toolbar (shared across result screens) ───────────────────
  const AccessibilityToolbar = () => (
    <View style={[s.accessibilityBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity
        style={[s.a11yBtn, highContrast && { backgroundColor: colors.accent }]}
        onPress={toggleHighContrast}
        activeOpacity={0.7}
        accessibilityLabel={highContrast ? 'I-off ang high contrast mode' : 'I-on ang high contrast mode'}
        accessibilityRole="button">
        <Text style={[s.a11yBtnText, { color: highContrast ? Palette.white : colors.text, fontSize: scaledFont(13) }]}>
          {highContrast ? '◉ Hi-Con' : '○ Hi-Con'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.a11yBtn}
        onPress={cycleTextScale}
        activeOpacity={0.7}
        accessibilityLabel={`Sukat ng teksto: ${textScale}x. Pindutin para palitan.`}
        accessibilityRole="button">
        <Text style={[s.a11yBtnText, { color: colors.text, fontSize: scaledFont(13) }]}>
          Aa {textScale}x
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ─── permission loading ──────────────────────────────────────────────────────
  if (!permission) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        <View style={s.center}>
          <View style={[s.loadingRing, { borderColor: colors.border, borderTopColor: colors.accent }]} />
          <Text style={[s.loadingLabel, { color: colors.textSecondary, fontSize: scaledFont(16) }]}>
            Niloload ang kamera...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── permission denied ───────────────────────────────────────────────────────
  if (!permission.granted) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        <View style={s.center}>
          <View style={[s.permIconWrap, { backgroundColor: colors.accentLight }]}>
            <Text style={{ fontSize: 44 }}>📷</Text>
          </View>
          <Text
            style={[s.heading, { color: colors.text, fontSize: scaledFont(28) }]}
            accessibilityRole="header">
            Access sa Kamera
          </Text>
          <Text style={[s.subheading, { color: colors.textSecondary, fontSize: scaledFont(16), lineHeight: scaledFont(24) }]}>
            Payagan ang access sa kamera para direktang mag-scan ng teksto, o mag-upload ng larawan mula sa galeriya.
          </Text>
          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: colors.primaryBtn }]}
            onPress={requestPermission}
            activeOpacity={0.8}
            accessibilityLabel="Payagan ang access sa kamera"
            accessibilityRole="button">
            <Text style={[s.primaryBtnText, { fontSize: scaledFont(18) }]}>Payagan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.ghostBtn, { borderColor: colors.ghostBtnBorder }]}
            onPress={pickImage}
            activeOpacity={0.7}
            accessibilityLabel="Mag-upload na lang ng larawan mula sa galeriya"
            accessibilityRole="button">
            <Text style={[s.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}>
              Mag-upload ng Larawan
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── crop screen ─────────────────────────────────────────────────────────────
  if (screen === 'crop' && capturedUri) {
    return (
      <SafeAreaView style={[s.rootDark, { backgroundColor: '#0d0d0d' }]} edges={['top', 'bottom']}>
        <CropView imageUri={capturedUri} onConfirm={handleCropConfirm} onCancel={reset} />
      </SafeAreaView>
    );
  }

  // ─── processing screen ───────────────────────────────────────────────────────
  if (screen === 'processing') {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        <View style={s.center}>
          {croppedUri ? (
            <View style={s.processingImgWrap}>
              <Image source={{ uri: croppedUri }} style={s.processingImg} contentFit="cover" />
              <View style={[s.processingImgOverlay, { backgroundColor: `${colors.accent}20` }]} />
            </View>
          ) : (
            <View style={s.processingImgWrap}>
              <View style={[s.processingImg, { backgroundColor: colors.surface }]} />
            </View>
          )}
          <Animated.View style={[s.spinner, { borderColor: colors.border, borderTopColor: colors.accent, transform: [{ rotate: spin }] }]} />
          <Text
            style={[s.processingTitle, { color: colors.text, fontSize: scaledFont(22) }]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite">
            Sini-scan ang teksto...
          </Text>
          <Text style={[s.processingSubtitle, { color: colors.textSecondary, fontSize: scaledFont(15) }]}>
            Kino-convert ang larawan mo sa teksto
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── result screen ───────────────────────────────────────────────────────────
  if (screen === 'result') {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        {/* Accessibility toolbar */}
        <AccessibilityToolbar />

        {/* Header */}
        <View style={s.resultTopBar}>
          <Text
            style={[s.appName, { color: colors.text, fontSize: scaledFont(24) }]}
            accessibilityRole="header">
            SalinTinig
          </Text>
          {confidence !== null && (
            <View
              style={[s.confidencePill, { backgroundColor: confidenceBg(confidence) }]}
              accessibilityLabel={`${Math.round(confidence)} porsyentong kumpiyansa. ${confidenceLabel(confidence)}`}>
              <View style={[s.confidenceDot, { backgroundColor: confidenceColor(confidence) }]} />
              <Text style={[s.confidenceText, { color: confidenceColor(confidence), fontSize: scaledFont(13) }]}>
                {Math.round(confidence)}%
              </Text>
            </View>
          )}
        </View>

        {/* Cropped image thumbnail */}
        {croppedUri && (
          <TouchableOpacity
            style={[s.thumbWrap, { borderColor: colors.border }]}
            onPress={() => setImageViewerOpen(true)}
            activeOpacity={0.85}
            accessibilityLabel="Tingnan ang na-scan na larawan sa buong screen"
            accessibilityRole="imagebutton">
            <Image source={{ uri: croppedUri }} style={s.thumb} contentFit="cover" />
            <View style={s.thumbOverlay} />
            <View style={s.thumbBadge}>
              <Text style={s.thumbBadgeText}>Tingnan ang larawan</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Text result card */}
        <View style={[s.resultCard, { backgroundColor: colors.card, shadowColor: isDark ? 'transparent' : '#000', borderColor: isDark ? colors.border : 'transparent', borderWidth: isDark ? 1 : 0 }]}>
          <View style={s.resultCardHeader}>
            <View style={[s.resultCardDot, { backgroundColor: colors.accent }]} />
            <Text style={[s.resultCardTitle, { color: colors.textSecondary, fontSize: scaledFont(13) }]}>
              Nakuhang Teksto
            </Text>
            <View style={[s.fontToggle, { backgroundColor: colors.accentLight }]}>
              <TouchableOpacity
                style={[s.fontToggleBtn, !largeFontSize && { backgroundColor: colors.accent }]}
                onPress={() => setLargeFontSize(false)}
                accessibilityLabel="Normal na laki ng font"
                accessibilityRole="button">
                <Text style={[{ fontSize: scaledFont(13), fontWeight: '600', color: !largeFontSize ? Palette.white : colors.textSecondary }]}>A</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.fontToggleBtn, largeFontSize && { backgroundColor: colors.accent }]}
                onPress={() => setLargeFontSize(true)}
                accessibilityLabel="Malaking laki ng font"
                accessibilityRole="button">
                <Text style={[{ fontSize: scaledFont(18), fontWeight: '600', color: largeFontSize ? Palette.white : colors.textSecondary }]}>A</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView style={s.resultScroll} showsVerticalScrollIndicator={false}>
            <Text
              style={[
                s.resultText,
                { color: colors.text, fontSize: scaledFont(largeFontSize ? 24 : 16), lineHeight: scaledFont(largeFontSize ? 38 : 26) },
              ]}
              selectable
              accessibilityLabel={displayText}>
              {displayText}
            </Text>
          </ScrollView>
        </View>

        {/* Action buttons */}
        <View style={s.resultActions}>
          <TouchableOpacity
            style={[s.ghostBtn, { borderColor: colors.ghostBtnBorder }]}
            onPress={() => setShowExtraActions((v) => !v)}
            activeOpacity={0.75}
            accessibilityLabel={showExtraActions ? 'Itago ang dagdag na aksyon' : 'Ipakita ang dagdag na aksyon'}
            accessibilityRole="button">
            <Text style={[s.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}> 
              {showExtraActions ? 'Itago ang mga Aksyon' : 'Ipakita ang mga Aksyon'}
            </Text>
          </TouchableOpacity>

          {showExtraActions && (
            <>
              <View style={s.ttsRowCompact}>
                <TouchableOpacity
                  style={[s.ttsBtn, { borderColor: colors.accent, backgroundColor: colors.accentLight }, ttsLoading === 'tl' && s.ttsBtnLoading]}
                  onPress={() => goToPlayback('tl')}
                  disabled={ttsLoading !== null || !hasScannedText}
                  activeOpacity={0.75}
                  accessibilityLabel={ttsLoading === 'tl' ? 'Isinasalin sa Tagalog' : 'Pakinggan sa Tagalog'}
                  accessibilityRole="button">
                  <Text style={[s.ttsBtnIcon]}>🔊</Text>
                  <Text style={[s.ttsBtnText, { color: colors.accent, fontSize: scaledFont(16) }]}> 
                    {ttsLoading === 'tl' ? 'Isinasalin...' : 'Pakinggan sa Tagalog'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.ttsBtn, { borderColor: colors.accent, backgroundColor: colors.accentLight }, ttsLoading === 'en' && s.ttsBtnLoading]}
                  onPress={() => goToPlayback('en')}
                  disabled={ttsLoading !== null || !hasScannedText}
                  activeOpacity={0.75}
                  accessibilityLabel={ttsLoading === 'en' ? 'Isinasalin sa Ingles' : 'Pakinggan sa Ingles'}
                  accessibilityRole="button">
                  <Text style={[s.ttsBtnIcon]}>🔊</Text>
                  <Text style={[s.ttsBtnText, { color: colors.accent, fontSize: scaledFont(16) }]}> 
                    {ttsLoading === 'en' ? 'Isinasalin...' : 'Pakinggan sa Ingles'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.ghostBtn, { borderColor: colors.ghostBtnBorder }, (pdfLoading || !hasScannedText) && { opacity: 0.5 }]}
                onPress={downloadPdf}
                disabled={pdfLoading || !hasScannedText}
                activeOpacity={0.75}
                accessibilityLabel={pdfLoading ? 'Ginagawa ang PDF' : 'I-download bilang PDF'}
                accessibilityRole="button">
                <Text style={[s.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}> 
                  {pdfLoading ? 'Ginagawa ang PDF...' : 'I-download ang PDF'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.ghostBtn, { borderColor: colors.ghostBtnBorder }, !hasScannedText && { opacity: 0.5 }]}
                onPress={openSaveModal}
                disabled={!hasScannedText}
                activeOpacity={0.75}
                accessibilityLabel="I-save ang scan sa kasaysayan"
                accessibilityRole="button">
                <Text style={[s.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}> 
                  I-save sa Kasaysayan
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: colors.primaryBtn }]}
            onPress={reset}
            activeOpacity={0.8}
            accessibilityLabel="Mag-scan muli"
            accessibilityRole="button">
            <Text style={[s.primaryBtnText, { fontSize: scaledFont(18) }]}>Mag-scan Muli</Text>
          </TouchableOpacity>
        </View>

        {/* Save to Album modal */}
        <Modal visible={saveModalOpen} transparent animationType="slide" onRequestClose={() => setSaveModalOpen(false)}>
          <Pressable style={s.modalOverlay} onPress={() => setSaveModalOpen(false)}>
            <Pressable style={[s.saveModalBox, { backgroundColor: colors.card }]}>
              <Text style={[s.saveModalTitle, { color: colors.text, fontSize: scaledFont(20) }]}>I-save sa Album</Text>
              <View style={s.newAlbumRow}>
                <TextInput
                  style={[s.newAlbumInput, { backgroundColor: colors.surface, color: colors.text, fontSize: scaledFont(16) }]}
                  value={newAlbumName}
                  onChangeText={setNewAlbumName}
                  placeholder="Pangalan ng bagong album..."
                  placeholderTextColor={colors.textSecondary}
                  returnKeyType="done"
                  onSubmitEditing={saveToNewAlbum}
                  accessibilityLabel="Pangalan ng bagong album"
                />
                <TouchableOpacity
                  style={[s.newAlbumBtn, { backgroundColor: colors.accent }, !newAlbumName.trim() && { opacity: 0.4 }]}
                  onPress={saveToNewAlbum}
                  disabled={!newAlbumName.trim() || savingToAlbum}
                  accessibilityLabel="Gumawa ng bagong album">
                  <Text style={[s.newAlbumBtnText, { fontSize: scaledFont(15) }]}>+ Gumawa</Text>
                </TouchableOpacity>
              </View>
              {albums.length > 0 && (
                <>
                  <Text style={[s.saveModalSectionLabel, { color: colors.textSecondary, fontSize: scaledFont(12) }]}>
                    O pumili ng kasalukuyang album
                  </Text>
                  <FlatList
                    data={albums}
                    keyExtractor={(a) => String(a.id)}
                    style={{ maxHeight: 220 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[s.albumRow, { borderBottomColor: colors.border }]}
                        onPress={() => saveToAlbum(item)}
                        disabled={savingToAlbum}
                        activeOpacity={0.7}
                        accessibilityLabel={`I-save sa album: ${item.name}`}>
                        <Text style={[s.albumRowIcon]}>📁</Text>
                        <Text style={[s.albumRowText, { color: colors.text, fontSize: scaledFont(16) }]}>{item.name}</Text>
                      </TouchableOpacity>
                    )}
                  />
                </>
              )}
              {albums.length === 0 && (
                <Text style={[s.saveModalEmpty, { color: colors.textSecondary, fontSize: scaledFont(15) }]}>
                  Wala pang album — gumawa muna sa itaas.
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Full-screen image viewer modal */}
        <Modal
          visible={imageViewerOpen}
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setImageViewerOpen(false)}>
          <StatusBar backgroundColor="#000" barStyle="light-content" />
          <View style={s.viewerRoot}>
            <Image source={{ uri: croppedUri ?? '' }} style={s.viewerImage} contentFit="contain" />
            <SafeAreaView style={s.viewerTopBar} edges={['top']}>
              <TouchableOpacity
                style={s.viewerCloseBtn}
                onPress={() => setImageViewerOpen(false)}
                activeOpacity={0.8}
                accessibilityLabel="Isara ang viewer ng larawan"
                accessibilityRole="button">
                <Text style={s.viewerCloseText}>✕</Text>
              </TouchableOpacity>
              <Text style={s.viewerTitle}>Na-scan na Larawan</Text>
              <View style={{ width: 48 }} />
            </SafeAreaView>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ─── camera screen ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.rootDark} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={s.camTopBar}>
        <View>
          <Text style={[s.camTitle, { fontSize: scaledFont(24) }]} accessibilityRole="header">
            SalinTinig
          </Text>
          <Text style={[s.camSubtitle, { fontSize: scaledFont(13) }]}>
            Itutok sa teksto at kuhanan
          </Text>
        </View>
        <TouchableOpacity
          style={[s.galleryChip, { backgroundColor: `${Palette.honey}25`, borderColor: `${Palette.honey}60` }]}
          onPress={pickImage}
          activeOpacity={0.75}
          accessibilityLabel="Pumili ng larawan mula sa galeriya"
          accessibilityRole="button">
          <Text style={[s.galleryChipText, { color: Palette.honeyMuted, fontSize: scaledFont(15) }]}>
            Galeriya
          </Text>
        </TouchableOpacity>
      </View>

      {/* Camera */}
      <View style={s.camWrap}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back">
          <View style={[s.bracketTL, { borderColor: Palette.honey }]} />
          <View style={[s.bracketTR, { borderColor: Palette.honey }]} />
          <View style={[s.bracketBL, { borderColor: Palette.honey }]} />
          <View style={[s.bracketBR, { borderColor: Palette.honey }]} />
          <View style={s.camHintWrap}>
            <Text style={[s.camHint, { fontSize: scaledFont(14) }]} accessibilityLiveRegion="polite">
              I-align ang teksto sa loob ng frame
            </Text>
          </View>
        </CameraView>
      </View>

      {/* Capture row */}
      <View style={s.camBottomRow}>
        <View style={{ flex: 1 }} />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[s.captureBtn, { borderColor: Palette.honey }]}
            onPress={takePicture}
            activeOpacity={0.85}
            accessibilityLabel="Kunan ang larawan para i-scan"
            accessibilityRole="button">
            <View style={[s.captureBtnInner, { backgroundColor: Palette.honey }]} />
          </TouchableOpacity>
        </Animated.View>
        <View style={{ flex: 1 }} />
      </View>

      <Text style={[s.camFootnote, { fontSize: scaledFont(13) }]}>
        Pindutin ang button para kumuha
      </Text>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  rootDark: { flex: 1, backgroundColor: '#0d0d0d' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },

  // accessibility bar
  accessibilityBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
  },
  a11yBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Palette.sand,
  },
  a11yBtnText: {
    fontWeight: '700',
  },

  // loading
  loadingRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3.5,
  },
  loadingLabel: { marginTop: 4 },

  // permission
  permIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  heading: { fontWeight: '800', textAlign: 'center' },
  subheading: { textAlign: 'center', maxWidth: 300 },

  // buttons (shared)
  primaryBtn: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: Radius.lg,
    alignItems: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    minHeight: 56,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', letterSpacing: 0.3 },
  ghostBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 2,
    minHeight: 54,
    justifyContent: 'center',
  },
  ghostBtnText: { fontWeight: '700' },

  // processing
  processingImgWrap: {
    width: 130,
    height: 130,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 12,
  },
  processingImg: { width: '100%', height: '100%' },
  processingImgOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  spinner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 4,
  },
  processingTitle: { fontWeight: '800' },
  processingSubtitle: {},

  // result
  resultTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  appName: { fontWeight: '800', letterSpacing: -0.3 },
  confidencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceText: { fontWeight: '700' },

  // thumbnail
  thumbWrap: {
    marginHorizontal: 16,
    height: 140,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
  },
  thumb: { width: '100%', height: '100%' },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  thumbBadge: {
    position: 'absolute',
    bottom: 10,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  thumbBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // result card
  resultCard: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Radius.xl,
    padding: 20,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  resultCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  resultCardDot: { width: 10, height: 10, borderRadius: 5 },
  resultCardTitle: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  resultScroll: { flex: 1 },
  resultText: {},
  resultActions: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },

  // font size toggle
  fontToggle: {
    flexDirection: 'row',
    marginLeft: 'auto',
    borderRadius: Radius.sm,
    padding: 3,
    gap: 2,
  },
  fontToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // tts buttons
  ttsRow: {
    flexDirection: 'column',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  ttsRowCompact: {
    flexDirection: 'column',
    gap: 10,
  },
  ttsBtn: {
    paddingVertical: 16,
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    minHeight: 58,
  },
  ttsBtnLoading: {
    opacity: 0.5,
  },
  ttsBtnIcon: { fontSize: 22 },
  ttsBtnText: { fontWeight: '700' },

  // full-screen image viewer
  viewerRoot: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
  viewerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewerCloseBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  viewerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // camera
  camTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  camTitle: { color: '#fff', fontWeight: '800', letterSpacing: -0.3 },
  camSubtitle: { color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  galleryChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    minHeight: 44,
    justifyContent: 'center',
  },
  galleryChipText: { fontWeight: '700' },
  camWrap: {
    flex: 1,
    marginHorizontal: 12,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  bracketTL: {
    position: 'absolute', top: 24, left: 24, width: 36, height: 36,
    borderTopWidth: 3.5, borderLeftWidth: 3.5,
    borderTopLeftRadius: 6,
  },
  bracketTR: {
    position: 'absolute', top: 24, right: 24, width: 36, height: 36,
    borderTopWidth: 3.5, borderRightWidth: 3.5,
    borderTopRightRadius: 6,
  },
  bracketBL: {
    position: 'absolute', bottom: 24, left: 24, width: 36, height: 36,
    borderBottomWidth: 3.5, borderLeftWidth: 3.5,
    borderBottomLeftRadius: 6,
  },
  bracketBR: {
    position: 'absolute', bottom: 24, right: 24, width: 36, height: 36,
    borderBottomWidth: 3.5, borderRightWidth: 3.5,
    borderBottomRightRadius: 6,
  },
  camHintWrap: {
    position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center',
  },
  camHint: {
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: Radius.full,
    overflow: 'hidden',
    fontWeight: '600',
  },
  camBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 28,
  },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 3.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  camFootnote: {
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingBottom: 12,
    fontWeight: '500',
  },

  // save modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  saveModalBox: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 24,
    gap: 14,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 8 },
    }),
  },
  saveModalTitle: { fontWeight: '800', marginBottom: 4 },
  saveModalSectionLabel: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  saveModalEmpty: { textAlign: 'center', paddingVertical: 12 },
  newAlbumRow: { flexDirection: 'row', gap: 10 },
  newAlbumInput: {
    flex: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  newAlbumBtn: {
    borderRadius: Radius.md,
    paddingHorizontal: 18,
    justifyContent: 'center',
    minHeight: 50,
  },
  newAlbumBtnText: { color: '#fff', fontWeight: '800' },
  albumRow: {
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
  },
  albumRowIcon: { fontSize: 22 },
  albumRowText: { fontWeight: '500' },
});
