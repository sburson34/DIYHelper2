// Request-a-quote / book-a-job (Wave 1). The core lead-gen flow: contact info,
// service type (from the brand's configured list), description, optional photo,
// and a preferred day + time window. Submits to the same endpoint as a lead, so
// it emails the company and pushes to their CRM, and it shows up in "My Jobs".
// Can be pre-filled from Triage (route params) so a diagnosed issue books in one tap.
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { submitBooking } from '../api/backendClient';
import { getUserProfile, saveUserProfile } from '../utils/storage';
import { useTranslation } from '../i18n/I18nContext';
import { useBrandConfig } from '../config/brandConfig';
import { pickPhoto } from '../utils/pickPhoto';
import theme from '../theme';

const WINDOWS = ['anytime', 'morning', 'afternoon', 'evening'];

// Next 7 days as selectable chips, plus an "ASAP" option (null date).
const buildDayOptions = (t) => {
  const opts = [{ key: 'asap', label: t('booking_asap'), iso: null }];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    opts.push({ key: d.toISOString().slice(0, 10), label, iso: d.toISOString() });
  }
  return opts;
};

export default function BookingScreen({ navigation, route }) {
  const { t } = useTranslation();
  const config = useBrandConfig();
  const params = route?.params || {};

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceType, setServiceType] = useState(params.serviceType || null);
  const [title, setTitle] = useState(params.prefillTitle || '');
  const [description, setDescription] = useState(params.prefillDescription || '');
  const [photo, setPhoto] = useState(params.imageBase64 ? { base64: params.imageBase64 } : null);
  const [day, setDay] = useState('asap');
  const [timeWindow, setTimeWindow] = useState('anytime');
  const [submitting, setSubmitting] = useState(false);

  const dayOptions = buildDayOptions(t);

  // Prefill contact info from the saved profile so returning customers don't retype.
  useEffect(() => {
    getUserProfile().then((p) => {
      if (!p) return;
      if (p.name) setName(p.name);
      if (p.email) setEmail(p.email);
      if (p.phone) setPhone(p.phone);
    });
  }, []);

  const addPhoto = async (source) => {
    const p = await pickPhoto(source);
    if (p) setPhoto(p);
  };

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert(t('booking_missing_title'), t('booking_missing_name'));
      return;
    }
    if (!email.trim() && !phone.trim()) {
      Alert.alert(t('booking_missing_title'), t('booking_missing_contact'));
      return;
    }
    setSubmitting(true);
    try {
      const selectedDay = dayOptions.find((d) => d.key === day);
      await saveUserProfile({ name: name.trim(), email: email.trim(), phone: phone.trim() });
      await submitBooking({
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim(),
        projectTitle: title.trim() || serviceType || t('booking_default_title'),
        userDescription: description.trim(),
        serviceType: serviceType || undefined,
        preferredDate: selectedDay?.iso || null,
        preferredWindow: timeWindow,
        projectData: params.projectData,
        imageBase64: photo?.base64,
      });
      Alert.alert(t('booking_sent_title'), t('booking_sent_msg'), [
        { text: t('booking_view_jobs'), onPress: () => navigation.navigate('MyJobs') },
        { text: t('common_ok'), style: 'cancel' },
      ]);
      // Reset the request-specific fields (keep contact info).
      setTitle('');
      setDescription('');
      setPhoto(null);
      setServiceType(null);
    } catch (e) {
      Alert.alert(t('booking_failed_title'), e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const serviceTypes = config.serviceTypes && config.serviceTypes.length ? config.serviceTypes : [t('booking_generic_service')];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          {config.companyName ? t('booking_lead_named').replace('{company}', config.companyName) : t('booking_lead')}
        </Text>

        <Text style={styles.label}>{t('booking_service_type')}</Text>
        <View style={styles.chips}>
          {serviceTypes.map((s) => {
            const active = serviceType === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setServiceType(active ? null : s)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('booking_describe')}</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder={t('booking_describe_placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          testID="booking-description-input"
        />

        {photo ? (
          <View style={styles.photoWrap}>
            {photo.uri ? <Image source={{ uri: photo.uri }} style={styles.photo} /> : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Icon name="image" size={28} color={theme.colors.textSecondary} />
                <Text style={styles.photoPlaceholderText}>{t('booking_photo_attached')}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.photoRemove} onPress={() => setPhoto(null)} accessibilityLabel={t('booking_remove_photo')}>
              <Icon name="close-circle" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => addPhoto('camera')} accessibilityRole="button">
              <Icon name="camera-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.photoBtnText}>{t('booking_add_photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={() => addPhoto('library')} accessibilityRole="button">
              <Icon name="image-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.photoBtnText}>{t('booking_choose_photo')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>{t('booking_preferred_day')}</Text>
        <View style={styles.chips}>
          {dayOptions.map((d) => {
            const active = day === d.key;
            return (
              <TouchableOpacity key={d.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setDay(d.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('booking_time_window')}</Text>
        <View style={styles.chips}>
          {WINDOWS.map((w) => {
            const active = timeWindow === w;
            return (
              <TouchableOpacity key={w} style={[styles.chip, active && styles.chipActive]} onPress={() => setTimeWindow(w)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(`booking_window_${w}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>{t('booking_your_details')}</Text>
        <TextInput style={styles.field} placeholder={t('booking_name')} placeholderTextColor={theme.colors.textSecondary} value={name} onChangeText={setName} testID="booking-name-input" />
        <TextInput style={styles.field} placeholder={t('booking_email')} placeholderTextColor={theme.colors.textSecondary} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="booking-email-input" />
        <TextInput style={styles.field} placeholder={t('booking_phone')} placeholderTextColor={theme.colors.textSecondary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="booking-phone-input" />

        <TouchableOpacity
          style={styles.submitBtn}
          onPress={submit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={t('booking_submit')}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          testID="booking-submit-button"
        >
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="paper-plane" size={18} color="#fff" />
              <Text style={styles.submitText}>{t('booking_submit')}</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, paddingBottom: 60 },
  lead: { fontSize: 15, color: theme.colors.text, lineHeight: 21, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '800', color: theme.colors.textSecondary, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  sectionLabel: { fontSize: 15, fontWeight: '800', color: theme.colors.text, marginTop: 24, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 100,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 14, minHeight: 90, color: theme.colors.text,
    textAlignVertical: 'top',
  },
  field: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 14, color: theme.colors.text, marginBottom: 10,
  },
  photoButtons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primary + '12', paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.primary + '30',
  },
  photoBtnText: { color: theme.colors.primary, fontWeight: '700' },
  photoWrap: { marginTop: 12, borderRadius: 16, overflow: 'hidden' },
  photo: { width: '100%', height: 180, borderRadius: 16 },
  photoPlaceholder: { backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoPlaceholderText: { color: theme.colors.textSecondary, fontSize: 13 },
  photoRemove: { position: 'absolute', top: 8, right: 8, backgroundColor: '#000000AA', borderRadius: 14 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primary, padding: 16, borderRadius: 16, marginTop: 24,
  },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
