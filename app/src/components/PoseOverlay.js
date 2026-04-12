// Renders detected pose landmarks as circles with connecting skeleton lines.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SKELETON_CONNECTIONS } from '../mlkit/poseDetection';

const JOINT_SIZE = 8;
const LINE_WIDTH = 2;
const JOINT_COLOR = '#34C759';
const LINE_COLOR = 'rgba(52, 199, 89, 0.6)';

export default function PoseOverlay({ pose, width, height }) {
  if (!pose || !pose.landmarks) return null;

  const landmarks = pose.landmarks;

  // Scale landmark coordinates to overlay dimensions
  const scale = (lm) => {
    if (!lm) return null;
    return {
      x: (lm.x / (pose.imageWidth || 1)) * width,
      y: (lm.y / (pose.imageHeight || 1)) * height,
    };
  };

  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      {/* Skeleton lines */}
      {SKELETON_CONNECTIONS.map(([fromIdx, toIdx], i) => {
        const from = scale(landmarks[fromIdx]);
        const to = scale(landmarks[toIdx]);
        if (!from || !to) return null;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <View
            key={`line-${i}`}
            style={{
              position: 'absolute',
              left: from.x,
              top: from.y - LINE_WIDTH / 2,
              width: length,
              height: LINE_WIDTH,
              backgroundColor: LINE_COLOR,
              borderRadius: LINE_WIDTH / 2,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: 'left center',
            }}
          />
        );
      })}

      {/* Joint dots */}
      {landmarks.map((lm, i) => {
        const pos = scale(lm);
        if (!pos) return null;
        return (
          <View
            key={`joint-${i}`}
            style={[styles.joint, {
              left: pos.x - JOINT_SIZE / 2,
              top: pos.y - JOINT_SIZE / 2,
            }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  joint: {
    position: 'absolute',
    width: JOINT_SIZE,
    height: JOINT_SIZE,
    borderRadius: JOINT_SIZE / 2,
    backgroundColor: JOINT_COLOR,
    borderWidth: 1,
    borderColor: '#fff',
  },
});
