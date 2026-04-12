import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { submitFeedback } from '../services/feedback';
import { APP_INFO } from '../config/appInfo';
import theme from '../theme';

// Walk the nested navigation state to find the deepest focused route name.
function getActiveRouteName(state) {
  if (!state) return null;
  const route = state.routes[state.index];
  if (route.state) return getActiveRouteName(route.state);
  return route.name;
}

export default function ReportProblem() {
  const navigation = useNavigation();
  const navState = useNavigationState((s) => s);

  const [description, setDescription] = useState('');
  const [whatDoing, setWhatDoing] = useState('');
  const [reproSteps, setReproSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Required', 'Please describe the problem you ran into.');
      return;
    }

    setSubmitting(true);
    try {
      // Capture the previous screen (not "ReportProblem" itself).
      const currentScreen = getActiveRouteName(navState) || 'unknown';

      await submitFeedback({
        description: description.trim(),
        whatYouWereDoing: whatDoing.trim() || null,
        reproSteps: reproSteps.trim() || null,
        currentScreen,
      });

      setSubmitted(true);
    } catch {
      Alert.alert('Error', 'Could not submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    setDescription('');
    setWhatDoing('');
    setReproSteps('');
    setSubmitted(false);
    navigation.goBack();
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Icon name="checkmark-circle" size={64} color={theme.colors.success} />
          </View>
          <Text style={styles.successTitle}>Thank you!</Text>
          <Text style={styles.successBody}>
            Your feedback has been recorded. It helps us make DIYHelper better.
          </Text>
          <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Icon name="chatbubble-ellipses-outline" size={48} color={theme.colors.primary} />
            <Text style={styles.title}>Report a Problem</Text>
            <Text style={styles.subtitle}>
              Found a bug or something not working right? Let us know and we'll look into it.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>What went wrong? *</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the problem..."
              placeholderTextColor={theme.colors.textSecondary}
              multiline
              maxLength={500}
            />
            <Text style={styles.charCount}>{description.length}/500</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>What were you trying to do?</Text>
            <TextInput
              style={styles.input}
              value={whatDoing}
              onChangeText={setWhatDoing}
              placeholder="e.g. Taking a photo of a leaky faucet"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={200}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Steps to reproduce (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={reproSteps}
              onChangeText={setReproSteps}
              placeholder={"1. Open the app\n2. Tap ...\n3. See the error"}
              placeholderTextColor={theme.colors.textSecondary}
              multiline
              maxLength={500}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Icon name="send" size={18} color="#FFF" />
                <Text style={styles.submitButtonText}>Submit Report</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.metaSection}>
            <Text style={styles.metaTitle}>Automatically included</Text>
            <Text style={styles.metaItem}>App version: {APP_INFO.appVersion}+{APP_INFO.buildNumber}</Text>
            <Text style={styles.metaItem}>Platform: {APP_INFO.platform} {APP_INFO.osVersion}</Text>
            <Text style={styles.metaItem}>Environment: {APP_INFO.environment}</Text>
            {APP_INFO.gitCommit ? (
              <Text style={styles.metaItem}>Build: {APP_INFO.gitCommit}</Text>
            ) : null}
            <Text style={styles.metaNote}>
              No photos, passwords, or personal data are sent with this report.
            </Text>
          </View>
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
    paddingBottom: 60,
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
    lineHeight: 20,
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
    fontSize: 15,
    color: theme.colors.text,
  },
  inputTall: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  metaSection: {
    marginTop: theme.spacing.xl,
    padding: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metaTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  metaItem: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  metaNote: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: 8,
  },
  successBody: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 280,
  },
  doneButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: theme.roundness.medium,
    backgroundColor: theme.colors.primary,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
