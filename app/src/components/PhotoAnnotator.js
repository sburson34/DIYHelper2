// Full-screen photo annotation modal.
// Overlays DrawingCanvas on a photo for marking problem areas.

import React, { useState, useRef, useCallback } from 'react';
import { View, Image, Text, TouchableOpacity, StyleSheet, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import DrawingCanvas from './DrawingCanvas';
import { recognizeInk, isDigitalInkAvailable } from '../mlkit/digitalInk';
import { useMlKitFeature } from '../mlkit/useMlKitFeature';
import theme from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_HEIGHT = SCREEN_WIDTH * 1.33; // 4:3 aspect ratio

export default function PhotoAnnotator({ photoUri, onSave, onCancel }) {
  const [strokes, setStrokes] = useState([]);
  const [penColor, setPenColor] = useState('#FF3B30');
  const [penWidth, setPenWidth] = useState(3);
  const [recognizedText, setRecognizedText] = useState(null);
  const { ready: inkReady } = useMlKitFeature('digitalInk');
  const canvasRef = useRef(null);

  const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#FFFFFF'];

  const handleUndo = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
    setRecognizedText(null);
  }, []);

  const handleRecognize = useCallback(async () => {
    if (!strokes.length) return;
    const results = await recognizeInk(strokes);
    if (results.length > 0) {
      setRecognizedText(results.map(r => r.text).join(', '));
    } else {
      Alert.alert('No recognition', 'Could not recognize the drawing. Try drawing text or simple shapes.');
    }
  }, [strokes]);

  const handleSave = useCallback(() => {
    onSave({
      strokes,
      recognizedText,
      strokeCount: strokes.length,
    });
  }, [strokes, recognizedText, onSave]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Annotate Photo</Text>
        <TouchableOpacity onPress={handleSave} style={styles.headerBtn}>
          <Icon name="checkmark" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.canvasContainer}>
        <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="contain" />
        <DrawingCanvas
          width={SCREEN_WIDTH}
          height={CANVAS_HEIGHT}
          strokeColor={penColor}
          strokeWidth={penWidth}
          onStrokesChange={setStrokes}
        />
      </View>

      {recognizedText && (
        <View style={styles.recognizedBar}>
          <Icon name="text-outline" size={16} color={theme.colors.secondary} />
          <Text style={styles.recognizedText}>{recognizedText}</Text>
        </View>
      )}

      <View style={styles.toolbar}>
        <View style={styles.colorRow}>
          {COLORS.map(color => (
            <TouchableOpacity
              key={color}
              onPress={() => setPenColor(color)}
              style={[styles.colorDot, { backgroundColor: color }, penColor === color && styles.colorDotActive]}
            />
          ))}
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={() => setPenWidth(w => w === 3 ? 6 : 3)} style={styles.actionBtn}>
            <Icon name="ellipse" size={penWidth === 3 ? 12 : 20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleUndo} style={styles.actionBtn} disabled={strokes.length === 0}>
            <Icon name="arrow-undo" size={20} color={strokes.length ? '#fff' : '#666'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClear} style={styles.actionBtn} disabled={strokes.length === 0}>
            <Icon name="trash-outline" size={20} color={strokes.length ? '#fff' : '#666'} />
          </TouchableOpacity>
          {inkReady && isDigitalInkAvailable() && (
            <TouchableOpacity onPress={handleRecognize} style={styles.actionBtn} disabled={strokes.length === 0}>
              <Icon name="scan-outline" size={20} color={strokes.length ? theme.colors.primary : '#666'} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerBtn: { padding: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  canvasContainer: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#111',
  },
  photo: {
    width: SCREEN_WIDTH,
    height: CANVAS_HEIGHT,
    position: 'absolute',
  },
  recognizedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, backgroundColor: '#1A1A2E',
  },
  recognizedText: { color: '#fff', fontSize: 13 },
  toolbar: {
    flex: 1, justifyContent: 'flex-end', padding: 16, gap: 12,
  },
  colorRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 12,
  },
  colorDot: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent',
  },
  colorDotActive: {
    borderColor: '#fff', transform: [{ scale: 1.2 }],
  },
  actionRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 20,
  },
  actionBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#333',
    justifyContent: 'center', alignItems: 'center',
  },
});
