import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Ionicons as Icon } from '@expo/vector-icons';
import { analyzeProject } from '../api/backendClient';
import theme from '../theme';

export default function CaptureScreen({ navigation, route }) {
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState('');

  useSpeechRecognitionEvent('result', (event) => {
    // Safely check for results. transcript is usually results[0].transcript
    const transcriptValue = event.results?.[0]?.transcript || '';
    setTranscript(transcriptValue);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsRecording(false);
    if (transcript) {
      setDescription((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setTranscript('');
    }
  });

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

  const takePhoto = () => {
    launchCamera({ mediaType: 'photo', quality: 0.5, maxWidth: 1024, maxHeight: 1024, includeBase64: true }, (response) => {
      if (response.assets) {
        setMedia([...media, ...response.assets.map(a => ({
          uri: a.uri,
          type: 'photo',
          base64: a.base64,
          mimeType: a.type
        }))]);
      }
    });
  };

  const recordVideo = () => {
    launchCamera({ mediaType: 'video', videoQuality: 'low' }, (response) => {
      if (response.assets) {
        setMedia([...media, ...response.assets.map(a => ({
          uri: a.uri,
          type: 'video',
          mimeType: a.type
        }))]);
      }
    });
  };

  const startRecording = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert('Permission denied', 'Speech recognition permission is required.');
        return;
      }

      setTranscript('');
      setIsRecording(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
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

  const handleAnalyze = async () => {
    if (!description && media.length === 0) {
      Alert.alert("Missing Info", "Please add photos/videos or describe the issue first.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const mediaItems = media.map(m => ({
        uri: m.uri,
        base64: m.base64,
        mimeType: m.mimeType,
        type: m.type
      }));
      const result = await analyzeProject(description, mediaItems);
      navigation.navigate('Result', {
        project: result,
        originalRequest: { description, mediaUrls: media.map(m => m.uri) }
      });
    } catch (error) {
      Alert.alert("Analysis Error", error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sendToProfessional = () => {
    if (!description && media.length === 0) {
      Alert.alert("Missing Info", "Please add photos/videos or describe the issue first.");
      return;
    }
    Alert.alert("Send to Professional", "Your request is being sent to a home repair specialist.");
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
        <View style={styles.mainActionCard}>
        {/* Step 1: Capture */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>Capture the Issue</Text>
          </View>

          <View style={styles.mediaGrid}>
            <TouchableOpacity style={styles.mediaCard} onPress={takePhoto}>
              <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Icon name="camera" size={28} color="#D97706" />
              </View>
              <Text style={styles.mediaLabel}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.mediaCard} onPress={recordVideo}>
              <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Icon name="videocam" size={28} color="#D97706" />
              </View>
              <Text style={styles.mediaLabel}>Record Video</Text>
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
                    >
                      <Icon name="close-circle" size={20} color={theme.colors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Step 2: Describe */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>Describe the Problem</Text>
          </View>

          <TouchableOpacity
            style={[styles.voiceButtonHome, isRecording && styles.recordingHome]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <Icon name={isRecording ? "stop" : "mic"} size={22} color="#fff" />
            <Text style={styles.voiceButtonTextHome}>
              {isRecording ? "Listening..." : "Voice Note"}
            </Text>
          </TouchableOpacity>

          <TextInput
            style={styles.inputHome}
            placeholder="Or type your description here..."
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            value={isRecording ? (description ? `${description} ${transcript}` : transcript) : description}
            onChangeText={setDescription}
          />
        </View>

        {/* Step 3: Analyze */}
        <View style={styles.stepSection}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepTitle}>Get Your Fix</Text>
          </View>

          <TouchableOpacity
            style={[styles.analyzeButtonHome, (isAnalyzing || (!description && media.length === 0)) && styles.disabledButton]}
            onPress={handleAnalyze}
            disabled={isAnalyzing || (!description && media.length === 0)}
          >
            {isAnalyzing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.analyzeButtonContent}>
                <Icon name="sparkles" size={20} color="#fff" />
                <Text style={styles.analyzeButtonTextHome}>Get DIY Repair Guide</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.proButtonHome, (!description && media.length === 0) && styles.disabledButton]}
            onPress={sendToProfessional}
            disabled={!description && media.length === 0}
          >
            <Icon name="construct" size={20} color="#64748B" />
            <Text style={styles.proButtonTextHome}>Get Help From Professional</Text>
          </TouchableOpacity>

          <TouchableOpacity
             style={styles.resetButtonHome}
             onPress={resetAll}
           >
             <Icon name="refresh" size={16} color="#94A3B8" />
             <Text style={styles.resetButtonTextHome}>Start Over</Text>
           </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footerInfo}>
        <Icon name="information-circle-outline" size={16} color={theme.colors.textSecondary} />
        <Text style={styles.footerText}>AI Home Repair Assistant</Text>
      </View>
      </ScrollView>
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
});
