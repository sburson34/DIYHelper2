import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Ionicons as Icon } from '@expo/vector-icons';
import { analyzeProject, submitHelpRequest, getClarifyingQuestions } from '../api/backendClient';
import { reportError, reportHandledError, addBreadcrumb } from '../services/monitoring';
import { labelImage } from '../mlkit/imageLabeling';
import ImageLabelsChip from '../components/ImageLabelsChip';
import { extractEntities } from '../mlkit/entityExtraction';
import ExtractedEntitiesBar from '../components/ExtractedEntitiesBar';
import { getUserProfile, saveLocalHelpRequest, getMostRecentProject } from '../utils/storage';
import { subscribeReset } from '../utils/captureBus';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function CaptureScreen({ navigation, route }) {
  const { t, language } = useTranslation();
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState('photo');
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [resumeCard, setResumeCard] = useState(null);
  const [clarifyQuestions, setClarifyQuestions] = useState(null);
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarifyAnswers, setClarifyAnswers] = useState({});
  const [extractedEntities, setExtractedEntities] = useState([]);

  // Debounced entity extraction on description changes
  useEffect(() => {
    if (!description || description.length < 10) {
      setExtractedEntities([]);
      return;
    }
    const timer = setTimeout(() => {
      extractEntities(description).then(setExtractedEntities);
    }, 500);
    return () => clearTimeout(timer);
  }, [description]);

  // Ref tracks the latest transcript so the 'end' handler always sees the
  // most recent value, even if React hasn't re-rendered yet.
  const transcriptRef = useRef('');

  useSpeechRecognitionEvent('result', (event) => {
    const transcriptValue = event.results?.[0]?.transcript || '';
    transcriptRef.current = transcriptValue;
    setTranscript(transcriptValue);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsRecording(false);
    const finalTranscript = transcriptRef.current;
    if (finalTranscript) {
      setDescription((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript));
      transcriptRef.current = '';
      setTranscript('');
    }
  });

  // Load resume-where-you-left-off card whenever this screen comes into focus (#3)
  useEffect(() => {
    const unsub = navigation.addListener('focus', async () => {
      const recent = await getMostRecentProject();
      setResumeCard(recent);
    });
    return unsub;
  }, [navigation]);

  // Refs so the captureBus listener (which is registered once) always sees current state
  const descriptionRef = useRef('');
  const mediaRef = useRef([]);
  useEffect(() => { descriptionRef.current = description; }, [description]);
  useEffect(() => { mediaRef.current = media; }, [media]);

  // Listen for global "reset" requests fired by the logo header / drawer "New Project" item
  useEffect(() => {
    const unsub = subscribeReset(() => {
      const focused = navigation.isFocused();
      const hasData = (descriptionRef.current && descriptionRef.current.trim().length > 0) || mediaRef.current.length > 0;

      if (!focused) {
        // Not on screen — silently clear so the user lands on a fresh main screen.
        resetAll();
        return;
      }
      if (!hasData) {
        // Already on a clean main screen — nothing to do.
        return;
      }
      Alert.alert(
        'Erase current project?',
        'You have unsaved work on the New Project screen. Clear it and start over?',
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Erase', style: 'destructive', onPress: resetAll },
        ]
      );
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    if (route.params?.existingProject) {
      const { project, originalRequest } = route.params.existingProject;
      setDescription(originalRequest.description + "\n\n--- Additional Context Needed ---\n");
      // media should ideally be restored too if possible, but URIs might be stale or need handling
      if (originalRequest.mediaUrls) {
        setMedia(originalRequest.mediaUrls.map(uri => ({ uri, type: 'photo' }))); // fallback type
      }
    }
  }, [route.params?.existingProject]);

  const takePhoto = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert(t('permission_denied'), t('camera_perm_msg'));
        return;
      }
    }
    setShowCamera(true);
  };

  const capturePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      const mediaItem = {
        uri: photo.uri,
        type: 'photo',
        base64: photo.base64,
        mimeType: 'image/jpeg',
        labels: [],
      };
      setMedia((prev) => [...prev, mediaItem]);
      setShowCamera(false);
      // Run ML Kit image labeling in background (non-blocking)
      labelImage(photo.base64).then((labels) => {
        if (labels.length > 0) {
          setMedia((prev) => prev.map(m =>
            m.uri === photo.uri ? { ...m, labels } : m
          ));
        }
      });
    } catch (err) {
      Alert.alert(t('camera_error'), err.message);
    }
  };

  const recordVideo = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert(t('permission_denied'), t('video_perm_msg'));
        return;
      }
    }
    setCameraMode('video');
    setShowCamera(true);
  };

  const toggleVideoRecording = async () => {
    if (!cameraRef.current) return;
    if (isRecordingVideo) {
      cameraRef.current.stopRecording();
      setIsRecordingVideo(false);
    } else {
      setIsRecordingVideo(true);
      try {
        const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
        setMedia((prev) => [...prev, {
          uri: video.uri,
          type: 'video',
          mimeType: 'video/mp4',
        }]);
        setShowCamera(false);
        setCameraMode('photo');
      } catch (err) {
        Alert.alert(t('video_error'), err.message);
      } finally {
        setIsRecordingVideo(false);
      }
    }
  };

  const startRecording = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert(t('permission_denied'), t('speech_perm_msg'));
        return;
      }

      setTranscript('');
      setIsRecording(true);
      ExpoSpeechRecognitionModule.start({
        lang: language === 'es' ? 'es-US' : 'en-US',
        interimResults: true,
      });
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    ExpoSpeechRecognitionModule.stop();
  };

  const runAnalyze = async (extraDescription = '') => {
    // Make sure the mic isn't still capturing in the background — that keeps
    // the JS thread busy and can lock up the next screen.
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
    setIsRecording(false);

    setIsAnalyzing(true);
    try {
      const mediaItems = media.map(m => ({
        uri: m.uri,
        base64: m.base64,
        mimeType: m.mimeType,
        type: m.type,
        labels: m.labels || [],
      }));
      const fullDesc = extraDescription ? `${description}\n\n${extraDescription}` : description;
      addBreadcrumb('Starting project analysis', 'user.action', {
        mediaCount: mediaItems.length,
        hasDescription: !!fullDesc,
      });
      const result = await analyzeProject(fullDesc, mediaItems, language);
      if (result._fromCache) {
        Alert.alert('Offline mode', 'Couldn\'t reach the server — showing a cached version of this analysis.');
      }
      navigation.navigate('Result', {
        project: result,
        originalRequest: { description: fullDesc, mediaUrls: media.map(m => m.uri) }
      });
    } catch (error) {
      reportError(error, { source: 'CaptureScreen', operation: 'runAnalyze' });
      Alert.alert(t('analysis_error'), error.message);
    } finally {
      setIsAnalyzing(false);
      setClarifyQuestions(null);
      setClarifyAnswers({});
    }
  };

  // Progressive clarifying questions before full analysis (#11)
  const handleAnalyze = async () => {
    if (!description && media.length === 0) {
      Alert.alert(t('missing_info_title'), t('missing_info_msg'));
      return;
    }
    setIsClarifying(true);
    try {
      const mediaItems = media.map(m => ({
        uri: m.uri, base64: m.base64, mimeType: m.mimeType, type: m.type,
      }));
      const r = await getClarifyingQuestions({ description, media: mediaItems, language });
      const qs = (r?.questions || []).slice(0, 3);
      if (qs.length > 0) {
        setClarifyQuestions(qs);
      } else {
        await runAnalyze();
      }
    } catch (e) {
      reportHandledError('ClarifyFallbackToAnalyze', e, { source: 'CaptureScreen' });
      await runAnalyze();
    } finally {
      setIsClarifying(false);
    }
  };

  const submitClarifyAnswers = async () => {
    const extra = clarifyQuestions
      .map((q, i) => clarifyAnswers[i] ? `Q: ${q.q}\nA: ${clarifyAnswers[i]}` : null)
      .filter(Boolean)
      .join('\n');
    await runAnalyze(extra);
  };

  // Wire help-requests endpoint (#20). Submits and saves to local mirror for Quote tracker.
  const sendToProfessional = async () => {
    if (!description && media.length === 0) {
      Alert.alert(t('missing_info_title'), t('missing_info_msg'));
      return;
    }
    const profile = await getUserProfile();
    if (!profile?.name || !profile?.email) {
      Alert.alert('Add your contact info', 'Open Settings and fill in your name, email, and phone first.');
      return;
    }
    try {
      const firstImage = media.find(m => m.type === 'photo' && m.base64);
      const result = await submitHelpRequest({
        customerName: profile.name,
        customerEmail: profile.email,
        customerPhone: profile.phone || '',
        projectTitle: description.slice(0, 60) || 'DIY Help Request',
        userDescription: description,
        projectData: { description, mediaCount: media.length },
        imageBase64: firstImage?.base64 || null,
      });
      await saveLocalHelpRequest({
        id: String(result.id),
        projectTitle: description.slice(0, 60) || 'DIY Help Request',
        userDescription: description,
        status: 'sent',
      });
      Alert.alert('Sent', 'Your request has been sent to a professional. Track its status in the Quote Tracker.');
      resetAll();
    } catch (e) {
      reportError(e, { source: 'CaptureScreen', operation: 'sendToProfessional' });
      Alert.alert('Could not send', e.message);
    }
  };

  const resetAll = () => {
    setDescription('');
    setMedia([]);
    setTranscript('');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={resetAll} />
        }
      >
        {resumeCard && (
          <TouchableOpacity
            style={styles.resumeCard}
            onPress={() => navigation.navigate(resumeCard._list === 'contractor' ? 'ProjectDetail' : 'WorkshopSteps', { project: resumeCard, listType: resumeCard._list })}
          >
            <Icon name="play-circle" size={28} color={theme.colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.resumeLabel}>Resume where you left off</Text>
              <Text style={styles.resumeTitle} numberOfLines={1}>{resumeCard.title}</Text>
            </View>
            <Icon name="chevron-forward" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}

        <View style={styles.mainActionCard}>
        {/* Step 1: Capture */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>{t('capture_step1')}</Text>
          </View>

          <View style={styles.mediaGrid}>
            <TouchableOpacity style={styles.mediaCard} onPress={takePhoto} accessibilityLabel="Take a photo of your repair issue" accessibilityRole="button">
              <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Icon name="camera" size={28} color="#D97706" />
              </View>
              <Text style={styles.mediaLabel}>{t('take_photo')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.mediaCard} onPress={recordVideo} accessibilityLabel="Record a video of your repair issue" accessibilityRole="button">
              <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Icon name="videocam" size={28} color="#D97706" />
              </View>
              <Text style={styles.mediaLabel}>{t('record_video')}</Text>
            </TouchableOpacity>
          </View>

          {media.length > 0 && (
            <View style={styles.previewSection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewList}>
                {media.map((m, i) => (
                  <View key={i} style={styles.previewItem}>
                    {m.type === 'photo' ? (
                      <Image source={{ uri: m.uri }} style={styles.previewImage} />
                    ) : (
                      <View style={[styles.previewImage, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                        <Icon name="play" size={24} color="#fff" />
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.removeMedia}
                      onPress={() => setMedia(media.filter((_, index) => index !== i))}
                      accessibilityLabel={`Remove photo ${i + 1}`}
                      accessibilityRole="button"
                    >
                      <Icon name="close-circle" size={20} color={theme.colors.danger} />
                    </TouchableOpacity>
                    {m.type === 'photo' && (
                      <TouchableOpacity
                        style={styles.annotateMedia}
                        onPress={() => navigation.navigate('Annotate', { photoUri: m.uri, mediaIndex: i })}
                      >
                        <Icon name="brush-outline" size={14} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
              {media.some(m => m.labels && m.labels.length > 0) && (
                <ImageLabelsChip labels={media.flatMap(m => m.labels || []).filter((v, i, a) => a.findIndex(x => x.label === v.label) === i)} />
              )}
            </View>
          )}
        </View>

        {/* Step 2: Describe */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>{t('capture_step2')}</Text>
          </View>

          <TouchableOpacity
            style={[styles.voiceButtonHome, isRecording && styles.recordingHome]}
            onPress={isRecording ? stopRecording : startRecording}
            accessibilityLabel={isRecording ? "Stop voice recording" : "Describe your issue with voice"}
            accessibilityRole="button"
          >
            <Icon name={isRecording ? "stop" : "mic"} size={22} color="#fff" />
            <Text style={styles.voiceButtonTextHome}>
              {isRecording ? t('listening') : t('voice_note')}
            </Text>
          </TouchableOpacity>

          <TextInput
            style={styles.inputHome}
            placeholder={t('type_description_placeholder')}
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            value={isRecording ? (description ? `${description} ${transcript}` : transcript) : description}
            onChangeText={setDescription}
            accessibilityLabel="Describe your repair issue"
            accessibilityRole="text"
          />
        </View>

        {/* Step 3: Analyze */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepTitle}>{t('capture_step3')}</Text>
          </View>

          <ExtractedEntitiesBar entities={extractedEntities} />

          <TouchableOpacity
            style={[styles.analyzeButtonHome, (isAnalyzing || isClarifying || (!description && media.length === 0)) && styles.disabledButton]}
            onPress={handleAnalyze}
            disabled={isAnalyzing || isClarifying || (!description && media.length === 0)}
            accessibilityLabel="Get AI-powered DIY repair guide"
            accessibilityRole="button"
          >
            {(isAnalyzing || isClarifying) ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.analyzeButtonContent}>
                <Icon name="sparkles" size={20} color="#fff" />
                <Text style={styles.analyzeButtonTextHome}>{t('get_diy_guide')}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.proButtonHome, (!description && media.length === 0) && styles.disabledButton]}
            onPress={sendToProfessional}
            disabled={!description && media.length === 0}
            accessibilityLabel="Send request to a professional"
            accessibilityRole="button"
          >
            <Icon name="construct" size={20} color="#64748B" />
            <Text style={styles.proButtonTextHome}>{t('get_pro_help')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
             style={styles.resetButtonHome}
             onPress={resetAll}
           >
             <Icon name="refresh" size={16} color="#94A3B8" />
             <Text style={styles.resetButtonTextHome}>{t('start_over')}</Text>
           </TouchableOpacity>

        </View>
      </View>

      <View style={styles.footerInfo}>
        <Icon name="information-circle-outline" size={16} color={theme.colors.textSecondary} />
        <Text style={styles.footerText}>{t('app_subtitle')}</Text>
      </View>
      </ScrollView>

      {/* Clarifying questions modal (#11) */}
      <Modal visible={!!clarifyQuestions} animationType="slide" transparent>
        <View style={styles.clarifyOverlay}>
          <View style={styles.clarifyCard}>
            <Text style={styles.clarifyTitle}>A few quick questions</Text>
            <Text style={styles.clarifySub}>Answering these helps me give you a much better guide.</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {clarifyQuestions?.map((q, i) => (
                <View key={i} style={{ marginTop: 14 }}>
                  <Text style={styles.clarifyQ}>{i + 1}. {q.q}</Text>
                  {q.why ? <Text style={styles.clarifyWhy}>{q.why}</Text> : null}
                  <TextInput
                    style={styles.clarifyInput}
                    value={clarifyAnswers[i] || ''}
                    onChangeText={(v) => setClarifyAnswers({ ...clarifyAnswers, [i]: v })}
                    placeholder="Your answer..."
                    placeholderTextColor={theme.colors.textSecondary}
                    multiline
                  />
                  {Array.isArray(q.options) && q.options.length > 0 && (
                    <View style={styles.clarifyOptionRow}>
                      {q.options.slice(0, 4).map((opt, oi) => (
                        <TouchableOpacity key={oi} style={styles.clarifyOption} onPress={() => setClarifyAnswers({ ...clarifyAnswers, [i]: opt })}>
                          <Text style={styles.clarifyOptionText}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={styles.clarifyActions}>
              <TouchableOpacity style={styles.clarifySkip} onPress={() => runAnalyze()} disabled={isAnalyzing}>
                <Text style={styles.clarifySkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clarifyGo} onPress={submitClarifyAnswers} disabled={isAnalyzing}>
                {isAnalyzing ? <ActivityIndicator color="#fff" /> : <Text style={styles.clarifyGoText}>Continue</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCamera} animationType="slide">
        <View style={styles.cameraContainer}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back">
            <View style={styles.cameraControls}>
              <TouchableOpacity style={styles.cameraCancelButton} onPress={() => {
                if (isRecordingVideo) cameraRef.current?.stopRecording();
                setShowCamera(false);
                setCameraMode('photo');
                setIsRecordingVideo(false);
              }}>
                <Icon name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cameraShutterButton, cameraMode === 'video' && styles.videoShutterButton]}
                onPress={cameraMode === 'photo' ? capturePhoto : toggleVideoRecording}
              >
                {cameraMode === 'video' && isRecordingVideo ? (
                  <View style={styles.videoStopInner} />
                ) : (
                  <View style={[styles.cameraShutterInner, cameraMode === 'video' && styles.videoShutterInner]} />
                )}
              </TouchableOpacity>
              <View style={{ width: 50 }} />
            </View>
          </CameraView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC', // slate-50
  },
  contentContainer: {
    padding: 20,
    paddingTop: 10,
    paddingBottom: 120, // Increased to allow button to be scrolled above keyboard
  },
  mainActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
    marginTop: -20, // Negative margin to overlap with header like in Home.jsx
  },
  stepSection: {
    marginBottom: 24,
    gap: 12,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEF3C7', // amber-100
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#D97706', // amber-700
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B', // slate-800
  },
  mediaGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  mediaCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F1F5F9', // slate-100
    borderRadius: 16,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  mediaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155', // slate-700
  },
  previewSection: {
    marginTop: 8,
  },
  previewList: {
    flexDirection: 'row',
  },
  previewItem: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 10,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 11,
  },
  removeMedia: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  annotateMedia: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 4,
  },
  voiceButtonHome: {
    backgroundColor: theme.colors.secondary,
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  recordingHome: {
    backgroundColor: theme.colors.danger,
  },
  voiceButtonTextHome: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  inputHome: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    fontSize: 14,
    color: '#1E293B',
  },
  analyzeButtonHome: {
    backgroundColor: theme.colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  disabledButton: {
    backgroundColor: '#CBD5E1', // slate-300
    shadowOpacity: 0,
    elevation: 0,
  },
  analyzeButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analyzeButtonTextHome: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  proButtonHome: {
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  proButtonTextHome: {
    color: '#475569', // slate-600
    fontSize: 14,
    fontWeight: '600',
  },
  resetButtonHome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  resetButtonTextHome: {
    color: '#94A3B8', // slate-400
    fontSize: 13,
    fontWeight: '500',
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 5,
  },
  footerText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingBottom: 40,
  },
  cameraCancelButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraShutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraShutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
  videoShutterButton: {
    borderColor: '#FF3B30',
  },
  videoShutterInner: {
    backgroundColor: '#FF3B30',
  },
  videoStopInner: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  resumeCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0',
  },
  resumeLabel: { fontSize: 11, color: '#64748B', fontWeight: '700', textTransform: 'uppercase' },
  resumeTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  clarifyOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  clarifyCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20 },
  clarifyTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  clarifySub: { fontSize: 13, color: '#64748B', marginTop: 4 },
  clarifyQ: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  clarifyWhy: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic', marginTop: 2 },
  clarifyInput: {
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 12, padding: 10, marginTop: 6, color: '#0F172A', minHeight: 40,
  },
  clarifyOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  clarifyOption: { backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  clarifyOptionText: { color: '#3730A3', fontSize: 12, fontWeight: '600' },
  clarifyActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  clarifySkip: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  clarifySkipText: { color: '#64748B', fontWeight: '700' },
  clarifyGo: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center' },
  clarifyGoText: { color: '#fff', fontWeight: '800' },
});
