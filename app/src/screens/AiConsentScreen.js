import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';
import { setAiConsent } from '../utils/storage';

// One-time disclosure before any AI call is initiated. Covers what leaves the
// device, which processors receive it, and how long it's kept. Shown after
// OnboardingScreen (if needed) and before the app's main surface. If the user
// declines, the app still functions for non-AI features — but the AI-driven
// capture flow short-circuits with the same consent prompt.

export default function AiConsentScreen({ onAccept, onDecline }) {
  const accept = async () => {
    await setAiConsent(true);
    onAccept && onAccept();
  };

  const decline = () => {
    Alert.alert(
      'Continue without AI?',
      'You can still browse saved projects and contractor tools, but photo analysis and the DIY helper will be disabled until you enable AI in Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue without AI',
          style: 'destructive',
          onPress: async () => {
            await setAiConsent(false);
            onDecline && onDecline();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '20' }]}>
          <Icon name="shield-checkmark-outline" size={72} color={theme.colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">How DIY Helper uses AI</Text>

        <Text style={styles.body}>
          To generate step-by-step repair guides, DIY Helper sends the photos and project description
          you submit to an AI provider for analysis.
        </Text>

        <View style={styles.bullet}>
          <Icon name="image-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>What leaves your device:</Text> the photos you attach and the
            text you type or dictate.
          </Text>
        </View>

        <View style={styles.bullet}>
          <Icon name="cloud-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>Who processes it:</Text> OpenAI (GPT-4o) or Anthropic (Claude),
            depending on service health. Both retain submissions for up to 30 days for abuse
            detection before deleting them.
          </Text>
        </View>

        <View style={styles.bullet}>
          <Icon name="lock-closed-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>What we store on our servers:</Text> nothing by default. If
            you request a "Quote from a pro" we temporarily hold your contact info and project
            summary; those are auto-deleted after 90 days.
          </Text>
        </View>

        <View style={styles.bullet}>
          <Icon name="phone-portrait-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.bulletText}>
            <Text style={styles.bold}>On your phone:</Text> project history, photos, and preferences
            stay on this device. You can clear them anytime in Settings.
          </Text>
        </View>

        <Text style={styles.fineprint}>
          By tapping "I understand" you agree to send photos and descriptions you submit in the app
          to the AI providers above for analysis. You can change your mind anytime in Settings.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: theme.colors.primary }]}
          onPress={accept}
          accessibilityRole="button"
          accessibilityLabel="I understand and accept"
        >
          <Text style={styles.ctaText}>I understand</Text>
          <Icon name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={decline}
          accessibilityRole="button"
          accessibilityLabel="Continue without AI features"
        >
          <Text style={styles.secondaryText}>Continue without AI</Text>
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
    paddingVertical: 14, borderRadius: 12, gap: 8,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
