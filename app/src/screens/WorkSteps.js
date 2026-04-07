import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import Tts from 'react-native-tts';
import { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as ImagePicker from 'expo-image-picker';
import theme from '../theme';
import { askHelper, verifyStep } from '../api/backendClient';
import { updateHoneyDoList, updateContractorList } from '../utils/storage';
import { useTranslation } from '../i18n/I18nContext';

const getStepText = (step) => typeof step === 'string' ? step : step.text;

export default function WorkSteps({ navigation, route }) {
  const { t, language } = useTranslation();
  const { project: initialProject, listType } = route.params;
  const [project, setProject] = useState(initialProject);
  const [checkedSteps, setCheckedSteps] = useState(
    Array.isArray(initialProject.checkedSteps) && initialProject.checkedSteps.length === initialProject.steps.length
      ? initialProject.checkedSteps
      : new Array(initialProject.steps.length).fill(false)
  );
  const [stepNotes, setStepNotes] = useState(initialProject.stepNotes || {});
  const [photos, setPhotos] = useState(initialProject.photos || []);
  const [verifyResult, setVerifyResult] = useState({});
  const [verifying, setVerifying] = useState(null);

  // Persist updates back to storage so changes survive a reload (#2 step notes, #1 photos)
  const persist = async (patch) => {
    const updated = { ...project, checkedSteps, stepNotes, photos, ...patch };
    setProject(updated);
    if (listType === 'contractor') {
      await updateContractorList(updated);
    } else {
      await updateHoneyDoList(updated);
    }
  };
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isAudioMode, setIsAudioMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAskingHelper, setIsAskingHelper] = useState(false);
  const [awaitingQuestion, setAwaitingQuestion] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');

  // Refs to avoid stale closures in callbacks
  const currentStepIndexRef = useRef(0);
  const isAudioModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isAskingHelperRef = useRef(false);
  const awaitingQuestionRef = useRef(false);
  const checkedStepsRef = useRef(checkedSteps);

  // Keep refs in sync with state
  useEffect(() => { isAudioModeRef.current = isAudioMode; }, [isAudioMode]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { isAskingHelperRef.current = isAskingHelper; }, [isAskingHelper]);
  useEffect(() => { awaitingQuestionRef.current = awaitingQuestion; }, [awaitingQuestion]);
  useEffect(() => { checkedStepsRef.current = checkedSteps; }, [checkedSteps]);

  useEffect(() => {
    Tts.addEventListener('tts-start', () => {
      setIsSpeaking(true);
      isSpeakingRef.current = true;
    });
    Tts.addEventListener('tts-finish', () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isAudioModeRef.current) {
        startListening();
      }
    });
    Tts.addEventListener('tts-cancel', () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });

    return () => {
      Tts.stop();
      ExpoSpeechRecognitionModule.stop();
    };
  }, []);

  useEffect(() => {
    if (isAudioMode) {
      readCurrentStep();
    } else {
      Tts.stop();
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
      setAwaitingQuestion(false);
    }
  }, [isAudioMode]);

  const readCurrentStep = () => {
    const idx = currentStepIndexRef.current;
    if (idx < project.steps.length) {
      const prefix = language === 'es' ? 'Paso' : 'Step';
      const stepText = `${prefix} ${idx + 1}: ${getStepText(project.steps[idx])}`;
      Tts.stop();
      Tts.speak(stepText);
    } else {
      Tts.speak(language === 'es'
        ? '¡Felicidades! Has completado todos los pasos del plano del proyecto.'
        : 'Congratulations! You have completed all steps in the project blueprint.');
      setIsAudioMode(false);
    }
  };

  const startListening = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) return;

      setIsListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: language === 'es' ? 'es-US' : 'en-US',
        interimResults: false,
      });
    } catch (err) {
      console.error('Failed to start listening:', err);
    }
  };

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.toLowerCase() || '';
    setLastTranscript(transcript);
    processVoiceCommand(transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    // Restart listening if audio mode is on and we're not busy
    if (isAudioModeRef.current && !isSpeakingRef.current && !isAskingHelperRef.current) {
      startListening();
    }
  });

  const processVoiceCommand = async (command) => {
    console.log('Voice Command:', command);

    // If we're awaiting a follow-up question after "Hey Helper"
    if (awaitingQuestionRef.current) {
      setAwaitingQuestion(false);
      awaitingQuestionRef.current = false;
      if (command.trim()) {
        handleAskHelper(command.trim());
      } else {
        Tts.speak(language === 'es'
          ? 'No te escuché. Di Hey Helper y luego tu pregunta.'
          : "I didn't catch that. Say Hey Helper and then your question.");
      }
      return;
    }

    // Check for "repeat" to re-read the current step
    if (command.includes('repeat') || command.includes('say that again') || command.includes('one more time') ||
        command.includes('repite') || command.includes('repetir') || command.includes('otra vez')) {
      readCurrentStep();
      return;
    }

    // Check for "done" or "complete" to mark current step
    if (command.includes('done') || command.includes('complete') ||
        command.includes('listo') || command.includes('completo') || command.includes('terminado')) {
      handleCheckStep(currentStepIndexRef.current);
      return;
    }

    // Check for "Hey Helper" wake phrase
    if (command.includes('hey helper') || command.includes('hey, helper')) {
      const question = command.replace(/hey,?\s*helper/g, '').trim();
      if (question) {
        // Question was included in the same utterance
        handleAskHelper(question);
      } else {
        // Just said "Hey Helper" — wait for the follow-up question
        setAwaitingQuestion(true);
        awaitingQuestionRef.current = true;
        Tts.speak(language === 'es'
          ? 'Estoy escuchando. ¿Cuál es tu pregunta?'
          : "I'm listening. What is your question?");
      }
      return;
    }
  };

  const handleCheckStep = (index) => {
    const newChecked = [...checkedStepsRef.current];
    newChecked[index] = true;
    setCheckedSteps(newChecked);
    checkedStepsRef.current = newChecked;

    if (index === currentStepIndexRef.current) {
      const nextIndex = index + 1;
      setCurrentStepIndex(nextIndex);
      currentStepIndexRef.current = nextIndex;

      if (isAudioModeRef.current) {
        setTimeout(() => {
          readCurrentStep();
        }, 1000);
      }
    }
  };

  const toggleStep = (index) => {
    const newChecked = [...checkedStepsRef.current];
    newChecked[index] = !newChecked[index];
    setCheckedSteps(newChecked);
    checkedStepsRef.current = newChecked;

    if (index === currentStepIndex && newChecked[index]) {
      const nextIndex = index + 1;
      setCurrentStepIndex(nextIndex);
      currentStepIndexRef.current = nextIndex;
    }
  };

  const handleAskHelper = async (question) => {
    setIsAskingHelper(true);
    isAskingHelperRef.current = true;
    ExpoSpeechRecognitionModule.stop();

    try {
      Tts.speak(language === 'es' ? 'Déjame revisarlo.' : 'Let me check on that.');
      const result = await askHelper(question, project, language);
      Tts.stop();
      Tts.speak(result.answer);
    } catch (error) {
      Tts.speak(language === 'es'
        ? 'Lo siento, no pude obtener una respuesta ahora mismo.'
        : "Sorry, I couldn't get an answer right now.");
      console.error(error);
    } finally {
      setIsAskingHelper(false);
      isAskingHelperRef.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.projectTitle}>{project.title}</Text>
        <TouchableOpacity
          style={[styles.audioButton, isAudioMode && styles.audioButtonActive]}
          onPress={() => setIsAudioMode(!isAudioMode)}
        >
          <Icon name={isAudioMode ? "volume-high" : "volume-mute-outline"} size={24} color="#fff" />
          <Text style={styles.audioButtonText}>{isAudioMode ? t('audio_mode_on') : t('audio_mode_off')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>{t('current_progress')}</Text>
            <Text style={styles.progressText}>
              {checkedSteps.filter(s => s).length} / {project.steps.length}
            </Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(checkedSteps.filter(s => s).length / project.steps.length) * 100}%` }
              ]}
            />
          </View>
          {isAudioMode && (
            <View style={styles.listeningIndicator}>
              <Icon
                name={isListening ? "mic" : (isSpeaking ? "volume-high" : "mic-off")}
                size={20}
                color={isListening ? theme.colors.primary : theme.colors.textSecondary}
              />
              <Text style={styles.listeningText}>
                {isAskingHelper ? t('helper_checking') : (isSpeaking ? t('speaking') : (awaitingQuestion ? t('listening_for_question') : (isListening ? t('listening_for_commands') : t('standby'))))}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t('step_by_step')}</Text>

        {project.steps.map((step, index) => (
          <View
            key={index}
            style={[
              styles.stepCard,
              checkedSteps[index] && styles.stepCardChecked,
              currentStepIndex === index && !checkedSteps[index] && styles.stepCardCurrent
            ]}
          >
            <TouchableOpacity style={styles.stepHeader} onPress={() => toggleStep(index)}>
              <View style={[
                styles.stepNumberBadge,
                checkedSteps[index] && { backgroundColor: theme.colors.success },
                currentStepIndex === index && !checkedSteps[index] && { backgroundColor: theme.colors.primary }
              ]}>
                {checkedSteps[index] ? (
                  <Icon name="checkmark" size={16} color="#fff" />
                ) : (
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                )}
              </View>
              <Text style={[
                styles.stepText,
                checkedSteps[index] && styles.stepTextChecked
              ]}>
                {getStepText(step)}
              </Text>
              <View style={[
                styles.checkbox,
                checkedSteps[index] && styles.checkboxChecked
              ]}>
                {checkedSteps[index] && <Icon name="checkmark" size={16} color="#fff" />}
              </View>
            </TouchableOpacity>

            {/* Per-step notes (#2) */}
            <TextInput
              style={styles.noteInput}
              placeholder="Notes for this step..."
              placeholderTextColor={theme.colors.textSecondary}
              value={stepNotes[index] || ''}
              onChangeText={(v) => {
                const next = { ...stepNotes, [index]: v };
                setStepNotes(next);
              }}
              onBlur={() => persist({ stepNotes })}
              multiline
            />

            {/* Verify-step button (#9) */}
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={async () => {
                try {
                  const perm = await ImagePicker.requestCameraPermissionsAsync();
                  if (!perm.granted) { Alert.alert('Camera permission needed'); return; }
                  const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
                  if (result.canceled) return;
                  const asset = result.assets?.[0];
                  if (!asset?.base64) return;
                  setVerifying(index);
                  // Save photo to project timeline (#1)
                  const newPhoto = { uri: asset.uri, stepIndex: index, takenAt: new Date().toISOString(), phase: 'progress' };
                  const nextPhotos = [...photos, newPhoto];
                  setPhotos(nextPhotos);
                  await persist({ photos: nextPhotos });
                  const r = await verifyStep({
                    stepText: getStepText(step),
                    projectTitle: project.title,
                    base64Image: asset.base64,
                    mimeType: 'image/jpeg',
                    language,
                  });
                  setVerifyResult({ ...verifyResult, [index]: r });
                } catch (e) {
                  Alert.alert('Verify failed', e.message);
                } finally {
                  setVerifying(null);
                }
              }}
            >
              {verifying === index ? <ActivityIndicator color={theme.colors.primary} /> : (
                <>
                  <Icon name="camera-outline" size={16} color={theme.colors.primary} />
                  <Text style={styles.verifyBtnText}>Verify with photo</Text>
                </>
              )}
            </TouchableOpacity>

            {verifyResult[index] && (
              <View style={[
                styles.verifyResult,
                verifyResult[index].rating === 'good' && { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
                verifyResult[index].rating === 'needs_work' && { backgroundColor: '#FFFBEB', borderColor: '#F59E0B' },
                verifyResult[index].rating === 'wrong' && { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
              ]}>
                <Text style={styles.verifyRating}>
                  {verifyResult[index].rating?.toUpperCase()} {verifyResult[index].score ? `(${verifyResult[index].score}/10)` : ''}
                </Text>
                {verifyResult[index].summary && <Text style={styles.verifySummary}>{verifyResult[index].summary}</Text>}
                {(verifyResult[index].issues || []).map((iss, i) => (
                  <Text key={i} style={styles.verifyIssue}>• {iss}</Text>
                ))}
              </View>
            )}

            {/* Photos taken for this step */}
            {photos.filter(p => p.stepIndex === index).length > 0 && (
              <ScrollView horizontal style={{ marginTop: 8 }} showsHorizontalScrollIndicator={false}>
                {photos.filter(p => p.stepIndex === index).map((p, i) => (
                  <Image key={i} source={{ uri: p.uri }} style={styles.thumbnail} />
                ))}
              </ScrollView>
            )}
          </View>
        ))}
      </ScrollView>

      {isAskingHelper && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>{t('helper_finding')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    backgroundColor: theme.colors.text,
    padding: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    paddingBottom: 30,
  },
  projectTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 15,
  },
  audioButton: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  audioButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  audioButtonText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 10,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  statusCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 20,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '900',
    color: theme.colors.primary,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#F0F0F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 15,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  listeningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 12,
  },
  listeningText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginLeft: 8,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: 15,
  },
  stepCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stepCardCurrent: {
    borderColor: theme.colors.primary,
    backgroundColor: '#F5F8FF',
  },
  stepCardChecked: {
    backgroundColor: '#F0FDF4',
    opacity: 0.8,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumberText: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textSecondary,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    lineHeight: 22,
  },
  stepTextChecked: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  noteInput: {
    marginTop: 10, padding: 10,
    backgroundColor: '#F8FAFC', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    minHeight: 36, color: theme.colors.text, fontSize: 13,
  },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, padding: 8, borderRadius: 8,
    backgroundColor: theme.colors.primary + '10',
    alignSelf: 'flex-start',
  },
  verifyBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 12 },
  verifyResult: { marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  verifyRating: { fontWeight: '800', fontSize: 12, marginBottom: 4 },
  verifySummary: { fontSize: 12, color: '#374151', marginBottom: 4 },
  verifyIssue: { fontSize: 11, color: '#6B7280' },
  thumbnail: { width: 60, height: 60, borderRadius: 8, marginRight: 6 },
});
