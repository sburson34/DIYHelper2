import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons as Icon } from '@expo/vector-icons';
import { analyzeLive, AiConsentRequiredError } from '../api/backendClient';
import { reportError, addBreadcrumb } from '../services/monitoring';
import theme from '../theme';

// Guarded import — react-native-tts is a native module and may be missing on
// some devices (e.g. fresh Expo Go installs). Mirrors the WorkSteps pattern.
let Tts = null;
try { Tts = require('react-native-tts').default; } catch { /* native module unavailable */ }

// Stable session ID per mount. Each frame the user analyzes is a "turn"; the
// session lets the backend (or future analytics) correlate turns even though
// nothing is server-persisted today.
const newSessionId = () =>
  `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default function LiveHelpScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [taskDescription, setTaskDescription] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [showQuestion, setShowQuestion] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [result, setResult] = useState(null); // LiveAnalysisResult | null
  const [error, setError] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const sessionIdRef = useRef(newSessionId());
  const lastSpokenRef = useRef('');

  useEffect(() => {
    return () => {
      try { Tts?.stop(); } catch { /* no-op */ }
    };
  }, []);

  // Speak when a new instruction arrives (but never re-speak the same string —
  // re-rendering would otherwise repeat the audio on every state change).
  useEffect(() => {
    if (!result?.nextInstruction) return;
    if (result.nextInstruction === lastSpokenRef.current) return;
    lastSpokenRef.current = result.nextInstruction;
    speak(buildSpokenLine(result));
  }, [result]);

  const ensurePermission = useCallback(async () => {
    if (permission?.granted) return true;
    const next = await requestPermission();
    if (!next.granted) {
      Alert.alert(
        'Camera permission needed',
        'Live DIY Coach needs the camera to see what you’re working on.'
      );
      return false;
    }
    return true;
  }, [permission, requestPermission]);

  const captureFrame = useCallback(async () => {
    if (!cameraRef.current) return null;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: true,
        skipProcessing: true,
      });
      return { base64: photo.base64, mimeType: 'image/jpeg' };
    } catch (err) {
      addBreadcrumb('LiveHelp: capture failed', 'ui', { error: err?.message });
      return null;
    }
  }, []);

  const sendTurn = useCallback(async ({ withFrame, question }) => {
    if (!(await ensurePermission())) return;
    setError(null);
    setIsAnalyzing(true);
    try {
      let frame = null;
      if (withFrame) {
        frame = await captureFrame();
        if (!frame) {
          setError('Could not capture a photo. Try again.');
          setIsAnalyzing(false);
          return;
        }
      }
      const response = await analyzeLive({
        taskDescription: taskDescription.trim() || undefined,
        currentStep,
        userQuestion: question?.trim() || undefined,
        imageBase64: frame?.base64,
        mimeType: frame?.mimeType,
        sessionId: sessionIdRef.current,
      });
      setResult(response);
      // Server may overwrite session ID on first turn — adopt it.
      if (response.sessionId) sessionIdRef.current = response.sessionId;
    } catch (err) {
      if (err instanceof AiConsentRequiredError) {
        setError('AI features are off. Enable them in Settings to use Live Coach.');
      } else {
        const message = err?.message || 'Live coaching failed. Please try again.';
        setError(message);
        reportError(err, { source: 'LiveHelpScreen', operation: 'analyzeLive' });
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [captureFrame, currentStep, ensurePermission, taskDescription]);

  const onAnalyze = useCallback(() => {
    sendTurn({ withFrame: true });
  }, [sendTurn]);

  const onNextStep = useCallback(() => {
    setCurrentStep(s => s + 1);
    sendTurn({ withFrame: true, question: 'What is the next step?' });
  }, [sendTurn]);

  const onRepeat = useCallback(() => {
    if (!result?.nextInstruction) {
      Alert.alert('Nothing to repeat', 'Tap Analyze first.');
      return;
    }
    speak(buildSpokenLine(result));
  }, [result]);

  const onAskQuestion = useCallback(() => {
    setShowQuestion(true);
  }, []);

  const submitQuestion = useCallback(() => {
    const q = questionText.trim();
    if (!q) {
      Alert.alert('Type your question', 'Enter what you’d like to ask the coach.');
      return;
    }
    setShowQuestion(false);
    setQuestionText('');
    sendTurn({ withFrame: true, question: q });
  }, [questionText, sendTurn]);

  const onCallPro = useCallback(() => {
    try { Tts?.stop(); } catch { /* no-op */ }
    navigation.navigate('NewProject', { screen: 'Capture' });
    // Scroll the user toward the existing "Get Help From Professional" flow
    // rather than creating a new contractor-handoff path here.
    Alert.alert(
      'Call a Pro',
      'You’re being taken to the main project screen. Add photos and tap "Get Help From Professional" to send your job to a pro.'
    );
  }, [navigation]);

  // Quick-pick suggestions for common indoor projects. Reduces typing on a
  // phone with dirty hands. Tap to fill the description field.
  const QUICK_TASKS = useMemo(() => [
    'Replace a kitchen faucet',
    'Patch a small drywall hole',
    'Unclog a bathroom sink',
    'Caulk around a tub',
    'Install a smart thermostat',
  ], []);

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>
          Live DIY Coach needs camera access to see what you’re working on.
        </Text>
        <TouchableOpacity style={styles.bigButton} onPress={requestPermission}>
          <Text style={styles.bigButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
        />
        {isAnalyzing ? (
          <View style={styles.cameraOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.overlayText}>Analyzing…</Text>
          </View>
        ) : null}
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>Step {currentStep}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>What are you working on?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Replace the cartridge in my Moen kitchen faucet"
          placeholderTextColor={theme.colors.textSecondary}
          value={taskDescription}
          onChangeText={setTaskDescription}
          multiline
          numberOfLines={2}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickRow}
          contentContainerStyle={{ paddingRight: theme.spacing.m }}
        >
          {QUICK_TASKS.map(q => (
            <TouchableOpacity
              key={q}
              style={styles.quickChip}
              onPress={() => setTaskDescription(q)}
              accessibilityRole="button"
              accessibilityLabel={`Use task: ${q}`}
            >
              <Text style={styles.quickChipText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {showQuestion ? (
          <View style={styles.questionBox}>
            <Text style={styles.label}>Your question</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Is this the right cartridge orientation?"
              placeholderTextColor={theme.colors.textSecondary}
              value={questionText}
              onChangeText={setQuestionText}
              multiline
              autoFocus
            />
            <View style={styles.questionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => { setShowQuestion(false); setQuestionText(''); }}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={submitQuestion}>
                <Text style={styles.primaryButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle" size={20} color={theme.colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <ResultCard result={result} onCallPro={onCallPro} />
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              Point the camera at what you’re working on, then tap Analyze.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actionBar}>
        <ActionButton
          icon="scan"
          label="Analyze"
          onPress={onAnalyze}
          disabled={isAnalyzing}
          primary
        />
        <ActionButton
          icon="arrow-forward"
          label="Next step"
          onPress={onNextStep}
          disabled={isAnalyzing}
        />
        <ActionButton
          icon="refresh"
          label="Repeat"
          onPress={onRepeat}
          disabled={isAnalyzing}
        />
        <ActionButton
          icon="help-circle"
          label="Ask"
          onPress={onAskQuestion}
          disabled={isAnalyzing}
        />
        <ActionButton
          icon="call"
          label="Call pro"
          onPress={onCallPro}
          disabled={false}
          danger
        />
      </View>
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled, primary, danger }) {
  const bg = danger ? theme.colors.danger : primary ? theme.colors.primary : theme.colors.surface;
  const fg = danger || primary ? '#FFFFFF' : theme.colors.text;
  const opacity = disabled ? 0.5 : 1;
  return (
    <TouchableOpacity
      style={[styles.actionButton, { backgroundColor: bg, opacity }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={26} color={fg} />
      <Text style={[styles.actionLabel, { color: fg }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function ResultCard({ result, onCallPro }) {
  const escalate = !!result.shouldEscalateToProfessional;
  const confidencePct = Math.round((result.confidenceScore || 0) * 100);
  return (
    <View style={[styles.resultCard, escalate && styles.resultCardWarning]}>
      {escalate ? (
        <View style={styles.warnHeader}>
          <Icon name="warning" size={22} color={theme.colors.danger} />
          <Text style={styles.warnHeaderText}>Stop — call a professional</Text>
        </View>
      ) : null}
      {result.currentAssessment ? (
        <Text style={styles.assessmentText}>{result.currentAssessment}</Text>
      ) : null}
      {result.nextInstruction ? (
        <View style={styles.instructionBox}>
          <Text style={styles.instructionLabel}>Next step</Text>
          <Text style={styles.instructionText}>{result.nextInstruction}</Text>
        </View>
      ) : null}
      {Array.isArray(result.safetyWarnings) && result.safetyWarnings.length > 0 ? (
        <View style={styles.warningsBox}>
          <Text style={styles.warningsHeader}>Safety</Text>
          {result.safetyWarnings.map((w, i) => (
            <Text key={i} style={styles.warningsText}>• {w}</Text>
          ))}
        </View>
      ) : null}
      {Array.isArray(result.suggestedTools) && result.suggestedTools.length > 0 ? (
        <View style={styles.toolsBox}>
          <Text style={styles.toolsHeader}>Tools you may need</Text>
          <Text style={styles.toolsText}>{result.suggestedTools.join(', ')}</Text>
        </View>
      ) : null}
      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceText}>Confidence: {confidencePct}%</Text>
      </View>
      {escalate ? (
        <TouchableOpacity style={styles.escalateButton} onPress={onCallPro}>
          <Icon name="call" size={20} color="#fff" />
          <Text style={styles.escalateButtonText}>Get help from a pro</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const speak = (text) => {
  if (!text) return;
  try {
    Tts?.stop();
    Tts?.speak(text);
  } catch {
    // TTS unavailable on this device — visual UI is the source of truth.
  }
};

const buildSpokenLine = (result) => {
  if (!result) return '';
  if (result.shouldEscalateToProfessional) {
    const reason = result.escalationReason || 'this task may be unsafe';
    return `Stop. ${reason}. Please contact a professional before continuing.`;
  }
  return result.nextInstruction || '';
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.l, backgroundColor: theme.colors.background,
  },
  permissionText: {
    color: theme.colors.text, fontSize: 16, textAlign: 'center',
    marginBottom: theme.spacing.l,
  },
  cameraWrap: {
    height: 240,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  overlayText: {
    color: '#fff', marginTop: theme.spacing.s, fontSize: 16, fontWeight: '600',
  },
  stepBadge: {
    position: 'absolute', top: theme.spacing.m, left: theme.spacing.m,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: theme.spacing.m, paddingVertical: theme.spacing.xs,
    borderRadius: theme.roundness.full,
  },
  stepBadgeText: { color: '#fff', fontWeight: '700' },
  body: { flex: 1 },
  bodyContent: { padding: theme.spacing.m, paddingBottom: theme.spacing.l },
  label: {
    color: theme.colors.text, fontSize: 14, fontWeight: '600',
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    color: theme.colors.text,
    fontSize: 16,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  quickRow: { marginTop: theme.spacing.s },
  quickChip: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.s,
    borderRadius: theme.roundness.full,
    marginRight: theme.spacing.s,
  },
  quickChipText: { color: theme.colors.text, fontSize: 13 },
  questionBox: {
    marginTop: theme.spacing.m,
    padding: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.medium,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  questionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.s },
  secondaryButton: {
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.s,
    borderRadius: theme.roundness.medium, marginRight: theme.spacing.s,
  },
  secondaryButtonText: { color: theme.colors.textSecondary, fontWeight: '600' },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.s,
    borderRadius: theme.roundness.medium,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEEBEC',
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
  },
  errorText: { color: theme.colors.danger, marginLeft: theme.spacing.s, flex: 1 },
  emptyBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.l,
    marginTop: theme.spacing.m,
    alignItems: 'center',
  },
  emptyText: { color: theme.colors.textSecondary, textAlign: 'center' },
  resultCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.medium,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  resultCardWarning: {
    borderColor: theme.colors.danger,
    borderWidth: 2,
  },
  warnHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.s },
  warnHeaderText: {
    color: theme.colors.danger, fontWeight: '700', fontSize: 16,
    marginLeft: theme.spacing.s,
  },
  assessmentText: { color: theme.colors.text, fontSize: 15, marginBottom: theme.spacing.s },
  instructionBox: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.small,
    padding: theme.spacing.m,
    marginVertical: theme.spacing.s,
  },
  instructionLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700' },
  instructionText: { color: theme.colors.text, fontSize: 18, fontWeight: '600', marginTop: theme.spacing.xs },
  warningsBox: { marginTop: theme.spacing.s },
  warningsHeader: { color: theme.colors.danger, fontWeight: '700', marginBottom: theme.spacing.xs },
  warningsText: { color: theme.colors.text, fontSize: 14, marginBottom: 2 },
  toolsBox: { marginTop: theme.spacing.s },
  toolsHeader: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700' },
  toolsText: { color: theme.colors.text, fontSize: 14, marginTop: theme.spacing.xs },
  confidenceRow: { marginTop: theme.spacing.s, alignItems: 'flex-end' },
  confidenceText: { color: theme.colors.textSecondary, fontSize: 12 },
  escalateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.danger,
    paddingVertical: theme.spacing.m,
    borderRadius: theme.roundness.medium,
    marginTop: theme.spacing.m,
  },
  escalateButtonText: { color: '#fff', fontWeight: '700', marginLeft: theme.spacing.s, fontSize: 16 },
  actionBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.s,
    paddingHorizontal: theme.spacing.xs,
  },
  // Large tap targets — designed for dirty hands. Each button is ~64pt wide
  // and 64pt tall, well above the 44pt iOS / 48dp Android minimum.
  actionButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: theme.roundness.medium,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.s,
  },
  bigButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.m,
    borderRadius: theme.roundness.medium,
  },
  bigButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  actionLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
