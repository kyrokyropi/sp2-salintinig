import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  type Album,
  createAlbum,
  deleteAlbum,
  getAlbumScanCount,
  getAlbums,
  initDb,
  renameAlbum,
} from '@/components/db-service';
import { useAccessibility } from '@/components/accessibility-context';
import { Palette, Radius } from '@/constants/theme';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── sub-components ───────────────────────────────────────────────────────────

type AlbumCardProps = {
  album: Album;
  scanCount: number;
  colors: ReturnType<typeof useAccessibility>['colors'];
  isDark: boolean;
  scaledFont: (n: number) => number;
  onPress: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function AlbumCard({ album, scanCount, colors, isDark, scaledFont, onPress, onRename, onDelete }: AlbumCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.card,
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
      accessibilityLabel={`Album: ${album.name}. ${scanCount} scan. Ginawa noong ${formatDate(album.created_at)}`}
      accessibilityRole="button">
      <View style={styles.cardInner}>
        {/* Icon */}
        <View style={[styles.albumIcon, { backgroundColor: colors.accentLight }]}>
          <Text style={{ fontSize: 28 }}>📁</Text>
        </View>
        {/* Info */}
        <View style={styles.cardBody}>
          <Text style={[styles.albumName, { color: colors.text, fontSize: scaledFont(18) }]} numberOfLines={1}>
            {album.name}
          </Text>
          <Text style={[styles.albumMeta, { color: colors.textSecondary, fontSize: scaledFont(14) }]}>
            {scanCount} {scanCount === 1 ? 'scan' : 'mga scan'} · {formatDate(album.created_at)}
          </Text>
        </View>
        {/* Actions */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            onPress={onRename}
            hitSlop={8}
            accessibilityLabel={`Palitan ang pangalan ng album ${album.name}`}
            accessibilityRole="button">
            <Text style={{ fontSize: 20 }}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            onPress={onDelete}
            hitSlop={8}
            accessibilityLabel={`Burahin ang album ${album.name}`}
            accessibilityRole="button">
            <Text style={{ fontSize: 20 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── name modal ───────────────────────────────────────────────────────────────

type NameModalProps = {
  visible: boolean;
  title: string;
  initial?: string;
  colors: ReturnType<typeof useAccessibility>['colors'];
  scaledFont: (n: number) => number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

function NameModal({ visible, title, initial = '', colors, scaledFont, onConfirm, onCancel }: NameModalProps) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalOverlay} onPress={onCancel}>
        <Pressable style={[styles.modalBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.text, fontSize: scaledFont(20) }]}>{title}</Text>
          <TextInput
            style={[
              styles.modalInput,
              { backgroundColor: colors.surface, color: colors.text, fontSize: scaledFont(17) },
            ]}
            value={value}
            onChangeText={setValue}
            placeholder="Pangalan ng album"
            placeholderTextColor={colors.textSecondary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => value.trim() && onConfirm(value.trim())}
            accessibilityLabel="Input ng pangalan ng album"
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
              accessibilityLabel="I-save ang pangalan ng album"
              accessibilityRole="button">
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: scaledFont(16) }}>I-save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { colors, isDark, scaledFont } = useAccessibility();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [scanCounts, setScanCounts] = useState<Record<number, number>>({});
  const [nameModal, setNameModal] = useState<{ mode: 'create' | 'rename'; album?: Album } | null>(null);

  useEffect(() => { initDb(); }, []);

  const loadAlbums = useCallback(() => {
    const list = getAlbums();
    setAlbums(list);
    const counts: Record<number, number> = {};
    for (const a of list) counts[a.id] = getAlbumScanCount(a.id);
    setScanCounts(counts);
  }, []);

  useFocusEffect(loadAlbums);

  function handleCreate(name: string) {
    createAlbum(name);
    setNameModal(null);
    loadAlbums();
  }

  function handleRename(album: Album, name: string) {
    renameAlbum(album.id, name);
    setNameModal(null);
    loadAlbums();
  }

  function handleDelete(album: Album) {
    Alert.alert(
      'Burahin ang Album',
      `Burahin ang "${album.name}" at lahat ng scan nito? Hindi na ito maibabalik.`,
      [
        { text: 'Kanselahin', style: 'cancel' },
        {
          text: 'Burahin',
          style: 'destructive',
          onPress: () => { deleteAlbum(album.id); loadAlbums(); },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text
            style={[styles.headerTitle, { color: colors.text, fontSize: scaledFont(30) }]}
            accessibilityRole="header">
            Kasaysayan
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: scaledFont(14) }]}>
            {albums.length} {albums.length === 1 ? 'album' : 'mga album'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.newBtn, { backgroundColor: colors.accent }]}
          onPress={() => setNameModal({ mode: 'create' })}
          accessibilityLabel="Gumawa ng bagong album"
          accessibilityRole="button">
          <Text style={[styles.newBtnText, { fontSize: scaledFont(16) }]}>+ Bagong Album</Text>
        </TouchableOpacity>
      </View>

      {albums.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentLight }]}>
            <Text style={{ fontSize: 48 }}>📂</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: scaledFont(20) }]}>
            Wala pang mga album
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: scaledFont(16) }]}>
            Gumawa ng album para simulan{`\n`}ang pag-save ng mga scan mo.
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
            onPress={() => setNameModal({ mode: 'create' })}
            accessibilityLabel="Gumawa ng unang album"
            accessibilityRole="button">
            <Text style={[styles.emptyBtnText, { fontSize: scaledFont(17) }]}>Gumawa ng Unang Album</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AlbumCard
              album={item}
              scanCount={scanCounts[item.id] ?? 0}
              colors={colors}
              isDark={isDark}
              scaledFont={scaledFont}
              onPress={() => router.push({ pathname: '/album/[id]', params: { id: item.id, name: item.name } })}
              onRename={() => setNameModal({ mode: 'rename', album: item })}
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      )}

      {/* create/rename modal */}
      <NameModal
        visible={nameModal !== null}
        title={nameModal?.mode === 'create' ? 'Bagong Album' : 'Palitan ang Pangalan ng Album'}
        initial={nameModal?.mode === 'rename' ? nameModal.album?.name : ''}
        colors={colors}
        scaledFont={scaledFont}
        onConfirm={(name) =>
          nameModal?.mode === 'rename' && nameModal.album
            ? handleRename(nameModal.album, name)
            : handleCreate(name)
        }
        onCancel={() => setNameModal(null)}
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  headerTitle: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    marginTop: 2,
  },
  newBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: Radius.full,
    minHeight: 48,
    justifyContent: 'center',
  },
  newBtnText: {
    color: '#fff',
    fontWeight: '800',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  // card
  card: {
    borderRadius: Radius.lg,
    padding: 16,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  albumIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  albumName: { fontWeight: '700', marginBottom: 3 },
  albumMeta: {},
  cardActions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    padding: 8,
    borderRadius: Radius.sm,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // empty
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontWeight: '800' },
  emptyText: { textAlign: 'center', lineHeight: 24 },
  emptyBtn: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: Radius.lg,
    marginTop: 8,
    minHeight: 54,
    justifyContent: 'center',
  },
  emptyBtnText: { color: '#fff', fontWeight: '800' },
  // modal
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
  modalInput: {
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  modalBtnPrimary: {},
});
