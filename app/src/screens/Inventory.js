// Tool inventory screen (#5, #8). Lets the user maintain a list of tools/materials they own
// so the AI analyzer can deduct them from shopping lists.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { getToolInventory, addToInventory, removeFromInventory } from '../utils/storage';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function Inventory({ navigation }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

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
    Alert.alert(t('inventory_remove_title'), t('inventory_remove_msg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('remove'), style: 'destructive', onPress: async () => { await removeFromInventory(id); load(); } },
    ]);
  };

  const scanBarcode = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert(t('permission_denied'), t('inventory_camera_denied_msg'));
        return;
      }
    }
    setScannerVisible(true);
  };

  const onBarcodeScanned = ({ data, format }) => {
    setScannerVisible(false);
    Alert.prompt
      ? Alert.prompt(
          t('inventory_add_scanned_title'),
          t('inventory_add_scanned_msg').replace('{format}', format).replace('{data}', data),
          async (name) => {
            if (name && name.trim()) {
              await addToInventory({ name: name.trim(), barcode: data });
              load();
            }
          }
        )
      : (async () => {
          await addToInventory({ name: data, barcode: data });
          load();
          Alert.alert(t('inventory_added_title'), t('inventory_added_msg').replace('{data}', data));
        })();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('inventory_title')}</Text>
        <Text style={styles.subtitle}>{t('inventory_subtitle')}</Text>
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder={t('inventory_add_placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          accessibilityLabel={t('inventory_add_a11y')}
          accessibilityRole="text"
        />
        <TouchableOpacity style={styles.addBtn} onPress={add} accessibilityLabel={t('inventory_add_btn_a11y')} accessibilityRole="button">
          <Icon name="add" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.scanBtn} onPress={scanBarcode} accessibilityLabel={t('inventory_scan_btn_a11y')} accessibilityRole="button">
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
            <Text style={styles.emptyText}>{t('inventory_empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Icon name="checkmark-circle" size={22} color={theme.colors.success} />
            <Text style={styles.rowText}>{item.name}</Text>
            <TouchableOpacity onPress={() => remove(item.id)} style={styles.removeBtn} accessibilityLabel={t('inventory_remove_item_a11y').replace('{name}', item.name)} accessibilityRole="button">
              <Icon name="trash-outline" size={20} color={theme.colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      />
      <BarcodeScannerModal
        visible={scannerVisible}
        onScanned={onBarcodeScanned}
        onClose={() => setScannerVisible(false)}
      />
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
});
