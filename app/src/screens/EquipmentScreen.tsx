// "My Equipment" (F4). The customer's home equipment (water heater, furnace,
// AC…) with per-asset service history. Assets attach to bookings so the
// company sees what they're working on; warranty dates feed the backend's
// maintenance-reminder sweep. Property chips appear for multi-property
// customers (property managers) and filter the list.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import {
  listMyAssets, createMyAsset, updateMyAsset, deleteMyAsset, getAssetHistory,
  CustomerAsset, CustomerAssetInput, CustomerProperty, AssetHistoryEntry,
} from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import { useBrandConfig } from '../config/brandConfig';
import PropertyPicker from '../components/PropertyPicker';
import JobStatusPill from '../components/JobStatusPill';
import { fmtDateTime } from '../utils/datetime';
import theme from '../theme';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { RootDrawerParamList } from '../navigation/types';

interface AssetFormState {
  id?: number;
  label: string;
  make: string;
  model: string;
  serial: string;
}

const EMPTY_FORM: AssetFormState = { label: '', make: '', model: '', serial: '' };

export default function EquipmentScreen({ navigation }: DrawerScreenProps<RootDrawerParamList, 'Equipment'>) {
  const { t } = useTranslation();
  const config = useBrandConfig();
  const [assets, setAssets] = useState<CustomerAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [property, setProperty] = useState<CustomerProperty | null>(null);
  const [form, setForm] = useState<AssetFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, AssetHistoryEntry[]>>({});

  const load = useCallback(async () => {
    try {
      const list = await listMyAssets();
      setAssets(Array.isArray(list) ? list : []);
    } catch {
      // Offline — keep whatever we had.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const toggleHistory = async (asset: CustomerAsset) => {
    if (expandedId === asset.id) { setExpandedId(null); return; }
    setExpandedId(asset.id);
    if (!history[asset.id]) {
      try {
        const h = await getAssetHistory(asset.id);
        setHistory((m) => ({ ...m, [asset.id]: Array.isArray(h) ? h : [] }));
      } catch {
        setHistory((m) => ({ ...m, [asset.id]: [] }));
      }
    }
  };

  const saveForm = async () => {
    if (!form || !form.label.trim()) return;
    setSaving(true);
    const input: CustomerAssetInput = {
      label: form.label.trim(),
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      serial: form.serial.trim() || null,
      propertyId: property?.id ?? null,
    };
    try {
      if (form.id) {
        const updated = await updateMyAsset(form.id, input);
        setAssets((a) => a.map((x) => (x.id === form.id ? updated : x)));
      } else {
        const created = await createMyAsset(input);
        setAssets((a) => [...a, created]);
      }
      setForm(null);
    } catch (e: any) {
      Alert.alert(t('booking_failed_title'), e.message || '');
    } finally {
      setSaving(false);
    }
  };

  const removeAsset = (asset: CustomerAsset) => {
    Alert.alert(t('asset_delete'), t('asset_delete_confirm'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('asset_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMyAsset(asset.id);
            setAssets((a) => a.filter((x) => x.id !== asset.id));
          } catch (e: any) {
            Alert.alert(t('booking_failed_title'), e.message || '');
          }
        },
      },
    ]);
  };

  const visibleAssets = property ? assets.filter((a) => a.propertyId === property.id) : assets;

  const renderAsset = ({ item }: { item: CustomerAsset }) => {
    const expanded = expandedId === item.id;
    const h = history[item.id];
    const detailBits = [item.make, item.model, item.serial ? `#${item.serial}` : null].filter(Boolean).join(' · ');
    return (
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleHistory(item)} accessibilityRole="button">
          <View style={styles.iconWrap}>
            <Icon name="cube-outline" size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.assetLabel}>{item.label}</Text>
            {detailBits ? <Text style={styles.assetDetail}>{detailBits}</Text> : null}
            {item.warrantyExpiresAt ? (
              <Text style={styles.warranty}>
                {t('asset_warranty_until')}: {fmtDateTime(item.warrantyExpiresAt) || item.warrantyExpiresAt.slice(0, 10)}
              </Text>
            ) : null}
          </View>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textSecondary} />
        </TouchableOpacity>

        {expanded ? (
          <View style={styles.historyWrap}>
            <Text style={styles.historyTitle}>{t('equipment_history')}</Text>
            {!h ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : h.length === 0 ? (
              <Text style={styles.historyEmpty}>{t('equipment_history_empty')}</Text>
            ) : (
              h.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyJob} numberOfLines={1}>{entry.projectTitle || entry.serviceType || '—'}</Text>
                    {entry.completedAt ? <Text style={styles.historyWhen}>{fmtDateTime(entry.completedAt)}</Text> : null}
                  </View>
                  <JobStatusPill status={entry.status} />
                </View>
              ))
            )}
            <View style={styles.rowActions}>
              {config.features.booking ? (
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={() => navigation.navigate('Book', { prefillTitle: item.label, serviceType: undefined, assetId: item.id })}
                  accessibilityRole="button"
                >
                  <Icon name="calendar-outline" size={15} color={theme.colors.primary} />
                  <Text style={styles.smallBtnText}>{t('myjobs_book_now')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={() => setForm({ id: item.id, label: item.label, make: item.make || '', model: item.model || '', serial: item.serial || '' })}
                accessibilityRole="button"
              >
                <Icon name="pencil" size={15} color={theme.colors.primary} />
                <Text style={styles.smallBtnText}>{t('common_edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => removeAsset(item)} accessibilityRole="button">
                <Icon name="trash-outline" size={15} color={theme.colors.danger} />
                <Text style={[styles.smallBtnText, { color: theme.colors.danger }]}>{t('asset_delete')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={visibleAssets}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListHeaderComponent={
          config.features.multiProperty ? (
            <PropertyPicker selectedId={property?.id ?? null} onSelect={setProperty} />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="cube-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('equipment_empty')}</Text>
          </View>
        }
        renderItem={renderAsset}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setForm({ ...EMPTY_FORM })}
        accessibilityRole="button"
        accessibilityLabel={t('equipment_add')}
        testID="equipment-add-button"
      >
        <Icon name="add" size={26} color="#fff" />
        <Text style={styles.fabText}>{t('equipment_add')}</Text>
      </TouchableOpacity>

      <Modal visible={!!form} transparent animationType="fade" onRequestClose={() => setForm(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{form?.id ? t('common_edit') : t('equipment_add')}</Text>
            <Text style={styles.fieldLabel}>{t('asset_label')}</Text>
            <TextInput
              style={styles.field}
              placeholder={t('asset_label_placeholder')}
              placeholderTextColor={theme.colors.textSecondary}
              value={form?.label || ''}
              onChangeText={(v) => setForm((f) => (f ? { ...f, label: v } : f))}
              testID="asset-label-input"
            />
            <TextInput style={styles.field} placeholder={t('asset_make')} placeholderTextColor={theme.colors.textSecondary} value={form?.make || ''} onChangeText={(v) => setForm((f) => (f ? { ...f, make: v } : f))} />
            <TextInput style={styles.field} placeholder={t('asset_model')} placeholderTextColor={theme.colors.textSecondary} value={form?.model || ''} onChangeText={(v) => setForm((f) => (f ? { ...f, model: v } : f))} />
            <TextInput style={styles.field} placeholder={t('asset_serial')} placeholderTextColor={theme.colors.textSecondary} value={form?.serial || ''} onChangeText={(v) => setForm((f) => (f ? { ...f, serial: v } : f))} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setForm(null)} accessibilityRole="button">
                <Text style={styles.cancelText}>{t('common_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, (!form?.label.trim() || saving) && styles.saveBtnDisabled]}
                onPress={saveForm}
                disabled={!form?.label.trim() || saving}
                accessibilityRole="button"
                testID="asset-save-button"
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t('asset_save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 110 },
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12, marginTop: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  assetLabel: { fontWeight: '800', fontSize: 15, color: theme.colors.text },
  assetDetail: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  warranty: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  historyWrap: { marginTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10 },
  historyTitle: { fontSize: 12, fontWeight: '800', color: theme.colors.textSecondary, textTransform: 'uppercase', marginBottom: 8 },
  historyEmpty: { color: theme.colors.textSecondary, fontSize: 13 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  historyJob: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  historyWhen: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: theme.colors.primary + '12',
  },
  smallBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', marginTop: 60, padding: 30 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.primary, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 100,
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: '#00000088', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: theme.colors.surface, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text, marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '800', color: theme.colors.textSecondary, textTransform: 'uppercase', marginBottom: 6 },
  field: {
    backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 12, color: theme.colors.text, marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: theme.colors.textSecondary, fontWeight: '700' },
  saveBtn: { backgroundColor: theme.colors.primary, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, minWidth: 120, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontWeight: '800' },
});
