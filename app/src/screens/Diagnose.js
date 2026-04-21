// Diagnostic mode screen (#10). User describes a symptom; AI returns ranked possible causes.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { diagnoseProblem } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function Diagnose() {
  const { t, language } = useTranslation();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!description.trim()) {
      Alert.alert(t('diagnose_describe_title'), t('diagnose_describe_msg'));
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await diagnoseProblem({ description, media: [], language });
      setResult(r);
    } catch (e) {
      Alert.alert(t('diagnose_failed'), e.message);
    } finally {
      setLoading(false);
    }
  };

  const urgencyColor = (u) =>
    u === 'emergency' ? '#DC2626' : u === 'high' ? '#F59E0B' : u === 'medium' ? '#0EA5E9' : theme.colors.success;
  const likelihoodColor = (l) =>
    l === 'high' ? theme.colors.danger : l === 'medium' ? theme.colors.primary : theme.colors.textSecondary;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Icon name="search" size={36} color={theme.colors.secondary} />
          <Text style={styles.title}>{t('diagnose_title')}</Text>
          <Text style={styles.subtitle}>{t('diagnose_subtitle')}</Text>
        </View>
        <TextInput
          style={styles.input}
          multiline
          placeholder={t('diagnose_placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          accessibilityLabel={t('diagnose_title')}
        />
        <TouchableOpacity
          style={styles.runBtn}
          onPress={run}
          disabled={loading}
          accessibilityLabel={t('diagnose_button')}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="sparkles" size={18} color="#fff" />
              <Text style={styles.runBtnText}>{t('diagnose_button')}</Text>
            </>
          )}
        </TouchableOpacity>

        {result && (
          <View style={styles.results}>
            {result.urgency && (
              <View style={[styles.urgencyBadge, { backgroundColor: urgencyColor(result.urgency) + '20' }]}>
                <Icon name="warning" size={16} color={urgencyColor(result.urgency)} />
                <Text style={[styles.urgencyText, { color: urgencyColor(result.urgency) }]}>
                  {t('diagnose_urgency')}: {result.urgency.toUpperCase()}
                </Text>
              </View>
            )}
            {result.summary && <Text style={styles.summary}>{result.summary}</Text>}
            {(result.possible_causes || []).map((c, i) => (
              <View key={i} style={styles.causeCard}>
                <View style={styles.causeHeader}>
                  <Text style={styles.causeIssue}>{c.issue}</Text>
                  <View style={[styles.likelihoodPill, { backgroundColor: likelihoodColor(c.likelihood) + '25' }]}>
                    <Text style={[styles.likelihoodText, { color: likelihoodColor(c.likelihood) }]}>{c.likelihood}</Text>
                  </View>
                </View>
                {c.why && <Text style={styles.causeText}>{c.why}</Text>}
                {c.next_check && (
                  <View style={styles.nextCheck}>
                    <Icon name="arrow-forward-circle" size={16} color={theme.colors.primary} />
                    <Text style={styles.nextCheckText}>{t('diagnose_next')}: {c.next_check}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '800', color: theme.colors.text, marginTop: 8 },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4, textAlign: 'center' },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 14, minHeight: 100, color: theme.colors.text,
    textAlignVertical: 'top',
  },
  runBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primary, padding: 16, borderRadius: 16, marginTop: 12,
  },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  results: { marginTop: 20 },
  urgencyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100,
  },
  urgencyText: { fontWeight: '800', fontSize: 12 },
  summary: { color: theme.colors.text, fontSize: 14, marginTop: 10, lineHeight: 20 },
  causeCard: {
    backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  causeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  causeIssue: { flex: 1, fontWeight: '700', color: theme.colors.text, fontSize: 15 },
  likelihoodPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  likelihoodText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  causeText: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  nextCheck: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  nextCheckText: { color: theme.colors.primary, fontSize: 13, fontWeight: '600', flex: 1 },
});
