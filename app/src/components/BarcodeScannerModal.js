// Reusable barcode scanner modal.
// Uses ML Kit via vision-camera when available, falls back to expo-camera CameraView.

import React, { useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import { useMlKitFeature } from '../mlkit/useMlKitFeature';
import { isBarcodeScannerAvailable, handleBarcodeScan } from '../mlkit/barcodeScanner';
import theme from '../theme';

let Camera;
try {
  Camera = require('react-native-vision-camera').Camera;
} catch {
  Camera = null;
}

export default function BarcodeScannerModal({ visible, onScanned, onClose }) {
  const { ready: mlkitReady } = useMlKitFeature('barcodeScanner');
  const useMLKit = mlkitReady && isBarcodeScannerAvailable() && Camera;
  const scannedRef = useRef(false);

  const handleScan = useCallback(({ data, format }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    onScanned({ data, format });
  }, [onScanned]);

  // Reset debounce when modal becomes visible
  React.useEffect(() => {
    if (visible) scannedRef.current = false;
  }, [visible]);

  // Expo-camera fallback handler
  const onExpoBarcodeScanned = useCallback(({ data, type }) => {
    handleScan({ data, format: type });
  }, [handleScan]);

  // ML Kit frame processor handler
  const onMLKitBarcodeScanned = useCallback((barcodes) => {
    handleBarcodeScan(barcodes, handleScan);
  }, [handleScan]);

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        {useMLKit ? (
          <Camera
            style={styles.camera}
            device="back"
            isActive={visible}
            codeScanner={{
              codeTypes: ['qr', 'ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-39', 'code-128'],
              onCodeScanned: onMLKitBarcodeScanned,
            }}
          />
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code39', 'code128', 'codabar', 'itf14'],
            }}
            onBarcodeScanned={visible ? onExpoBarcodeScanned : undefined}
          />
        )}
        <View style={styles.overlay}>
          <Text style={styles.hint}>Point at a barcode</Text>
          {useMLKit && (
            <Text style={styles.badge}>ML Kit</Text>
          )}
          <View style={styles.scanBox} />
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Icon name="close" size={28} color="#fff" />
            <Text style={styles.closeText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 8,
  },
  badge: {
    color: theme.colors.primary, fontSize: 11, fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, marginBottom: 8, overflow: 'hidden',
  },
  scanBox: {
    width: 260, height: 160, borderWidth: 3, borderColor: theme.colors.primary, borderRadius: 12,
  },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 40,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100,
  },
  closeText: { color: '#fff', fontWeight: '700' },
});
