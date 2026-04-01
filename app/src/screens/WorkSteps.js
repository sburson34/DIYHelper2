import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import Tts from 'react-native-tts';
import { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import theme from '../theme';
import { askHelper } from '../api/backendClient';

export default function WorkSteps({ navigation, route }) {
  const { project } = route.params;
  const [checkedSteps, setCheckedSteps] = useState(new Array(project.steps.length).fill(false));
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isAudioMode, setIsAudioMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAskingHelper, setIsAskingHelper] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');

  const currentStepIndexRef = useRef(0);

  useEffect(() => {
    Tts.addEventListener('tts-start', () => setIsSpeaking(true));
    Tts.addEventListener('tts-finish', () => {
      setIsSpeaking(false);
      if (isAudioMode) {
        startListening();
      }
    });
    Tts.addEventListener('tts-cancel', () => setIsSpeaking(false));

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
    }
  }, [isAudioMode]);

  const readCurrentStep = () => {
    if (currentStepIndex < project.steps.length) {
      const stepText = `Step ${currentStepIndex + 1}: ${project.steps[currentStepIndex]}`;
      Tts.stop();
      Tts.speak(stepText);
    } else {
      Tts.speak("Congratulations! You have completed all steps in the project blueprint.");
      setIsAudioMode(false);
    }
  };

  const startListening = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) return;

      setIsListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
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
    // If audio mode is still on and we are not speaking or asking helper, restart listening
    if (isAudioMode && !isSpeaking && !isAskingHelper) {
      startListening();
    }
  });

  const processVoiceCommand = async (command) => {
    console.log('Voice Command:', command);

    if (command.includes('done') || command.includes('complete') || command.includes('next')) {
      handleCheckStep(currentStepIndexRef.current);
      return;
    }

    if (command.includes('hey helper') || command.includes('hey, helper') || command.includes('helper')) {
      const question = command.replace(/hey helper|hey, helper|helper/g, '').trim();
      if (question) {
        handleAskHelper(question);
      } else {
        Tts.speak("I'm listening. What is your question?");
      }
      return;
    }
  };

  const handleCheckStep = (index) => {
    const newChecked = [...checkedSteps];
    newChecked[index] = true;
    setCheckedSteps(newChecked);

    if (index === currentStepIndexRef.current) {
      const nextIndex = index + 1;
      setCurrentStepIndex(nextIndex);
      currentStepIndexRef.current = nextIndex;

      if (isAudioMode) {
        setTimeout(() => {
          readCurrentStep();
        }, 1000);
      }
    }
  };

  const toggleStep = (index) => {
    const newChecked = [...checkedSteps];
    newChecked[index] = !newChecked[index];
    setCheckedSteps(newChecked);

    // Update current step index if we manually checked the "current" one
    if (index === currentStepIndex && newChecked[index]) {
        const nextIndex = index + 1;
        setCurrentStepIndex(nextIndex);
        currentStepIndexRef.current = nextIndex;
    }
  };

  const handleAskHelper = async (question) => {
    setIsAskingHelper(true);
    ExpoSpeechRecognitionModule.stop();

    try {
      Tts.speak("Thinking...");
      const result = await askHelper(question, project);
      Tts.stop();
      Tts.speak(result.answer);
    } catch (error) {
      Tts.speak("Sorry, I couldn't get an answer right now.");
      console.error(error);
    } finally {
      setIsAskingHelper(false);
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
          <Text style={styles.audioButtonText}>{isAudioMode ? "Audio Mode ON" : "Turn on Audio Mode"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>Current Progress</Text>
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
                {isAskingHelper ? "Helper is thinking..." : (isSpeaking ? "Speaking..." : (isListening ? "Listening for 'done' or 'Hey Helper'..." : "Standby"))}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Step-by-Step Blueprint</Text>

        {project.steps.map((step, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.stepCard,
              checkedSteps[index] && styles.stepCardChecked,
              currentStepIndex === index && !checkedSteps[index] && styles.stepCardCurrent
            ]}
            onPress={() => toggleStep(index)}
          >
            <View style={styles.stepHeader}>
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
                {step}
              </Text>
              <View style={[
                styles.checkbox,
                checkedSteps[index] && styles.checkboxChecked
              ]}>
                {checkedSteps[index] && <Icon name="checkmark" size={16} color="#fff" />}
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isAskingHelper && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Helper is finding an answer...</Text>
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
});
