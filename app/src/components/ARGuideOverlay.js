// Interprets pose data in the context of a workshop step.
// Shows green/red indicators based on body position relative to step requirements.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { isWristAboveShoulder } from '../mlkit/poseDetection';
import theme from '../theme';

export default function ARGuideOverlay({ pose, stepText }) {
  if (!pose) return null;

  // Simple heuristics for common DIY positions
  const rightWristUp = isWristAboveShoulder(pose, 'right');
  const leftWristUp = isWristAboveShoulder(pose, 'left');
  const armsRaised = rightWristUp || leftWristUp;

  // Detect step keywords for contextual guidance
  const lowerStep = (stepText || '').toLowerCase();
  const needsReach = lowerStep.includes('overhead') || lowerStep.includes('ceiling') || lowerStep.includes('above');
  const needsLevel = lowerStep.includes('level') || lowerStep.includes('eye level') || lowerStep.includes('straight');

  let guidanceIcon = 'body-outline';
  let guidanceText = 'Position detected';
  let guidanceColor = '#34C759';

  if (needsReach) {
    if (armsRaised) {
      guidanceText = 'Good reach position';
      guidanceIcon = 'checkmark-circle';
    } else {
      guidanceText = 'Raise arms for overhead work';
      guidanceIcon = 'arrow-up-circle';
      guidanceColor = '#FF9500';
    }
  } else if (needsLevel) {
    if (armsRaised) {
      guidanceText = 'Arms at good height';
      guidanceIcon = 'checkmark-circle';
    } else {
      guidanceText = 'Raise tool to working height';
      guidanceIcon = 'arrow-up-circle';
      guidanceColor = '#FF9500';
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: guidanceColor + '20', borderColor: guidanceColor }]}>
        <Icon name={guidanceIcon} size={18} color={guidanceColor} />
        <Text style={[styles.text, { color: guidanceColor }]}>{guidanceText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
  },
});
