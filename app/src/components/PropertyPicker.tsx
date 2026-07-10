import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Alert } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { listMyProperties, createMyProperty, CustomerProperty } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

type Props = {
  selectedId: number | null;
  onSelect: (property: CustomerProperty | null) => void;
};

// Property chips + inline "add property" modal for multi-property customers
// (property managers, landlords). Used by BookingScreen and EquipmentScreen.
// Selecting a property hands the full record up so callers can reuse its
// address on the job.
export default function PropertyPicker({ selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const [properties, setProperties] = useState<CustomerProperty[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listMyProperties();
      setProperties(Array.isArray(list) ? list : []);
    } catch {
      // Offline / backend older than this feature — picker just shows "add".
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const created = await createMyProperty({ label: label.trim(), address: address.trim() || null });
      setProperties((p) => [...p, created]);
      onSelect(created);
      setAdding(false);
      setLabel('');
      setAddress('');
    } catch (e: any) {
      Alert.alert(t('booking_failed_title'), e.message || '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>{t('booking_which_property')}</Text>
      <View style={styles.chips}>
        {properties.map((p) => {
          const active = selectedId === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect(active ? null : p)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={[styles.chip, styles.addChip]} onPress={() => setAdding(true)} accessibilityRole="button">
          <Icon name="add" size={16} color={theme.colors.primary} />
          <Text style={styles.addChipText}>{t('property_add')}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('property_add')}</Text>
            <TextInput
              style={styles.field}
              placeholder={t('property_label')}
              placeholderTextColor={theme.colors.textSecondary}
              value={label}
              onChangeText={setLabel}
              testID="property-label-input"
            />
            <TextInput
              style={styles.field}
              placeholder={t('property_address')}
              placeholderTextColor={theme.colors.textSecondary}
              value={address}
              onChangeText={setAddress}
              testID="property-address-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAdding(false)} accessibilityRole="button">
                <Text style={styles.cancelText}>{t('common_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, (!label.trim() || saving) && styles.saveBtnDisabled]}
                onPress={save}
                disabled={!label.trim() || saving}
                accessibilityRole="button"
              >
                <Text style={styles.saveText}>{t('property_save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '800', color: theme.colors.textSecondary, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 100,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  addChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderStyle: 'dashed', borderColor: theme.colors.primary + '60' },
  addChipText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: '#00000088', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: theme.colors.surface, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text, marginBottom: 14 },
  field: {
    backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 12, color: theme.colors.text, marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: theme.colors.textSecondary, fontWeight: '700' },
  saveBtn: { backgroundColor: theme.colors.primary, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontWeight: '800' },
});
