// Emergency mode (#16). Big red button with shutoff instructions and one-tap call.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';

const SCENARIOS = [
  {
    id: 'water',
    label: 'Active leak / burst pipe',
    icon: 'water',
    color: '#0EA5E9',
    instructions: [
      "Shut off your home's main water valve immediately.",
      'Open the lowest faucet to drain remaining pressure.',
      'Move valuables, electronics, and rugs away from water.',
      'Call a plumber.',
    ],
    callType: 'plumber near me',
  },
  {
    id: 'electric',
    label: 'Sparking outlet / shock hazard',
    icon: 'flash',
    color: '#F59E0B',
    instructions: [
      'Do NOT touch the affected outlet, switch, or appliance.',
      'Trip the breaker for that circuit at your panel.',
      'Once safe, unplug nearby devices.',
      'Call an electrician.',
    ],
    callType: 'electrician near me',
  },
  {
    id: 'gas',
    label: 'Gas smell',
    icon: 'cloud',
    color: '#A855F7',
    instructions: [
      'Leave the building immediately. Do not light a flame.',
      'Do NOT flip light switches or use phones inside.',
      'Once outside, call your gas utility and 911.',
      'Do not re-enter until cleared by professionals.',
    ],
    callType: '911',
  },
  {
    id: 'fire',
    label: 'Active fire',
    icon: 'flame',
    color: '#DC2626',
    instructions: [
      'Get out. Stay out. Call 911.',
      'Use stairs, never elevators.',
      'Crawl low under smoke.',
    ],
    callType: '911',
  },
];

export default function Emergency() {
  const callPro = (callType) => {
    if (callType === '911') {
      Linking.openURL('tel:911').catch(() =>
        Alert.alert('Cannot call', 'Dial 911 manually.')
      );
    } else {
      // Open a map search for nearest pro
      const query = encodeURIComponent(callType);
      Linking.openURL(`https://www.google.com/maps/search/${query}`).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Icon name="warning" size={40} color="#fff" />
          <Text style={styles.bannerTitle}>Emergency Mode</Text>
          <Text style={styles.bannerSubtitle}>If life is in danger, call 911 immediately.</Text>
          <TouchableOpacity style={styles.call911} onPress={() => callPro('911')}>
            <Icon name="call" size={20} color="#fff" />
            <Text style={styles.call911Text}>Call 911</Text>
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
            <TouchableOpacity style={[styles.callBtn, { backgroundColor: s.color }]} onPress={() => callPro(s.callType)}>
              <Icon name="call" size={18} color="#fff" />
              <Text style={styles.callBtnText}>
                {s.callType === '911' ? 'Call 911' : `Find a ${s.callType.replace(' near me', '')}`}
              </Text>
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
