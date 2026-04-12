// Full-screen AR camera view for workshop step guidance.
// Overlays pose detection landmarks and contextual guides on the camera feed.

import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import PoseOverlay from '../components/PoseOverlay';
import ARGuideOverlay from '../components/ARGuideOverlay';
import { usePoseDetection } from '../mlkit/poseDetection';
import theme from '../theme';

let Camera;
try {
  Camera = require('react-native-vision-camera').Camera;
} catch {
  Camera = null;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function WorkshopARScreen({ navigation, route }) {
  const { stepText, stepIndex, projectTitle } = route.params || {};
  const { pose, onFrame, start, stop, available } = usePoseDetection(3);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  if (!Camera || !available) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Icon name="body-outline" size={64} color={theme.colors.textSecondary} />
        <Text style={styles.fallbackText}>
          AR guides require a camera with pose detection support.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        device="front"
        isActive={true}
        // Frame processor would be wired here for real-time pose detection
        // frameProcessor={onFrame}
      />

      <PoseOverlay
        pose={pose}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
      />

      <ARGuideOverlay
        pose={pose}
        stepText={stepText}
      />

      {/* Step text bar */}
      <View style={styles.stepBar}>
        <Text style={styles.stepLabel}>Step {(stepIndex || 0) + 1}</Text>
        <Text style={styles.stepText} numberOfLines={3}>{stepText}</Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={() => navigation.goBack()}>
          <Icon name="close" size={24} color="#fff" />
          <Text style={styles.controlText}>Close</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.doneBtn]}
          onPress={() => {
            navigation.navigate('WorkshopSteps', { completedStepIndex: stepIndex });
          }}
        >
          <Icon name="checkmark" size={24} color="#fff" />
          <Text style={styles.controlText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  stepBar: {
    position: 'absolute', top: 60, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, padding: 16,
  },
  stepLabel: { color: theme.colors.primary, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  stepText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  controls: {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 24,
  },
  controlBtn: {
    alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24,
  },
  doneBtn: { backgroundColor: theme.colors.primary },
  controlText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  fallback: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: theme.colors.background, padding: 40,
  },
  fallbackText: {
    textAlign: 'center', color: theme.colors.textSecondary,
    fontSize: 15, marginTop: 16, lineHeight: 22,
  },
  backBtn: {
    marginTop: 24, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: theme.colors.primary, borderRadius: 12,
  },
  backBtnText: { color: '#fff', fontWeight: '700' },
});
