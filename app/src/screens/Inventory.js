// Tool inventory screen (#5, #8). Lets the user maintain a list of tools/materials they own
// so the AI analyzer can deduct them from shopping lists.
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getToolInventory, addToInventory, removeFromInventory } from '../utils/storage';
import theme from '../theme';

export default function Inventory({ navigation }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannedRef = useRef(false); // debounce: barcodes fire rapidly

  const load = async () => setItems(await getToolInventory());

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await addToInventory({ name: trimmed });
    setText('');
    load();
  };

  const remove = (id) => {
    Alert.alert('Remove?', 'Remove this item from your inventory?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await removeFromInventory(id); load(); } },
    ]);
  };

  // Barcode scanner (#8). Uses expo-camera's built-in scanner — no extra package needed.
  const scanBarcode = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert('Permission denied', 'Camera permission is needed to scan barcodes.');
        return;
      }
    }
    scannedRef.current = false;
    setScannerVisible(true);
  };

  const onBarcodeScanned = ({ data, type }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScannerVisible(false);
    Alert.prompt
      ? Alert.prompt(
          'Add to inventory',
          `Scanned ${type}: ${data}\n\nWhat is this item called?`,
          async (name) => {
            if (name && name.trim()) {
              await addToInventory({ name: name.trim(), barcode: data });
              load();
            }
          }
        )
      : (async () => {
          // Android: Alert.prompt isn't available, so save with the barcode as the name.
          await addToInventory({ name: data, barcode: data });
          load();
          Alert.alert('Added', `Saved barcode ${data}. Tap it in the list to rename.`);
        })();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Tools & Materials</Text>
        <Text style={styles.subtitle}>Items you already own — the AI will skip these in shopping lists.</Text>
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="e.g. cordless drill, 1/2 in copper pipe"
          placeholderTextColor={theme.colors.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
        />
        <TouchableOpacity style={styles.addBtn} onPress={add}>
          <Icon name="add" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.scanBtn} onPress={scanBarcode}>
          <Icon name="barcode-outline" size={22} color={theme.colors.secondary} />
        </TouchableOpacity>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="construct-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>No tools added yet. Add a few and the AI will skip them in shopping lists.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Icon name="checkmark-circle" size={22} color={theme.colors.success} />
            <Text style={styles.rowText}>{item.name}</Text>
            <TouchableOpacity onPress={() => remove(item.id)} style={styles.removeBtn}>
              <Icon name="trash-outline" size={20} color={theme.colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      />
      <Modal visible={scannerVisible} animationType="slide">
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code39', 'code128', 'codabar', 'itf14'],
            }}
            onBarcodeScanned={scannerVisible ? onBarcodeScanned : undefined}
          >
            <View style={styles.scannerOverlay}>
              <Text style={styles.scannerHint}>Point at a barcode</Text>
              <View style={styles.scannerBox} />
              <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerVisible(false)}>
                <Icon name="close" size={28} color="#fff" />
                <Text style={styles.scannerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  input: {
    flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 12, color: theme.colors.text,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  scanBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: theme.colors.surface, borderRadius: theme.roundness.medium,
    marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
  },
  rowText: { flex: 1, color: theme.colors.text, fontSize: 15 },
  removeBtn: { padding: 6 },
  empty: { alignItems: 'center', marginTop: 60, padding: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerCamera: { flex: 1 },
  scannerOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  scannerHint: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 20, backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 8 },
  scannerBox: { width: 260, height: 160, borderWidth: 3, borderColor: '#FCA004', borderRadius: 12 },
  scannerClose: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 40,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100,
  },
  scannerCloseText: { color: '#fff', fontWeight: '700' },
});
