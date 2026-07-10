// Tech-mode job detail — the field workflow: see the customer + problem, mark
// "on my way" with an ETA, start, capture before/after photos and a signature,
// add completion notes, and complete. Every change is written to the offline
// queue and flushed when possible, so the tech never loses work in a dead zone.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Linking, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { techGetJob, techRequestPayment, getTechToken, TechJobDetail, TechJobPatch } from '../../api/backendClient';
import { enqueuePatch, flushQueue, pendingPatch } from '../../tech/techQueue';
import { pickPhoto } from '../../utils/pickPhoto';
import { useTranslation } from '../../i18n/I18nContext';
import DrawingCanvas from '../../components/DrawingCanvas';
import RemoteImage from '../../components/RemoteImage';
import theme from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TechStackParamList } from '../../navigation/types';

const SIG_W = Dimensions.get('window').width - 64;
const SIG_H = 180;

// Hermes exposes btoa as a global, but the RN TS lib (no DOM) doesn't declare
// it. Type-only declaration — the `typeof btoa` guard below still handles
// engines where it's genuinely missing.
declare const btoa: ((data: string) => string) | undefined;

// Signature strokes as produced by DrawingCanvas's onStrokesChange.
interface SigStroke {
  points: Array<{ x: number; y: number; t?: number }>;
}

