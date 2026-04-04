import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  type Scan,
  deleteScan,
  getScans,
  renameScan,
  updateScanText,
} from '@/components/db-service';
import { translateTo, type TTSLanguage } from '@/components/tts-service';
import { correctText } from '@/components/ocr-service';
import { useAccessibility } from '@/components/accessibility-context';
import { Palette, Radius } from '@/constants/theme';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── rename modal ─────────────────────────────────────────────────────────────

type RenameModalProps = {
  visible: boolean;
  initial: string;
  colors: ReturnType<typeof useAccessibility>['colors'];
  scaledFont: (n: number) => number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

function RenameModal({ visible, initial, colors, scaledFont, onConfirm, onCancel }: RenameModalProps) {
  const [value, setValue] = useState(initial);

  useEffect(() => { setValue(initial); }, [initial, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalOverlay} onPress={onCancel}>
        <Pressable style={[styles.modalBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.text, fontSize: scaledFont(20) }]}>Palitan ang Pangalan ng Scan</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.text, fontSize: scaledFont(17) }]}
            value={value}
            onChangeText={setValue}
            placeholder="Pangalan ng scan"
            placeholderTextColor={colors.textSecondary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => value.trim() && onConfirm(value.trim())}
            accessibilityLabel="Input ng pangalan ng scan"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalBtn, { borderColor: colors.ghostBtnBorder, borderWidth: 2 }]}
              onPress={onCancel}
              accessibilityLabel="Kanselahin"
              accessibilityRole="button">
              <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: scaledFont(16) }}>Kanselahin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnPrimary, { backgroundColor: colors.accent }]}
              onPress={() => value.trim() && onConfirm(value.trim())}
              accessibilityLabel="I-save ang pangalan ng scan"
              accessibilityRole="button">
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: scaledFont(16) }}>I-save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── scan detail modal ────────────────────────────────────────────────────────

type ScanDetailModalProps = {
  scan: Scan | null;
  colors: ReturnType<typeof useAccessibility>['colors'];
  isDark: boolean;
  scaledFont: (n: number) => number;
  onClose: () => void;
  onTextSaved: (id: number, newText: string) => void;
};

