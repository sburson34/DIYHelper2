// Aggregated shopping list across all active honey-do projects (#6, #7).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { getHoneyDoList, getShoppingBought, setShoppingBought, getToolInventory, findInventoryByBarcode } from '../utils/storage';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function ShoppingList({ navigation }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [bought, setBought] = useState({});
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const load = async () => {
    const projects = await getHoneyDoList();
    const inventory = (await getToolInventory()).map(i => i.name.toLowerCase());
    const boughtMap = await getShoppingBought();
    const map = new Map();
    for (const p of projects) {
      const links = Array.isArray(p.shopping_links) ? p.shopping_links : [];
      for (const sl of links) {
        const name = typeof sl === 'string' ? sl : sl.item;
        if (!name) continue;
        if (inventory.some(o => name.toLowerCase().includes(o))) continue; // skip owned
        const key = name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            key, name,
            amazon: typeof sl === 'object' ? sl.amazon_url : null,
            homedepot: typeof sl === 'object' ? sl.homedepot_url : null,
            projects: [p.title],
          });
        } else {
          map.get(key).projects.push(p.title);
        }
      }
    }
    setItems(Array.from(map.values()));
    setBought(boughtMap);
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  const toggle = async (key) => {
    const next = !bought[key];
    setBought({ ...bought, [key]: next });
    await setShoppingBought(key, next);
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert(t('permission_denied'), t('inventory_camera_denied_msg'));
        return;
      }
    }
    setScannerVisible(true);
  };

  const onBarcodeScanCheckOff = async ({ data }) => {
    setScannerVisible(false);
    // Try to match barcode against inventory items, then check off matching shopping items
    const inventoryItem = await findInventoryByBarcode(data);
    if (inventoryItem) {
      const key = inventoryItem.name.toLowerCase();
      const match = items.find(i => i.key === key || i.name.toLowerCase().includes(key));
      if (match && !bought[match.key]) {
        setBought({ ...bought, [match.key]: true });
        await setShoppingBought(match.key, true);
        Alert.alert(t('shopping_checked_title'), t('shopping_checked_barcode_msg').replace('{name}', match.name));
        return;
      }
    }
    // Fuzzy match: check if barcode data matches any item name
    const fuzzy = items.find(i => !bought[i.key] && (i.name.toLowerCase().includes(data.toLowerCase()) || data.toLowerCase().includes(i.name.toLowerCase())));
    if (fuzzy) {
      setBought({ ...bought, [fuzzy.key]: true });
      await setShoppingBought(fuzzy.key, true);
      Alert.alert(t('shopping_checked_title'), t('shopping_checked_msg').replace('{name}', fuzzy.name));
      return;
    }
    Alert.alert(t('shopping_no_match_title'), t('shopping_no_match_msg').replace('{data}', data));
  };

  const remaining = items.filter(i => !bought[i.key]).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.title}>{t('shopping_title')}</Text>
          <TouchableOpacity onPress={openScanner} style={styles.scanBtn} accessibilityLabel={t('shopping_scan_btn')} accessibilityRole="button">
            <Icon name="barcode-outline" size={20} color={theme.colors.secondary} />
            <Text style={styles.scanBtnText}>{t('shopping_scan_btn')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          {remaining === 1
            ? t('shopping_remaining_one')
            : t('shopping_remaining_many').replace('{n}', remaining)}
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="cart-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('shopping_empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, bought[item.key] && styles.rowDone]}>
            <TouchableOpacity
              onPress={() => toggle(item.key)}
              style={styles.checkBtn}
              accessibilityLabel={t('shopping_check_a11y')
                .replace('{name}', item.name)
                .replace('{status}', bought[item.key] ? t('shopping_status_purchased') : t('shopping_status_not_purchased'))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!bought[item.key] }}
            >
              <Icon
                name={bought[item.key] ? 'checkmark-circle' : 'ellipse-outline'}
                size={26}
                color={bought[item.key] ? theme.colors.success : theme.colors.textSecondary}
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, bought[item.key] && styles.itemNameDone]}>{item.name}</Text>
              <Text style={styles.itemMeta}>{t('shopping_for')}: {item.projects.join(', ')}</Text>
            </View>
            {item.amazon && (
              <TouchableOpacity onPress={() => Linking.openURL(item.amazon)} style={styles.linkBtn}>
                <Icon name="cart" size={18} color={theme.colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      />
      <BarcodeScannerModal
        visible={scannerVisible}
        onScanned={onBarcodeScanCheckOff}
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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: theme.colors.surface, borderRadius: theme.roundness.medium,
    marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
  },
  rowDone: { opacity: 0.55 },
  checkBtn: { padding: 2 },
  itemName: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  itemNameDone: { textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  linkBtn: { padding: 8 },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.roundness.medium,
  },
  scanBtnText: { fontSize: 13, fontWeight: '600', color: theme.colors.secondary },
  empty: { alignItems: 'center', marginTop: 60, padding: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
});
