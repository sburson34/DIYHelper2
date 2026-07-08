import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';
import { BRAND_NAME } from '../config/appInfo';
import { setPromoConsent, setAppPrefs } from '../utils/storage';
import { registerForPushNotificationsAsync, devicePlatform } from '../utils/notifications';
import { registerPushToken } from '../api/backendClient';

// Optional, skippable first-run priming screen for PROMOTIONAL push (offers,
// seasonal tips) from the branding company. Shown once, after AI consent. This
// is marketing consent — the app is never gated on it, so "Not now" simply
// records a decline and continues. Modeled on AiConsentScreen.

export default function PromoConsentScreen({ onDone }) {
  const [busy, setBusy] = React.useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        try { await registerPushToken(token, devicePlatform(), true); } catch {}
        await setAppPrefs({ pushEnabled: true });
        await setPromoConsent(true);
      } else {
        // Permission denied or unavailable — treat as a decline so we don't
        // nag again, but the user can still enable it later in Settings.
        await setPromoConsent(false);
      }
    } finally {
      setBusy(false);
      onDone && onDone();
    }
  };

  const skip = async () => {
    await setPromoConsent(false);
    onDone && onDone();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '20' }]}>
          <Icon name="notifications-outline" size={72} color={theme.colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">Get offers &amp; seasonal tips</Text>

        <Text style={styles.body}>
          Turn on notifications to hear from {BRAND_NAME} about timely projects, seasonal
          promotions, and money-saving offers for your home.
        </Text>

        <View style={styles.bullet}>
          <Icon name="pricetag-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>Deals &amp; promotions:</Text> occasional offers on the services
            you actually use.
          </Text>
        </View>

        <View style={styles.bullet}>
          <Icon name="sunny-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>Seasonal reminders:</Text> the right time of year to tackle a
            deck, gutters, or spring cleanup.
          </Text>
        </View>

        <View style={styles.bullet}>
          <Icon name="options-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>You're in control:</Text> turn this off anytime in Settings. It
            never affects the rest of the app.
          </Text>
        </View>

        <Text style={styles.fineprint}>
          We only use your notification token to deliver these messages. No purchase necessary.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: theme.colors.primary }, busy && { opacity: 0.7 }]}
          onPress={enable}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Enable offers and promotions"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.ctaText}>Enable offers</Text>
              <Icon name="arrow-forward" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={skip}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Not now"
        >
          <Text style={styles.secondaryText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 24, paddingBottom: 16, alignItems: 'center' },
  iconCircle: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center', marginVertical: 16,
  },
  title: {
    fontSize: 24, fontWeight: 'bold', color: theme.colors.text,
    textAlign: 'center', marginBottom: 12,
  },
  body: {
    fontSize: 15, color: theme.colors.textSecondary,
    lineHeight: 22, textAlign: 'center', marginBottom: 20,
  },
  bullet: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 14, gap: 12, paddingHorizontal: 4,
  },
  bulletText: {
    flex: 1, color: theme.colors.text, fontSize: 14, lineHeight: 20,
  },
  bold: { fontWeight: '700' },
  fineprint: {
    fontSize: 12, color: theme.colors.textSecondary,
    textAlign: 'center', marginTop: 8, lineHeight: 18,
  },
  footer: { padding: 20, gap: 12 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, gap: 8, minHeight: 52,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
