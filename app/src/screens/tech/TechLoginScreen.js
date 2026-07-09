// Tech-mode sign-in. A technician enters the short code their company gave them
// and gets a ~30-day session. No password/account — the code is the whole login.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTechAuth } from '../../tech/TechAuthContext';
import { useBrandConfig } from '../../config/brandConfig';
import { useTranslation } from '../../i18n/I18nContext';
import theme from '../../theme';

export default function TechLoginScreen() {
  const { t } = useTranslation();
  const { login } = useTechAuth();
  const config = useBrandConfig();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim()) {
      Alert.alert(t('tech_login_need_code_title'), t('tech_login_need_code_msg'));
      return;
    }
    setBusy(true);
    try {
      await login(code);
      // On success the TechStack swaps to the jobs list automatically.
    } catch (e) {
      Alert.alert(t('tech_login_failed_title'), e.message || t('tech_login_failed_msg'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Icon name="briefcase" size={44} color={theme.colors.primary} />
        <Text style={styles.title}>{t('tech_login_title')}</Text>
        <Text style={styles.subtitle}>
          {config.companyName ? t('tech_login_sub_named').replace('{company}', config.companyName) : t('tech_login_sub')}
        </Text>
        <TextInput
          style={styles.input}
          placeholder={t('tech_login_placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          testID="tech-login-code"
        />
        <TouchableOpacity
          style={styles.btn}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('tech_login_button')}
          accessibilityState={{ disabled: busy, busy }}
          testID="tech-login-submit"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{t('tech_login_button')}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { fontSize: 24, fontWeight: '800', color: theme.colors.text, marginTop: 12 },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 24, lineHeight: 20 },
  input: {
    width: '100%', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium, padding: 16, color: theme.colors.text, fontSize: 20,
    letterSpacing: 4, textAlign: 'center', fontWeight: '700',
  },
  btn: {
    width: '100%', backgroundColor: theme.colors.primary, padding: 16, borderRadius: 16,
    alignItems: 'center', marginTop: 16,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
