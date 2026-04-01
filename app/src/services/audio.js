// Unified audio recording & playback service using expo-audio (Expo SDK 55)
// This replaces any former usage of react-native-audio-recorder-player.

import { Audio } from 'expo-audio';

let currentRecording = null;
let currentSound = null;

export async function requestAudioPermissionsAsync() {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

export async function startRecording(options = {}) {
  // options: { androidOutputFormat?, androidEncoder?, iosQuality?, extension? }
  // Defaults aim for high quality AAC/MP4
  const granted = await requestAudioPermissionsAsync();
  if (!granted) throw new Error('Microphone permission not granted');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: 1, // do not mix
    staysActiveInBackground: false,
  });

  const recording = new Audio.Recording();
  const RECORDING_OPTIONS = {
    android: {
      extension: options.extension || '.m4a',
      outputFormat: options.androidOutputFormat || Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: options.androidEncoder || Audio.AndroidAudioEncoder.AAC,
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    },
    ios: {
      extension: options.extension || '.m4a',
      outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
      audioQuality: options.iosQuality || Audio.IOSAudioQuality.HIGH,
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {},
  };

  await recording.prepareToRecordAsync(RECORDING_OPTIONS);
  await recording.startAsync();
  currentRecording = recording;
  return recording;
}

export async function stopRecording() {
  if (!currentRecording) return null;
  try {
    await currentRecording.stopAndUnloadAsync();
    const uri = currentRecording.getURI();
    currentRecording = null;
    return uri;
  } catch (e) {
    // In case recording was already stopped
    const uri = currentRecording?.getURI?.();
    currentRecording = null;
    return uri || null;
  }
}

export async function play(uri, onPlaybackStatusUpdate) {
  if (!uri) throw new Error('No URI provided for playback');
  if (currentSound) {
    try { await currentSound.unloadAsync(); } catch {}
    currentSound = null;
  }
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onPlaybackStatusUpdate);
  currentSound = sound;
  return sound;
}

export async function stopPlayback() {
  if (currentSound) {
    try { await currentSound.stopAsync(); } catch {}
    try { await currentSound.unloadAsync(); } catch {}
    currentSound = null;
  }
}
