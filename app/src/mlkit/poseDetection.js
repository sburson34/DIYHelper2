// Pose detection via ML Kit for AR workshop guides.
// Returns body landmarks from the camera feed in real-time.

import { useState, useCallback, useRef } from 'react';
import { addBreadcrumb, reportHandledError } from '../services/monitoring';

let detectPoseNative;
try {
  const mlkit = require('react-native-vision-camera-mlkit');
  detectPoseNative = mlkit.usePoseDetection || mlkit.detectPose;
} catch {
  detectPoseNative = null;
}

export const isPoseDetectionAvailable = () => detectPoseNative != null;

/**
 * Pose landmark indices (ML Kit standard).
 */
export const LANDMARKS = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

/**
 * Connections to draw between landmarks.
 */
export const SKELETON_CONNECTIONS = [
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
  [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
  [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
  [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
  [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
  [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],
];

/**
 * Hook for pose detection. Returns the latest pose data and a frame processor callback.
 * Processes every Nth frame to manage CPU load.
 */
export const usePoseDetection = (frameSkip = 3) => {
  const [pose, setPose] = useState(null);
  const frameCount = useRef(0);

  const onFrame = useCallback((frame) => {
    frameCount.current++;
    if (frameCount.current % frameSkip !== 0) return;

    if (!detectPoseNative) return;
    try {
      const result = detectPoseNative(frame);
      if (result && result.landmarks) {
        setPose(result);
      }
    } catch (error) {
      // Don't report every frame failure, just log once
      if (frameCount.current === frameSkip) {
        reportHandledError('MLKit_pose_frame', error, { feature: 'poseDetection' });
      }
    }
  }, [frameSkip]);

  const start = useCallback(() => {
    addBreadcrumb('mlkit: pose detection started', 'mlkit', { feature: 'poseDetection' });
    frameCount.current = 0;
  }, []);

  const stop = useCallback(() => {
    addBreadcrumb('mlkit: pose detection stopped', 'mlkit', { feature: 'poseDetection' });
    setPose(null);
  }, []);

  return { pose, onFrame, start, stop, available: isPoseDetectionAvailable() };
};

/**
 * Check if wrist is above shoulder (useful for "hold at eye level" guides).
 */
export const isWristAboveShoulder = (pose, side = 'right') => {
  if (!pose || !pose.landmarks) return false;
  const wristIdx = side === 'left' ? LANDMARKS.LEFT_WRIST : LANDMARKS.RIGHT_WRIST;
  const shoulderIdx = side === 'left' ? LANDMARKS.LEFT_SHOULDER : LANDMARKS.RIGHT_SHOULDER;
  const wrist = pose.landmarks[wristIdx];
  const shoulder = pose.landmarks[shoulderIdx];
  if (!wrist || !shoulder) return false;
  return wrist.y < shoulder.y; // y increases downward in image coordinates
};