function ScanDetailModal({ scan, colors, isDark, scaledFont, onClose, onTextSaved }: ScanDetailModalProps) {
  const [ttsLoading, setTtsLoading] = useState<TTSLanguage | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (scan) {
      setEditedText(scan.original_text);
      setEditing(false);
    }
  }, [scan?.id]);

  const saveEdit = () => {
    if (!scan) return;
    updateScanText(scan.id, editedText);
    onTextSaved(scan.id, editedText);
    setEditing(false);
  };

  const autoCorrect = async () => {
    if (!editedText.trim()) return;
    try {
      setCorrecting(true);
      const corrected = await correctText(editedText);
      setEditedText(corrected);
      if (scan) {
        updateScanText(scan.id, corrected);
        onTextSaved(scan.id, corrected);
      }
    } catch {
      Alert.alert('May Error', 'Hindi nagtagumpay ang auto-correct. Siguraduhing tumatakbo ang server.');
    } finally {
      setCorrecting(false);
    }
  };

  const goToPlayback = async (language: TTSLanguage) => {
    if (!editedText.trim()) return;
    try {
      setTtsLoading(language);
      const finalText = await translateTo(editedText, language);
      onClose();
      router.push({ pathname: '/playback', params: { text: finalText, lang: language } });
    } catch {
      Alert.alert('May Error', 'Hindi naihanda ang audio. Siguraduhing tumatakbo ang backend server.');
    } finally {
      setTtsLoading(null);
    }
  };

  const downloadPdf = async () => {
    if (!editedText.trim()) return;
    try {
      setPdfLoading(true);
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
              p { font-size: 16px; line-height: 1.7; white-space: pre-wrap; }
            </style>
          </head>
          <body>
            <h1>SalinTinig — ${scan?.name ?? ''}</h1>
            <div class="meta">${scan ? new Date(scan.created_at).toLocaleString() : ''}</div>
            <h2>Nakuhang Teksto</h2>
            <p>${editedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
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

  return (
    <Modal visible={scan !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.detailRoot, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.detailHeader}>
          <TouchableOpacity
            style={[styles.detailCloseBtn, { backgroundColor: colors.accentLight }]}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityLabel="Isara ang detalye ng scan"
            accessibilityRole="button">
            <Text style={[styles.detailCloseText, { color: colors.accent }]}>✕</Text>
          </TouchableOpacity>
          <Text
            style={[styles.detailTitle, { color: colors.text, fontSize: scaledFont(18) }]}
            numberOfLines={1}
            accessibilityRole="header">
            {scan?.name ?? ''}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        <Text style={[styles.detailMeta, { color: colors.textSecondary, fontSize: scaledFont(14) }]}>
          {scan ? formatDate(scan.created_at) : ''}
        </Text>

        {/* Full text card */}
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: isDark ? colors.border : 'transparent', borderWidth: isDark ? 1 : 0 }]}>
          <View style={styles.detailCardHeader}>
            <View style={[styles.detailCardDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.detailCardLabel, { color: colors.textSecondary, fontSize: scaledFont(13) }]}>
              Nakuhang Teksto
            </Text>
            {!editing ? (
              <TouchableOpacity
                style={[styles.editBtn, { backgroundColor: colors.accentLight }]}
                onPress={() => setEditing(true)}
                hitSlop={8}
                accessibilityLabel="I-edit ang teksto"
                accessibilityRole="button">
                <Text style={[styles.editBtnText, { color: colors.accent, fontSize: scaledFont(14) }]}>I-edit</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.editActions}>
                <TouchableOpacity
                  onPress={() => { setEditedText(scan?.original_text ?? ''); setEditing(false); }}
                  hitSlop={8}
                  accessibilityLabel="Kanselahin ang pag-edit"
                  accessibilityRole="button">
                  <Text style={[styles.editCancelText, { color: colors.textSecondary, fontSize: scaledFont(14) }]}>Kanselahin</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editSaveBtn, { backgroundColor: colors.accent }]}
                  onPress={saveEdit}
                  hitSlop={8}
                  accessibilityLabel="I-save ang inedit na teksto"
                  accessibilityRole="button">
                  <Text style={[styles.editSaveText, { fontSize: scaledFont(14) }]}>I-save</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {editing ? (
            <TextInput
              style={[styles.editInput, { color: colors.text, borderColor: colors.accent, fontSize: scaledFont(16) }]}
              value={editedText}
              onChangeText={setEditedText}
              multiline
              autoFocus
              textAlignVertical="top"
              accessibilityLabel="I-edit ang na-scan na teksto"
            />
          ) : (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.detailText, { color: colors.text, fontSize: scaledFont(16), lineHeight: scaledFont(26) }]} selectable>
                {editedText || 'Walang teksto.'}
              </Text>
            </ScrollView>
          )}
        </View>

        {/* TTS buttons */}
        <View style={styles.detailTtsRow}>
          <TouchableOpacity
            style={[styles.ttsBtn, { borderColor: colors.accent, backgroundColor: colors.accentLight }, ttsLoading === 'tl' && styles.ttsBtnLoading]}
            onPress={() => goToPlayback('tl')}
            disabled={ttsLoading !== null}
            activeOpacity={0.75}
            accessibilityLabel={ttsLoading === 'tl' ? 'Isinasalin sa Tagalog' : 'Pakinggan sa Tagalog'}
            accessibilityRole="button">
            <Text style={{ fontSize: 20 }}>🔊</Text>
            <Text style={[styles.ttsBtnText, { color: colors.accent, fontSize: scaledFont(16) }]}>
              {ttsLoading === 'tl' ? 'Isinasalin...' : 'Pakinggan sa Tagalog'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ttsBtn, { borderColor: colors.accent, backgroundColor: colors.accentLight }, ttsLoading === 'en' && styles.ttsBtnLoading]}
            onPress={() => goToPlayback('en')}
            disabled={ttsLoading !== null}
            activeOpacity={0.75}
            accessibilityLabel={ttsLoading === 'en' ? 'Isinasalin sa Ingles' : 'Pakinggan sa Ingles'}
            accessibilityRole="button">
            <Text style={{ fontSize: 20 }}>🔊</Text>
            <Text style={[styles.ttsBtnText, { color: colors.accent, fontSize: scaledFont(16) }]}>
              {ttsLoading === 'en' ? 'Isinasalin...' : 'Pakinggan sa Ingles'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <View style={styles.detailActions}>
          <TouchableOpacity
            style={[styles.ghostBtn, { borderColor: colors.ghostBtnBorder }, correcting && { opacity: 0.5 }]}
            onPress={autoCorrect}
            disabled={correcting || editing}
            activeOpacity={0.75}
            accessibilityLabel={correcting ? 'Itinatama ang teksto' : 'I-auto-correct ang teksto'}
            accessibilityRole="button">
            <Text style={[styles.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}>
              {correcting ? 'Itinatama...' : 'I-auto-correct ang Teksto'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ghostBtn, { borderColor: colors.ghostBtnBorder }, pdfLoading && { opacity: 0.5 }]}
            onPress={downloadPdf}
            disabled={pdfLoading}
            activeOpacity={0.75}
            accessibilityLabel={pdfLoading ? 'Ginagawa ang PDF' : 'I-download bilang PDF'}
            accessibilityRole="button">
            <Text style={[styles.ghostBtnText, { color: colors.ghostBtnText, fontSize: scaledFont(16) }]}>
              {pdfLoading ? 'Ginagawa ang PDF...' : 'I-download ang PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── scan card ────────────────────────────────────────────────────────────────

type ScanCardProps = {
  scan: Scan;
  colors: ReturnType<typeof useAccessibility>['colors'];
  isDark: boolean;
  scaledFont: (n: number) => number;
  onPress: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function ScanCard({ scan, colors, isDark, scaledFont, onPress, onRename, onDelete }: ScanCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.scanCard,
        {
          backgroundColor: colors.card,
          borderColor: isDark ? colors.border : 'transparent',
          borderWidth: isDark ? 1 : 0,
          ...(!isDark ? {
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 3 },
            elevation: 2,
          } : {}),
        },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityLabel={`Scan: ${scan.name}. Pindutin para makita ang detalye.`}
      accessibilityRole="button">
      <View style={styles.scanHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.scanName, { color: colors.text, fontSize: scaledFont(17) }]} numberOfLines={1}>
            {scan.name}
          </Text>
          <Text style={[styles.scanMeta, { color: colors.textSecondary, fontSize: scaledFont(14) }]}>
            {formatDate(scan.created_at)}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            onPress={onRename}
            hitSlop={8}
            accessibilityLabel={`Palitan ang pangalan ng scan ${scan.name}`}
            accessibilityRole="button">
            <Text style={{ fontSize: 18 }}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            onPress={onDelete}
            hitSlop={8}
            accessibilityLabel={`Burahin ang scan ${scan.name}`}
            accessibilityRole="button">
            <Text style={{ fontSize: 18 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text style={[styles.scanText, { color: colors.textSecondary, fontSize: scaledFont(15), lineHeight: scaledFont(23) }]} numberOfLines={2}>
        {scan.original_text}
      </Text>

      <Text style={[styles.scanTapHint, { color: colors.accent, fontSize: scaledFont(13) }]}>
        Pindutin para suriin
      </Text>
    </TouchableOpacity>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────────

export default function AlbumDetailScreen() {
  const { colors, isDark, scaledFont } = useAccessibility();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  const [scans, setScans] = useState<Scan[]>([]);
  const [renameTarget, setRenameTarget] = useState<Scan | null>(null);
  const [detailScan, setDetailScan] = useState<Scan | null>(null);

  const loadScans = useCallback(() => {
    setScans(getScans(Number(id)));
  }, [id]);

  useEffect(() => { loadScans(); }, [loadScans]);

  function handleRename(scan: Scan, newName: string) {
    renameScan(scan.id, newName);
    setRenameTarget(null);
    loadScans();
  }

  function handleDelete(scan: Scan) {
    Alert.alert('Burahin ang Scan', `Burahin ang "${scan.name}"? Hindi na ito maibabalik.`, [
      { text: 'Kanselahin', style: 'cancel' },
      {
        text: 'Burahin',
        style: 'destructive',
        onPress: () => { deleteScan(scan.id); loadScans(); },
      },
    ]);
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.accentLight }]}
          hitSlop={8}
          accessibilityLabel="Bumalik"
          accessibilityRole="button">
          <Text style={[styles.backArrow, { color: colors.accent }]}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.headerTitle, { color: colors.text, fontSize: scaledFont(20) }]}
            numberOfLines={1}
            accessibilityRole="header">
            {name}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: scaledFont(13) }]}>
            {scans.length} {scans.length === 1 ? 'scan' : 'mga scan'}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {scans.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentLight }]}>
            <Text style={{ fontSize: 44 }}>📄</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: scaledFont(20) }]}>
            Wala pang mga scan
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: scaledFont(16) }]}>
            Pumunta sa tab ng Pag-scan para mag-scan{`\n`}ng teksto at i-save dito.
          </Text>
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ScanCard
              scan={item}
              colors={colors}
              isDark={isDark}
              scaledFont={scaledFont}
              onPress={() => setDetailScan(item)}
              onRename={() => setRenameTarget(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      )}

      <RenameModal
        visible={renameTarget !== null}
        initial={renameTarget?.name ?? ''}
        colors={colors}
        scaledFont={scaledFont}
        onConfirm={(n) => renameTarget && handleRename(renameTarget, n)}
        onCancel={() => setRenameTarget(null)}
      />

      <ScanDetailModal
        scan={detailScan}
        colors={colors}
        isDark={isDark}
        scaledFont={scaledFont}
        onClose={() => setDetailScan(null)}
        onTextSaved={(scanId, newText) => {
          setScans(prev => prev.map(s => s.id === scanId ? { ...s, original_text: newText } : s));
          setDetailScan(prev => prev && prev.id === scanId ? { ...prev, original_text: newText } : prev);
        }}
      />
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 32, lineHeight: 36, fontWeight: '400' },
  headerTitle: { fontWeight: '700', textAlign: 'center' },
  headerSubtitle: { textAlign: 'center', marginTop: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },

  // scan card
  scanCard: {
    borderRadius: Radius.lg,
    padding: 16,
  },
  scanHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  scanName: { fontWeight: '700', marginBottom: 3 },
  scanMeta: {},
  cardActions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    padding: 8,
    borderRadius: Radius.sm,
    minWidth: 38,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: 1, marginVertical: 12 },
  scanText: {},
  scanTapHint: { marginTop: 10, textAlign: 'right', fontWeight: '600' },

  // empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontWeight: '800' },
  emptyText: { textAlign: 'center', lineHeight: 24 },

  // rename modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBox: {
    width: '88%',
    borderRadius: Radius.xl,
    padding: 24,
    gap: 18,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 8 },
    }),
  },
  modalTitle: { fontWeight: '800' },
  modalInput: { borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: Radius.md, minHeight: 48, justifyContent: 'center' },
  modalBtnPrimary: {},

  // detail modal
  detailRoot: { flex: 1 },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  detailCloseBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailCloseText: { fontSize: 18, fontWeight: '700' },
  detailTitle: { flex: 1, fontWeight: '700', textAlign: 'center' },
  detailMeta: { paddingHorizontal: 20, paddingBottom: 10 },
  detailCard: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Radius.xl,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  detailCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  detailCardDot: { width: 10, height: 10, borderRadius: 5 },
  detailCardLabel: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  detailText: {},
  editBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  editBtnText: { fontWeight: '700' },
  editActions: { marginLeft: 'auto', flexDirection: 'row', gap: 10, alignItems: 'center' },
  editCancelText: { fontWeight: '600' },
  editSaveBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: Radius.sm },
  editSaveText: { color: '#fff', fontWeight: '800' },
  editInput: {
    flex: 1,
    lineHeight: 24,
    borderWidth: 2,
    borderRadius: Radius.md,
    padding: 12,
    minHeight: 120,
  },
  detailTtsRow: { flexDirection: 'column', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
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
  ttsBtnLoading: { opacity: 0.5 },
  ttsBtnText: { fontWeight: '700' },
  detailActions: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
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
});
