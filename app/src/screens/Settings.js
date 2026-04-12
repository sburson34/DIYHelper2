import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import {
  saveUserProfile, getUserProfile,
  getAppPrefs, setAppPrefs,
  getCommunityOptIn, setCommunityOptIn,
  clearAllUserData,
} from '../utils/storage';
import { requestPermissions as requestNotificationPermissions } from '../utils/notifications';
import { useTranslation } from '../i18n/I18nContext';
import { useAppTheme } from '../ThemeContext';
import theme from '../theme';
import { reportError, reportHandledError, reportWarning, addBreadcrumb } from '../services/monitoring';
import { Sentry } from '../services/sentry';
import { useMLTranslation } from '../mlkit/TranslationProvider';

export default function Settings() {
  const { t, language, setLanguage } = useTranslation();
  const { isDark, toggleDark } = useAppTheme();
  const { available: translationAvailable, isModelReady, isDownloading, downloadModel } = useMLTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [zip, setZip] = useState('');
  const [skillLevel, setSkillLevel] = useState('intermediate');
  const [reminders, setReminders] = useState(true);
  const [community, setCommunity] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const profile = await getUserProfile();
      if (profile) {
        setName(profile.name || '');
        setEmail(profile.email || '');
        setPhone(profile.phone || '');
      }
      const prefs = await getAppPrefs();
      setZip(prefs.zip || '');
      setSkillLevel(prefs.skillLevel || 'intermediate');
      setReminders(prefs.remindersEnabled !== false);
      setCommunity(await getCommunityOptIn());
    })();
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      Alert.alert(t('required_fields'), t('required_fields_msg'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert(t('invalid_email'), t('invalid_email_msg'));
      return;
    }
    const success = await saveUserProfile({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
    });
    await setAppPrefs({ zip: zip.trim(), skillLevel, remindersEnabled: reminders });
    await setCommunityOptIn(community);
    if (success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      Alert.alert(t('error'), t('save_failed'));
    }
  };

  const SKILLS = [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Icon name="person-circle-outline" size={64} color={theme.colors.primary} />
            <Text style={styles.title}>{t('your_contact_info')}</Text>
            <Text style={styles.subtitle}>{t('contact_info_settings_desc')}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('full_name_placeholder')}
              placeholderTextColor={theme.colors.textSecondary}
              autoCapitalize="words"
              accessibilityLabel="Full name"
              accessibilityRole="text"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('email')}</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('email_placeholder')}
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              accessibilityLabel="Email address"
              accessibilityRole="text"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('phone')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('phone_placeholder')}
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="phone-pad"
              accessibilityLabel="Phone number"
              accessibilityRole="text"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Zip code (for permit checks)</Text>
            <TextInput
              style={styles.input}
              value={zip}
              onChangeText={setZip}
              placeholder="e.g. 02144"
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="number-pad"
              maxLength={5}
              accessibilityLabel="Zip code"
              accessibilityRole="text"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>DIY skill level</Text>
            <View style={styles.skillRow}>
              {SKILLS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.skillBtn, skillLevel === s.id && styles.skillBtnActive]}
                  onPress={() => setSkillLevel(s.id)}
                  accessibilityLabel={`Skill level ${s.label}${skillLevel === s.id ? ', selected' : ''}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.skillBtnText, skillLevel === s.id && styles.skillBtnTextActive]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Dark mode</Text>
              <Text style={styles.toggleSub}>Use a dark color scheme.</Text>
            </View>
            <Switch value={isDark} onValueChange={toggleDark} accessibilityLabel="Dark mode" accessibilityRole="switch" accessibilityState={{ checked: isDark }} />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Reminders</Text>
              <Text style={styles.toggleSub}>Notify me about unfinished projects.</Text>
            </View>
            <Switch
              value={reminders}
              onValueChange={async (val) => {
                setReminders(val);
                if (val) {
                  const granted = await requestNotificationPermissions();
                  if (!granted) {
                    Alert.alert('Permission denied', 'Enable notifications in system settings to receive reminders.');
                    setReminders(false);
                  }
                }
              }}
              accessibilityLabel="Reminders for unfinished projects"
              accessibilityRole="switch"
              accessibilityState={{ checked: reminders }}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Share to community</Text>
              <Text style={styles.toggleSub}>Anonymously share completed projects to the community library.</Text>
            </View>
            <Switch value={community} onValueChange={setCommunity} accessibilityLabel="Share completed projects to community" accessibilityRole="switch" accessibilityState={{ checked: community }} />
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} accessibilityLabel="Save profile settings" accessibilityRole="button">
            <Icon name={saved ? 'checkmark-circle' : 'save-outline'} size={22} color="#FFF" />
            <Text style={styles.saveButtonText}>{saved ? t('saved') : t('save_profile')}</Text>
          </TouchableOpacity>

          {/* Language toggle */}
          <View style={styles.languageSection}>
            <View style={styles.languageHeader}>
              <Icon name="language-outline" size={24} color={theme.colors.primary} />
              <Text style={styles.languageTitle}>{t('language')}</Text>
            </View>
            <Text style={styles.languageDesc}>{t('language_desc')}</Text>
            <View style={styles.languageButtons}>
              <TouchableOpacity
                style={[styles.langButton, language === 'en' && styles.langButtonActive]}
                onPress={() => setLanguage('en')}
                accessibilityLabel={`English language${language === 'en' ? ', selected' : ''}`}
                accessibilityRole="button"
              >
                <Text style={[styles.langButtonText, language === 'en' && styles.langButtonTextActive]}>
                  {t('english')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.langButton, language === 'es' && styles.langButtonActive]}
                onPress={() => setLanguage('es')}
                accessibilityLabel={`Spanish language${language === 'es' ? ', selected' : ''}`}
                accessibilityRole="button"
              >
                <Text style={[styles.langButtonText, language === 'es' && styles.langButtonTextActive]}>
                  {t('spanish')}
                </Text>
              </TouchableOpacity>
            </View>
            {translationAvailable && (
              <TouchableOpacity
                style={[styles.langButton, { marginTop: 12, flexDirection: 'row', gap: 6, alignItems: 'center' }]}
                onPress={downloadModel}
                disabled={isModelReady || isDownloading}
              >
                <Icon
                  name={isModelReady ? 'checkmark-circle' : isDownloading ? 'cloud-download-outline' : 'download-outline'}
                  size={18}
                  color={isModelReady ? theme.colors.success : theme.colors.secondary}
                />
                <Text style={[styles.langButtonText, isModelReady && { color: theme.colors.success }]}>
                  {isModelReady ? 'Offline translation ready' : isDownloading ? 'Downloading...' : 'Download Spanish language pack'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Delete my data */}
          <View style={styles.languageSection}>
            <View style={styles.languageHeader}>
              <Icon name="trash-outline" size={24} color="#DC2626" />
              <Text style={styles.languageTitle}>{t('delete_my_data')}</Text>
            </View>
            <Text style={styles.languageDesc}>{t('delete_my_data_desc')}</Text>
            <TouchableOpacity
              style={[styles.langButton, { borderColor: '#DC2626' }]}
              onPress={() => {
                Alert.alert(
                  t('delete_confirm_title'),
                  t('delete_confirm_msg'),
                  [
                    { text: t('cancel'), style: 'cancel' },
                    {
                      text: t('delete_everything'),
                      style: 'destructive',
                      onPress: () => {
                        Alert.alert(
                          t('delete_final_title'),
                          t('delete_final_msg'),
                          [
                            { text: t('cancel'), style: 'cancel' },
                            {
                              text: t('delete_everything'),
                              style: 'destructive',
                              onPress: async () => {
                                await clearAllUserData();
                                setName('');
                                setEmail('');
                                setPhone('');
                                setZip('');
                                setSkillLevel('intermediate');
                                setReminders(true);
                                setCommunity(false);
                                Alert.alert(t('data_deleted'), t('data_deleted_msg'));
                              },
                            },
                          ],
                        );
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={[styles.langButtonText, { color: '#DC2626' }]}>
                {t('delete_all_data')}
              </Text>
            </TouchableOpacity>
          </View>

          {__DEV__ ? (
            <View style={styles.languageSection}>
              <View style={styles.languageHeader}>
                <Icon name="bug-outline" size={24} color={theme.colors.primary} />
                <Text style={styles.languageTitle}>Sentry debug</Text>
              </View>
              <Text style={styles.languageDesc}>
                Dev-only. Trigger test events to verify Sentry wiring. These
                buttons are stripped from release builds by the __DEV__ guard.
              </Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                <TouchableOpacity
                  style={styles.langButton}
                  onPress={() => {
                    reportWarning('Sentry test warning from Settings', {
                      source: 'settings_debug_panel',
                    });
                    Alert.alert('Sentry', 'Test warning sent');
                  }}
                >
                  <Text style={styles.langButtonText}>Send test warning</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.langButton}
                  onPress={() => {
                    try {
                      throw new Error('Sentry test: handled JS exception');
                    } catch (e) {
                      reportHandledError('SettingsDebugPanel', e, { source: 'settings_debug_panel' });
                      Alert.alert('Sentry', 'Handled exception captured');
                    }
                  }}
                >
                  <Text style={styles.langButtonText}>Throw handled exception</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.langButton}
                  onPress={() => {
                    // Defer so the press handler returns first; this becomes
                    // an UNHANDLED rejection caught by Sentry's global hook.
                    setTimeout(() => {
                      throw new Error('Sentry test: unhandled JS exception');
                    }, 0);
                  }}
                >
                  <Text style={styles.langButtonText}>Throw unhandled exception</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langButton, { borderColor: '#DC2626' }]}
                  onPress={() => {
                    Alert.alert(
                      'Native crash',
                      'This will hard-crash the app to verify native crash reporting. Continue?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Crash',
                          style: 'destructive',
                          onPress: () => {
                            try {
                              Sentry.nativeCrash();
                            } catch (e) {
                              captureException(e);
                            }
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text style={[styles.langButtonText, { color: '#DC2626' }]}>
                    Trigger native crash
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.l,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginTop: theme.spacing.m,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.s,
    paddingHorizontal: theme.spacing.l,
  },
  field: {
    marginBottom: theme.spacing.m,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    fontSize: 16,
    color: theme.colors.text,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    marginTop: theme.spacing.l,
    gap: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  languageSection: {
    marginTop: theme.spacing.xl,
    padding: theme.spacing.l,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  languageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  languageTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
  },
  languageDesc: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 14,
  },
  languageButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  langButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.roundness.medium,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  langButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + '15',
  },
  langButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  langButtonTextActive: {
    color: theme.colors.primary,
  },
  skillRow: { flexDirection: 'row', gap: 8 },
  skillBtn: {
    flex: 1, paddingVertical: 12, borderRadius: theme.roundness.medium,
    borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  skillBtnActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '15' },
  skillBtnText: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },
  skillBtnTextActive: { color: theme.colors.primary },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  toggleSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
});
