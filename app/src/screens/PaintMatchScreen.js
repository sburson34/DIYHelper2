import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { matchPaintColor } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function PaintMatchScreen({ navigation, route }) {
  const { t } = useTranslation();
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
        Alert.alert(t('paint_match_fail_title'), e.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [base64Image]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{t('paint_match_title')}</Text>
        <Text style={styles.subtitle}>{t('paint_match_subtitle')}</Text>

        {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} accessibilityLabel="Captured photo" /> : null}

        {loading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={{ marginTop: 10, color: theme.colors.textSecondary }}>{t('paint_match_analyzing')}</Text>
          </View>
        ) : result ? (
          <View>
            <View style={styles.dominantRow}>
              <View style={[styles.swatch, { backgroundColor: result.dominantHex }]} accessibilityLabel={`Dominant color ${result.dominantHex}`} />
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.dominantLabel}>{t('paint_match_dominant')}</Text>
                <Text style={styles.dominantHex}>{result.dominantHex}</Text>
              </View>
            </View>

            <Text style={styles.matchesTitle} accessibilityRole="header">{t('paint_match_nearest')}</Text>
            {(result.matches || []).map((m, i) => (
              <View key={i} style={styles.matchCard} accessibilityLabel={`${m.brand} ${m.name}, color code ${m.code}`}>
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
              {result.source === 'bundled-palette' ? t('paint_match_source_bundled') : t('paint_match_source_brand')}
            </Text>
          </View>
        ) : (
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
            {t('paint_match_empty')}
          </Text>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <Icon name="arrow-back" size={18} color="#fff" />
          <Text style={styles.buttonText}>{t('back')}</Text>
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
