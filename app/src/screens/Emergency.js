// Emergency mode (#16). Big red button with shutoff instructions and one-tap call.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function Emergency() {
  const { t } = useTranslation();

  const SCENARIOS = [
    {
      id: 'water',
      label: t('emergency_water_label'),
      icon: 'water',
      color: '#0EA5E9',
      instructions: [
        t('emergency_water_1'),
        t('emergency_water_2'),
        t('emergency_water_3'),
        t('emergency_water_4'),
      ],
      callType: 'plumber near me',
      buttonLabel: t('emergency_find_plumber'),
    },
    {
      id: 'electric',
      label: t('emergency_electric_label'),
      icon: 'flash',
      color: '#F59E0B',
      instructions: [
        t('emergency_electric_1'),
        t('emergency_electric_2'),
        t('emergency_electric_3'),
        t('emergency_electric_4'),
      ],
      callType: 'electrician near me',
      buttonLabel: t('emergency_find_electrician'),
    },
    {
      id: 'gas',
      label: t('emergency_gas_label'),
      icon: 'cloud',
      color: '#A855F7',
      instructions: [
        t('emergency_gas_1'),
        t('emergency_gas_2'),
        t('emergency_gas_3'),
        t('emergency_gas_4'),
      ],
      callType: '911',
      buttonLabel: t('emergency_call_911'),
    },
    {
      id: 'fire',
      label: t('emergency_fire_label'),
      icon: 'flame',
      color: '#DC2626',
      instructions: [
        t('emergency_fire_1'),
        t('emergency_fire_2'),
        t('emergency_fire_3'),
      ],
      callType: '911',
      buttonLabel: t('emergency_call_911'),
    },
  ];

  const callPro = (callType) => {
    if (callType === '911') {
      Linking.openURL('tel:911').catch(() =>
        Alert.alert(t('emergency_cannot_call'), t('emergency_dial_manually'))
      );
    } else {
      const query = encodeURIComponent(callType);
      Linking.openURL(`https://www.google.com/maps/search/${query}`).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Icon name="warning" size={40} color="#fff" />
          <Text style={styles.bannerTitle}>{t('emergency_mode')}</Text>
          <Text style={styles.bannerSubtitle}>{t('emergency_life_danger')}</Text>
          <TouchableOpacity
            style={styles.call911}
            onPress={() => callPro('911')}
            accessibilityLabel={t('emergency_call_911')}
            accessibilityRole="button"
          >
            <Icon name="call" size={20} color="#fff" />
            <Text style={styles.call911Text}>{t('emergency_call_911')}</Text>
          </TouchableOpacity>
        </View>

        {SCENARIOS.map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={[styles.cardHeader, { backgroundColor: s.color + '15' }]}>
              <Icon name={s.icon} size={28} color={s.color} />
              <Text style={[styles.cardTitle, { color: s.color }]}>{s.label}</Text>
            </View>
            {s.instructions.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={styles.stepNum}>{i + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.callBtn, { backgroundColor: s.color }]}
              onPress={() => callPro(s.callType)}
              accessibilityLabel={s.buttonLabel}
              accessibilityHint={s.label}
              accessibilityRole="button"
            >
              <Icon name="call" size={18} color="#fff" />
              <Text style={styles.callBtnText}>{s.buttonLabel}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, paddingBottom: 40 },
  banner: {
    backgroundColor: '#DC2626', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 20,
  },
  bannerTitle: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 8 },
  bannerSubtitle: { fontSize: 14, color: '#FEE2E2', marginTop: 4, textAlign: 'center' },
  call911: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
    backgroundColor: '#7F1D1D', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100,
  },
  call911Text: { color: '#fff', fontWeight: '800', fontSize: 16 },
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 16, marginBottom: 16,
    borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  stepRow: { flexDirection: 'row', padding: 12, alignItems: 'flex-start', gap: 10 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.background,
    color: theme.colors.text, fontWeight: '800', textAlign: 'center', lineHeight: 24, fontSize: 12,
  },
  stepText: { flex: 1, color: theme.colors.text, lineHeight: 20 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 12, padding: 14, borderRadius: 12,
  },
  callBtnText: { color: '#fff', fontWeight: '700' },
});
