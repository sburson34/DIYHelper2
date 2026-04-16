import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

const { width } = Dimensions.get('window');

// First-launch onboarding. Dismissal is persisted by the caller via AsyncStorage
// so this screen is only shown once. If the user clears app data, they see it
// again — which is the correct behaviour.

export default function OnboardingScreen({ onFinish }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  const steps = [
    { icon: 'camera-outline',   title: t('onboarding_title_1'), body: t('onboarding_body_1'), color: theme.colors.primary },
    { icon: 'sparkles-outline', title: t('onboarding_title_2'), body: t('onboarding_body_2'), color: theme.colors.secondary },
    { icon: 'construct-outline',title: t('onboarding_title_3'), body: t('onboarding_body_3'), color: theme.colors.accent },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const next = () => (isLast ? onFinish() : setStep(step + 1));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.skipRow}>
        <TouchableOpacity
          onPress={onFinish}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding_skip')}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Text style={styles.skip}>{t('onboarding_skip')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: current.color + '20' }]}>
          <Icon name={current.icon} size={80} color={current.color} />
        </View>
        <Text style={styles.title} accessibilityRole="header">{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === step && styles.dotActive]}
              accessibilityLabel={`Step ${i + 1} of ${steps.length}`}
            />
          ))}
        </View>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: current.color }]}
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('onboarding_get_started') : t('onboarding_next')}
        >
          <Text style={styles.ctaText}>
            {isLast ? t('onboarding_get_started') : t('onboarding_next')}
          </Text>
          <Icon name={isLast ? 'rocket-outline' : 'arrow-forward'} size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  skipRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16 },
  skip: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconCircle: {
    width: 180, height: 180, borderRadius: 90,
    justifyContent: 'center', alignItems: 'center', marginBottom: 32,
  },
  title: {
    fontSize: 28, fontWeight: '900', color: theme.colors.text,
    textAlign: 'center', marginBottom: 16,
  },
  body: {
    fontSize: 16, color: theme.colors.textSecondary,
    textAlign: 'center', lineHeight: 24, maxWidth: width - 64,
  },
  footer: { padding: 24, gap: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: theme.colors.border,
  },
  dotActive: { width: 24, backgroundColor: theme.colors.primary },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, borderRadius: theme.roundness.full,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