// Serialize signature strokes to a self-contained SVG, base64-encoded. The owner
// console renders it via a data:image/svg+xml URI. Returns null if empty or if
// the runtime lacks btoa (older engines) — signature is best-effort.
function strokesToSvgBase64(strokes: SigStroke[]): string | null {
  if (!strokes || !strokes.length) return null;
  const paths = strokes.map((s) => {
    const pts = s.points || [];
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    return `<path d="${d}" stroke="#111827" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIG_W}" height="${SIG_H}" viewBox="0 0 ${SIG_W} ${SIG_H}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;
  try { return typeof btoa !== 'undefined' ? btoa(svg) : null; } catch { return null; }
}

export default function TechJobDetailScreen({ route, navigation }: NativeStackScreenProps<TechStackParamList, 'TechJobDetail'>) {
  const { t } = useTranslation();
  const jobId = route?.params?.id;
  const [job, setJob] = useState<TechJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eta, setEta] = useState('20');
  const [notes, setNotes] = useState('');
  const [sigStrokes, setSigStrokes] = useState<SigStroke[]>([]);
  const [sigKey, setSigKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const j = await techGetJob(jobId);
      const queued = await pendingPatch(jobId);
      const merged = queued ? { ...j, ...queued } : j;
      setJob(merged);
      if (merged.completionNotes) setNotes(merged.completionNotes);
      if (merged.techEtaMinutes) setEta(String(merged.techEtaMinutes));
    } catch {
      Alert.alert(t('tech_detail_load_failed'), t('tech_detail_load_failed_msg'));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => { load(); }, [load]);

  // Apply an update optimistically, queue it, and try to flush immediately.
  const save = async (patch: TechJobPatch, okMsg?: string) => {
    setSaving(true);
    try {
      await enqueuePatch(jobId, patch);
      setJob((j) => ({ ...j, ...patch } as TechJobDetail));
      const flushed = await flushQueue();
      Alert.alert(
        okMsg || t('tech_saved'),
        flushed > 0 ? t('tech_saved_synced') : t('tech_saved_offline'),
      );
    } catch (e: any) {
      Alert.alert(t('tech_save_failed'), e.message || '');
    } finally {
      setSaving(false);
    }
  };

  const capture = async (which: 'beforePhotoBase64' | 'afterPhotoBase64', source: 'camera' | 'library') => {
    const p = await pickPhoto(source);
    if (!p) return;
    save({ [which]: p.base64 }, t('tech_photo_saved'));
  };

  const saveSignature = () => {
    const b64 = strokesToSvgBase64(sigStrokes);
    if (!b64) { Alert.alert(t('tech_sig_empty_title'), t('tech_sig_empty_msg')); return; }
    save({ signatureBase64: b64 }, t('tech_sig_saved'));
  };

  const clearSignature = () => { setSigStrokes([]); setSigKey((k) => k + 1); };

  const collectPayment = async () => {
    try {
      const res = await techRequestPayment(jobId);
      if (res.available && res.url) {
        Linking.openURL(res.url).catch(() => {});
      } else {
        Alert.alert(t('tech_pay_unavailable_title'), res.reason || t('tech_pay_unavailable_msg'));
      }
    } catch (e: any) {
      Alert.alert(t('tech_pay_unavailable_title'), e.message || '');
    }
  };

  const onMyWay = () => {
    const n = Number(eta);
    save({ status: 'on_the_way', techEtaMinutes: isNaN(n) || n < 0 ? 20 : n }, t('tech_status_updated'));
  };
  const startJob = () => save({ status: 'in_progress', techEtaMinutes: -1 }, t('tech_status_updated'));

  const completeJob = () => {
    // job is always loaded by the time this button is rendered (see the
    // loading/!job guard below), hence the non-null assertions.
    if (!job!.beforePhotoBase64 && !job!.beforePhotoUrl) { Alert.alert(t('tech_complete_need_before_title'), t('tech_complete_need_before_msg')); return; }
    if (!job!.afterPhotoBase64 && !job!.afterPhotoUrl) { Alert.alert(t('tech_complete_need_photo_title'), t('tech_complete_need_photo_msg')); return; }
    if (!job!.signatureBase64) { Alert.alert(t('tech_complete_need_sig_title'), t('tech_complete_need_sig_msg')); return; }
    Alert.alert(t('tech_complete_confirm_title'), t('tech_complete_confirm_msg'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('tech_complete'),
        onPress: () => save({ status: 'completed', completionNotes: notes.trim() }, t('tech_completed')).then(() => navigation.goBack()),
      },
    ]);
  };

  if (loading || !job) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  const done = job.status === 'completed';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{job.projectTitle || t('tech_job_default_title')}</Text>
        {job.serviceType ? <Text style={styles.service}>{job.serviceType}</Text> : null}

        {/* Customer + call */}
        <View style={styles.block}>
          <Text style={styles.blockLabel}>{t('tech_customer')}</Text>
          <Text style={styles.customerName}>{job.customerName}</Text>
          {job.customerPhone ? (
            <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL(`tel:${job.customerPhone}`)} accessibilityRole="button">
              <Icon name="call" size={16} color="#fff" />
              <Text style={styles.callText}>{job.customerPhone}</Text>
            </TouchableOpacity>
          ) : null}
          {job.address ? (
            <View style={styles.addressRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.addressLabel}>{t('tech_address')}</Text>
                <Text style={styles.addressText}>
                  {[job.address, job.city, job.state, job.zip].filter(Boolean).join(', ')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.navigateBtn}
                onPress={() => {
                  const url = job.mapsUrl
                    || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([job.address, job.city, job.zip].filter(Boolean).join(', '))}`;
                  Linking.openURL(url).catch(() => {});
                }}
                accessibilityRole="button"
                accessibilityLabel={t('tech_navigate')}
              >
                <Icon name="navigate-circle" size={18} color="#fff" />
                <Text style={styles.navigateText}>{t('tech_navigate')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {job.userDescription ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{t('tech_problem')}</Text>
            <Text style={styles.desc}>{job.userDescription}</Text>
          </View>
        ) : null}

        {job.imageBase64 || job.imageUrl ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{t('tech_customer_photo')}</Text>
            <RemoteImage
              base64={job.imageBase64}
              uri={job.imageUrl}
              headers={getTechToken() ? { Authorization: `Bearer ${getTechToken()}` } : undefined}
              style={styles.photo}
            />
          </View>
        ) : null}

        {/* Status actions */}
        {!done && (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{t('tech_update_status')}</Text>
            <View style={styles.etaRow}>
              <Text style={styles.etaLabel}>{t('tech_eta_label')}</Text>
              <TextInput style={styles.etaInput} value={eta} onChangeText={setEta} keyboardType="number-pad" maxLength={3} />
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.otw]} onPress={onMyWay} disabled={saving} accessibilityRole="button">
                <Icon name="navigate" size={16} color="#fff" /><Text style={styles.actionText}>{t('tech_on_my_way')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.start]} onPress={startJob} disabled={saving} accessibilityRole="button">
                <Icon name="play" size={16} color="#fff" /><Text style={styles.actionText}>{t('tech_start')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Before / after photos */}
        <View style={styles.block}>
          <Text style={styles.blockLabel}>{t('tech_photos')}</Text>
          <View style={styles.photoGrid}>
            {([['beforePhotoBase64', 'tech_before'], ['afterPhotoBase64', 'tech_after']] as const).map(([field, label]) => (
              <View key={field} style={styles.photoCell}>
                {job[field] || job[field === 'beforePhotoBase64' ? 'beforePhotoUrl' : 'afterPhotoUrl'] ? (
                  <RemoteImage
                    base64={job[field]}
                    uri={job[field === 'beforePhotoBase64' ? 'beforePhotoUrl' : 'afterPhotoUrl']}
                    headers={getTechToken() ? { Authorization: `Bearer ${getTechToken()}` } : undefined}
                    style={styles.photoThumb}
                  />
                ) : (
                  <View style={[styles.photoThumb, styles.photoEmpty]}><Icon name="camera-outline" size={26} color={theme.colors.textSecondary} /></View>
                )}
                <TouchableOpacity style={styles.photoBtn} onPress={() => capture(field, 'camera')} disabled={saving} accessibilityRole="button">
                  <Text style={styles.photoBtnText}>{t(label)}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {/* Signature */}
        {!done && (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{t('tech_signature')}{job.signatureBase64 ? ` ✓` : ''}</Text>
            <View style={styles.sigPad}>
              <DrawingCanvas key={sigKey} width={SIG_W} height={SIG_H} strokeColor="#111827" strokeWidth={2.5} onStrokesChange={setSigStrokes} />
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.smallBtn, styles.ghost]} onPress={clearSignature} accessibilityRole="button">
                <Text style={styles.ghostText}>{t('tech_clear')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, styles.saveSig]} onPress={saveSignature} disabled={saving} accessibilityRole="button">
                <Text style={styles.actionText}>{t('tech_save_signature')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Collect payment on-site */}
        {!done && (
          <View style={styles.block}>
            <TouchableOpacity style={styles.payBtn} onPress={collectPayment} accessibilityRole="button" testID="tech-collect-payment">
              <Icon name="card" size={18} color="#fff" />
              <Text style={styles.actionText}>{t('tech_collect_payment')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Notes + complete */}
        {!done ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{t('tech_notes')}</Text>
            <TextInput style={styles.notes} multiline value={notes} onChangeText={setNotes} placeholder={t('tech_notes_placeholder')} placeholderTextColor={theme.colors.textSecondary} />
            <TouchableOpacity style={styles.completeBtn} onPress={completeJob} disabled={saving} accessibilityRole="button" testID="tech-complete-button">
              {saving ? <ActivityIndicator color="#fff" /> : (<><Icon name="checkmark-done" size={18} color="#fff" /><Text style={styles.completeText}>{t('tech_complete')}</Text></>)}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.doneBanner}>
            <Icon name="checkmark-circle" size={20} color={theme.colors.success} />
            <Text style={styles.doneText}>{t('tech_done_banner')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  service: { color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 },
  block: { marginTop: 22 },
  blockLabel: { fontSize: 12, fontWeight: '800', color: theme.colors.textSecondary, textTransform: 'uppercase', marginBottom: 8 },
  customerName: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  addressLabel: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  addressText: { color: theme.colors.text, fontSize: 14, marginTop: 2 },
  navigateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.secondary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  navigateText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: theme.colors.success, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, marginTop: 8 },
  callText: { color: '#fff', fontWeight: '700' },
  desc: { color: theme.colors.text, fontSize: 15, lineHeight: 21 },
  photo: { width: '100%', height: 200, borderRadius: 14 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  etaLabel: { color: theme.colors.text, fontSize: 14 },
  etaInput: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, color: theme.colors.text, width: 80, textAlign: 'center', fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 14 },
  otw: { backgroundColor: '#F59E0B' },
  start: { backgroundColor: theme.colors.secondary },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  photoGrid: { flexDirection: 'row', gap: 12 },
  photoCell: { flex: 1 },
  photoThumb: { width: '100%', height: 120, borderRadius: 12, backgroundColor: theme.colors.surface },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  photoBtn: { marginTop: 8, backgroundColor: theme.colors.primary + '15', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  photoBtnText: { color: theme.colors.primary, fontWeight: '700' },
  sigPad: { width: SIG_W, height: SIG_H, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  smallBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, marginTop: 10 },
  ghost: { borderWidth: 1, borderColor: theme.colors.border },
  ghostText: { color: theme.colors.textSecondary, fontWeight: '700' },
  saveSig: { backgroundColor: theme.colors.primary },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.secondary, padding: 15, borderRadius: 14 },
  notes: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, minHeight: 90, color: theme.colors.text, textAlignVertical: 'top' },
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.success, padding: 16, borderRadius: 16, marginTop: 14 },
  completeText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  doneBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24, padding: 16, borderRadius: 14, backgroundColor: theme.colors.success + '18' },
  doneText: { color: theme.colors.text, fontWeight: '700' },
});
