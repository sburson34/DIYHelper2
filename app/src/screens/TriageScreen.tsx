// Pro-services triage (Wave 1). The customer snaps/describes a problem and the
// AI returns likely causes + an urgency read, then funnels them to the right
// action: call now / go to Emergency for urgent issues, or book a visit — which
// hands the triage summary straight into the booking screen as a warm lead.
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { diagnoseProblem, AiConsentRequiredError, DiagnoseResult } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import { useBrandConfig } from '../config/brandConfig';
import { pickPhoto, PickedPhoto } from '../utils/pickPhoto';
import theme from '../theme';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { RootDrawerParamList } from '../navigation/types';

const urgencyColor = (u?: string) =>
  u === 'emergency' ? '#DC2626' : u === 'high' ? '#F59E0B' : u === 'medium' ? '#0EA5E9' : theme.colors.success;
const likelihoodColor = (l?: string) =>
  l === 'high' ? theme.colors.danger : l === 'medium' ? theme.colors.primary : theme.colors.textSecondary;

export default function TriageScreen({ navigation }: DrawerScreenProps<RootDrawerParamList, 'Triage'>) {
  const { t, language } = useTranslation();
  const config = useBrandConfig();
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);

  const addPhoto = async (source: 'camera' | 'library') => {
    const p = await pickPhoto(source);
    if (p) setPhoto(p);
  };

  const run = async () => {
    if (!description.trim() && !photo) {
      Alert.alert(t('triage_need_input_title'), t('triage_need_input_msg'));
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const media = photo ? [{ base64: photo.base64, mimeType: photo.mimeType }] : [];
      const r = await diagnoseProblem({ description, media, language });
      setResult(r);
    } catch (e: any) {
      if (e instanceof AiConsentRequiredError) {
        Alert.alert(t('ai_disabled_title'), e.message);
      } else {
        Alert.alert(t('triage_failed'), e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Hand everything we learned to the booking screen so the customer doesn't
  // retype it — service type stays unset (they pick it there).
  const bookThis = () => {
    const title = result?.summary
      ? result.summary.slice(0, 60)
      : (description.trim().slice(0, 60) || t('triage_default_title'));
    navigation.navigate('Book', {
      prefillTitle: title,
      prefillDescription: description,
      imageBase64: photo?.base64,
      projectData: result || undefined,
    });
  };

  const callNow = () => {
    if (config.phone) Linking.openURL(`tel:${config.phone}`).catch(() => {});
  };

  const urgent = result && (result.urgency === 'emergency' || result.urgency === 'high' || result.call_pro_immediately);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Icon name="camera" size={36} color={theme.colors.primary} />
          <Text style={styles.title}>{t('triage_title')}</Text>
          <Text style={styles.subtitle}>{t('triage_subtitle')}</Text>
        </View>

        {photo ? (
          <View style={styles.photoWrap}>
            <Image source={{ uri: photo.uri }} style={styles.photo} />
            <TouchableOpacity style={styles.photoRemove} onPress={() => setPhoto(null)} accessibilityLabel={t('triage_remove_photo')}>
              <Icon name="close-circle" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => addPhoto('camera')} accessibilityRole="button" accessibilityLabel={t('triage_take_photo')}>
              <Icon name="camera-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.photoBtnText}>{t('triage_take_photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={() => addPhoto('library')} accessibilityRole="button" accessibilityLabel={t('triage_choose_photo')}>
              <Icon name="image-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.photoBtnText}>{t('triage_choose_photo')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TextInput
          style={styles.input}
          multiline
          placeholder={t('triage_placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          accessibilityLabel={t('triage_title')}
          testID="triage-description-input"
        />

        <TouchableOpacity
          style={styles.runBtn}
          onPress={run}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={t('triage_button')}
          accessibilityState={{ disabled: loading, busy: loading }}
          testID="triage-run-button"
        >
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="sparkles" size={18} color="#fff" />
              <Text style={styles.runBtnText}>{t('triage_button')}</Text>
            </>
          )}
        </TouchableOpacity>

        {result && (
          <View style={styles.results}>
            {result.urgency && (
              <View style={[styles.urgencyBadge, { backgroundColor: urgencyColor(result.urgency) + '20' }]}>
                <Icon name="warning" size={16} color={urgencyColor(result.urgency)} />
                <Text style={[styles.urgencyText, { color: urgencyColor(result.urgency) }]}>
                  {t('triage_urgency')}: {String(result.urgency).toUpperCase()}
                </Text>
              </View>
            )}
            {result.summary ? <Text style={styles.summary}>{result.summary}</Text> : null}
            {(result.possible_causes || []).map((c, i) => (
              <View key={i} style={styles.causeCard}>
                <View style={styles.causeHeader}>
                  <Text style={styles.causeIssue}>{c.issue}</Text>
                  {c.likelihood ? (
                    <View style={[styles.pill, { backgroundColor: likelihoodColor(c.likelihood) + '25' }]}>
                      <Text style={[styles.pillText, { color: likelihoodColor(c.likelihood) }]}>{c.likelihood}</Text>
                    </View>
                  ) : null}
                </View>
                {c.why ? <Text style={styles.causeText}>{c.why}</Text> : null}
              </View>
            ))}

            {/* Conversion actions — the point of triage for a pro-services app. */}
            <View style={styles.actions}>
              {urgent && config.phone ? (
                <TouchableOpacity style={[styles.actionBtn, styles.callBtn]} onPress={callNow} accessibilityRole="button" accessibilityLabel={t('triage_call_now')}>
                  <Icon name="call" size={18} color="#fff" />
                  <Text style={styles.actionText}>{t('triage_call_now')}</Text>
                </TouchableOpacity>
              ) : null}
              {urgent ? (
                <TouchableOpacity style={[styles.actionBtn, styles.emergencyBtn]} onPress={() => navigation.navigate('Emergency')} accessibilityRole="button" accessibilityLabel={t('triage_emergency')}>
                  <Icon name="alert-circle" size={18} color="#fff" />
                  <Text style={styles.actionText}>{t('triage_emergency')}</Text>
                </TouchableOpacity>
              ) : null}
              {config.features.booking ? (
                <TouchableOpacity style={[styles.actionBtn, styles.bookBtn]} onPress={bookThis} accessibilityRole="button" accessibilityLabel={t('triage_book')}>
                  <Icon name="calendar" size={18} color="#fff" />
                  <Text style={styles.actionText}>{t('triage_book')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
  photoButtons: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primary + '12', paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.primary + '30',
  },
  photoBtnText: { color: theme.colors.primary, fontWeight: '700' },
  photoWrap: { marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
  photo: { width: '100%', height: 200, borderRadius: 16 },
  photoRemove: { position: 'absolute', top: 8, right: 8, backgroundColor: '#000000AA', borderRadius: 14 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 14, minHeight: 90, color: theme.colors.text,
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
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  causeText: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  actions: { marginTop: 20, gap: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 15, borderRadius: 14,
  },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  callBtn: { backgroundColor: '#DC2626' },
  emergencyBtn: { backgroundColor: '#B91C1C' },
  bookBtn: { backgroundColor: theme.colors.primary },
});
