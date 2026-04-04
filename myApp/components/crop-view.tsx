import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { ImageManipulator } from 'expo-image-manipulator';
import { Palette, Radius } from '@/constants/theme';

const HANDLE_SIZE = 36;
const MIN_CROP_PX = 60;

/**
 * Crop region in the image's own pixel space.
 * Safe to pass directly to expo-image-manipulator.
 */
export interface PixelCropRegion {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

interface CropViewProps {
  imageUri: string;
  onConfirm: (region: PixelCropRegion) => void;
  onCancel: () => void;
}

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'body';

export function CropView({ imageUri, onConfirm, onCancel }: CropViewProps) {
  const containerRef = useRef<View>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const containerOffset = useRef({ x: 0, y: 0 });
  const [imgPixels, setImgPixels] = useState({ w: 0, h: 0 });
  const cropRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const initialized = useRef(false);
  const respondersReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = ImageManipulator.manipulate(imageUri);
        const ref = await ctx.renderAsync();
        if (!cancelled) {
          setImgPixels({ w: ref.width, h: ref.height });
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [imageUri]);

  const getImageRect = useCallback(() => {
    const { w: cw, h: ch } = container;
    const { w: iw, h: ih } = imgPixels;
    if (!cw || !ch || !iw || !ih) return null;
    const scale = Math.min(cw / iw, ch / ih);
    const displayW = iw * scale;
    const displayH = ih * scale;
    return {
      x: (cw - displayW) / 2,
      y: (ch - displayH) / 2,
      w: displayW,
      h: displayH,
      scale,
    };
  }, [container, imgPixels]);

  const initCrop = useCallback(() => {
    if (initialized.current) return;
    const rect = getImageRect();
    if (!rect) return;
    initialized.current = true;
    const PAD = Math.min(rect.w, rect.h) * 0.06;
    const box = {
      x: rect.x + PAD,
      y: rect.y + PAD,
      w: rect.w - PAD * 2,
      h: rect.h - PAD * 2,
    };
    cropRef.current = box;
    setCrop({ ...box });
  }, [getImageRect]);

  useEffect(() => { initCrop(); }, [initCrop]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const makePanResponder = useCallback(
    (handle: Handle) => {
      const rect = getImageRect();
      const bounds = rect ?? { x: 0, y: 0, w: container.w, h: container.h };
      const start = { px: 0, py: 0, snap: { x: 0, y: 0, w: 0, h: 0 } };

      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_, gs) => {
          start.px = gs.x0 - containerOffset.current.x;
          start.py = gs.y0 - containerOffset.current.y;
          start.snap = { ...cropRef.current };
        },
        onPanResponderMove: (_, gs) => {
          const cx = gs.moveX - containerOffset.current.x;
          const cy = gs.moveY - containerOffset.current.y;
          const dx = cx - start.px;
          const dy = cy - start.py;
          const s = start.snap;

          const minX = bounds.x;
          const minY = bounds.y;
          const maxX = bounds.x + bounds.w;
          const maxY = bounds.y + bounds.h;

          let { x, y, w, h } = s;

          if (handle === 'body') {
            x = clamp(s.x + dx, minX, maxX - w);
            y = clamp(s.y + dy, minY, maxY - h);
          } else if (handle === 'tl') {
            const nx = clamp(s.x + dx, minX, s.x + s.w - MIN_CROP_PX);
            const ny = clamp(s.y + dy, minY, s.y + s.h - MIN_CROP_PX);
            w = s.w + (s.x - nx);
            h = s.h + (s.y - ny);
            x = nx; y = ny;
          } else if (handle === 'tr') {
            const ny = clamp(s.y + dy, minY, s.y + s.h - MIN_CROP_PX);
            w = clamp(s.w + dx, MIN_CROP_PX, maxX - s.x);
            h = s.h + (s.y - ny);
            y = ny;
          } else if (handle === 'bl') {
            const nx = clamp(s.x + dx, minX, s.x + s.w - MIN_CROP_PX);
            w = s.w + (s.x - nx);
            h = clamp(s.h + dy, MIN_CROP_PX, maxY - s.y);
            x = nx;
          } else if (handle === 'br') {
            w = clamp(s.w + dx, MIN_CROP_PX, maxX - s.x);
            h = clamp(s.h + dy, MIN_CROP_PX, maxY - s.y);
          }

          cropRef.current = { x, y, w, h };
          setCrop({ x, y, w, h });
        },
      });
    },
    [container, getImageRect]
  );

  const responders = useRef<Record<Handle, ReturnType<typeof PanResponder.create> | null>>({
    tl: null, tr: null, bl: null, br: null, body: null,
  });

  if (container.w > 0 && imgPixels.w > 0 && !respondersReady.current) {
    respondersReady.current = true;
    (['tl', 'tr', 'bl', 'br', 'body'] as Handle[]).forEach((h) => {
      responders.current[h] = makePanResponder(h);
    });
  }

  const handleConfirm = () => {
    const rect = getImageRect();
    if (!rect) return;

    const originX = Math.round((crop.x - rect.x) / rect.scale);
    const originY = Math.round((crop.y - rect.y) / rect.scale);
    const width   = Math.round(crop.w / rect.scale);
    const height  = Math.round(crop.h / rect.scale);

    const safeOriginX = clamp(originX, 0, imgPixels.w - 1);
    const safeOriginY = clamp(originY, 0, imgPixels.h - 1);
    const safeWidth   = clamp(width,  1, imgPixels.w - safeOriginX);
    const safeHeight  = clamp(height, 1, imgPixels.h - safeOriginY);

    onConfirm({ originX: safeOriginX, originY: safeOriginY, width: safeWidth, height: safeHeight });
  };

  const isReady = respondersReady.current && crop.w > 0;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text
          style={styles.headerTitle}
          accessibilityRole="header">
          Adjust Crop
        </Text>
        <Text style={styles.headerSub}>Drag corners or box to select region</Text>
      </View>

      {/* Image + overlay */}
      <View
        ref={containerRef}
        style={styles.imageWrapper}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setTimeout(() => {
            containerRef.current?.measure((_fx, _fy, _w, _h, pageX, pageY) => {
              containerOffset.current = { x: pageX, y: pageY };
            });
          }, 50);
          if (width !== container.w || height !== container.h) {
            respondersReady.current = false;
            initialized.current = false;
            setContainer({ w: width, h: height });
          }
        }}>
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="contain"
        />

        {isReady && (() => {
          const r = getImageRect();
          const { x, y, w, h } = crop;
          return (
            <>
              {/* Dark overlay surrounding crop box */}
              <View pointerEvents="none" style={[styles.dim, { top: 0, left: 0, right: 0, height: y }]} />
              <View pointerEvents="none" style={[styles.dim, { top: y + h, left: 0, right: 0, bottom: 0 }]} />
              <View pointerEvents="none" style={[styles.dim, { top: y, left: 0, width: x, height: h }]} />
              <View pointerEvents="none" style={[styles.dim, { top: y, left: x + w, right: 0, height: h }]} />

              {/* Crop border + rule-of-thirds grid (body drag) */}
              {responders.current.body && (
                <View
                  {...responders.current.body.panHandlers}
                  style={[styles.cropBox, { left: x, top: y, width: w, height: h }]}>
                  <View style={[styles.grid, styles.gV1]} />
                  <View style={[styles.grid, styles.gV2]} />
                  <View style={[styles.grid, styles.gH1]} />
                  <View style={[styles.grid, styles.gH2]} />
                </View>
              )}

              {/* Corner handles */}
              {(['tl', 'tr', 'bl', 'br'] as Handle[]).map((hk) => {
                const hx = hk.endsWith('r') ? x + w : x;
                const hy = hk.startsWith('b') ? y + h : y;
                const pr = responders.current[hk];
                if (!pr) return null;
                return (
                  <View
                    key={hk}
                    {...pr.panHandlers}
                    style={[styles.handle, { left: hx - HANDLE_SIZE / 2, top: hy - HANDLE_SIZE / 2 }]}>
                    <View style={[styles.corner, styles[`corner_${hk}` as keyof typeof styles] as object]} />
                  </View>
                );
              })}

              {/* Pixel dimensions hint */}
              {r && (
                <View pointerEvents="none" style={[styles.dimHint, { left: x, top: y + h + 8, width: w }]}>
                  <Text style={styles.dimHintText}>
                    {Math.round(crop.w / r.scale)} × {Math.round(crop.h / r.scale)} px
                  </Text>
                </View>
              )}
            </>
          );
        })()}

        {!isReady && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onCancel}
          activeOpacity={0.75}
          accessibilityLabel="Retake photo"
          accessibilityRole="button">
          <Text style={styles.cancelText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, !isReady && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          activeOpacity={0.8}
          disabled={!isReady}
          accessibilityLabel="Scan the selected region"
          accessibilityRole="button">
          <Text style={styles.confirmText}>Scan This Region</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const CORNER_SZ = 16;
const BORDER = 3.5;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0d' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 4 },
  imageWrapper: {
    flex: 1,
    margin: 12,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Palette.honey,
  },
  grid: { position: 'absolute', backgroundColor: `${Palette.honey}40` },
  gV1: { left: '33.3%', top: 0, bottom: 0, width: 1 },
  gV2: { left: '66.6%', top: 0, bottom: 0, width: 1 },
  gH1: { top: '33.3%', left: 0, right: 0, height: 1 },
  gH2: { top: '66.6%', left: 0, right: 0, height: 1 },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  corner: { width: CORNER_SZ, height: CORNER_SZ, borderColor: Palette.honey, borderWidth: BORDER },
  corner_tl: { borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  corner_tr: { borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  corner_bl: { borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  corner_br: { borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  dimHint: { position: 'absolute', alignItems: 'center' },
  dimHintText: {
    color: Palette.honeyMuted,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 15 },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    minHeight: 54,
    justifyContent: 'center',
  },
  cancelText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '700' },
  confirmBtn: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    backgroundColor: Palette.honey,
    minHeight: 54,
    justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
