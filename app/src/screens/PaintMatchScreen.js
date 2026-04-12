import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { matchPaintColor } from '../api/backendClient';
import theme from '../theme';

export default function PaintMatchScreen({ navigation, route }) {
  const { base64Image, mimeType, previewUri } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      if (!base64Image) {
        setLoading(false);
        return;
      }
      try {
        const r = await matchPaintColor({ base64Image, mimeType: mimeType || 'image/jpeg' });
        setResult(r);
      } catch (e) {
        Alert.alert('Color match failed', e.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [base64Image]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Paint Color Match</Text>
        <Text style={styles.subtitle}>Closest named paint colors to what the camera saw.</Text>

        {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} /> : null}

        {loading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={{ marginTop: 10, color: theme.colors.textSecondary }}>Analyzing color…</Text>
          </View>
        ) : result ? (
          <View>
            <View style={styles.dominantRow}>
              <View style={[styles.swatch, { backgroundColor: result.dominantHex }]} />
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.dominantLabel}>Dominant color</Text>
                <Text style={styles.dominantHex}>{result.dominantHex}</Text>
              </View>
            </View>

            <Text style={styles.matchesTitle}>Nearest matches</Text>
            {(result.matches || []).map((m, i) => (
              <View key={i} style={styles.matchCard}>
                <View style={[styles.matchSwatch, { backgroundColor: m.hex }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchName}>{m.name}</Text>
                  <Text style={styles.matchMeta}>{m.brand} · {m.code} · {m.hex}</Text>
                </View>
                <View style={styles.deltaBadge}>
                  <Text style={styles.deltaText}>ΔE {m.deltaE}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.sourceNote}>
              Source: {result.source === 'bundled-palette' ? 'Bundled popular-color palette (no brand API configured)' : 'Brand API'}
            </Text>
          </View>
        ) : (
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
            No image was provided to analyze.
          </Text>
        )}

        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={18} color="#fff" />
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '900', color: theme.colors.text },
  subtitle: { color: theme.colors.textSecondary, marginTop: 6, marginBottom: 20 },
  preview: { width: '100%', height: 180, borderRadius: 12, marginBottom: 20 },
  dominantRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 20,
  },
  swatch: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  dominantLabel: { color: theme.colors.textSecondary, fontSize: 12, textTransform: 'uppercase', fontWeight: '700' },
  dominantHex: { color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  matchesTitle: { color: theme.colors.text, fontWeight: '800', fontSize: 18, marginBottom: 12 },
  matchCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 12, backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10,
  },
  matchSwatch: { width: 44, height: 44, borderRadius: 6, marginRight: 12, borderWidth: 1, borderColor: theme.colors.border },
  matchName: { color: theme.colors.text, fontWeight: '800', fontSize: 15 },
  matchMeta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  deltaBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    backgroundColor: theme.colors.primary + '20',
  },
  deltaText: { color: theme.colors.primary, fontSize: 11, fontWeight: '800' },
  sourceNote: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 14, fontStyle: 'italic' },
  button: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    marginTop: 30, backgroundColor: theme.colors.textSecondary,
    paddingVertical: 14, borderRadius: theme.roundness.full,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
