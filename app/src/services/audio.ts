// Unified audio recording & playback service using expo-audio (Expo SDK 55)
// This replaces any former usage of react-native-audio-recorder-player.

// NOTE: This module appears unused (no imports anywhere in src/). The
// original JS imported `Audio` from 'expo-audio', but SDK 55 does not expose
// that named export — this code would not run if called. Kept as .ts for now
// so Phase 1 migration stays complete; consider deleting outright.
//
// expo-audio's TS types are inconsistent across SDK versions; cast loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _ExpoAudio: unknown = (require('expo-audio') as { Audio?: unknown }).Audio;

type AudioNamespace = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  setAudioModeAsync: (opts: Record<string, unknown>) => Promise<void>;
  Recording: new () => AudioRecording;
  AndroidOutputFormat: Record<string, number>;
  AndroidAudioEncoder: Record<string, number>;
  IOSOutputFormat: Record<string, number>;
  IOSAudioQuality: Record<string, number>;
  Sound: {
    createAsync: (
      source: { uri: string },
      initialStatus?: Record<string, unknown>,
      onPlaybackStatusUpdate?: PlaybackStatusCallback,
    ) => Promise<{ sound: AudioSound }>;
  };
};

interface AudioRecording {
  prepareToRecordAsync: (options: RecordingOptions) => Promise<void>;
  startAsync: () => Promise<void>;
  stopAndUnloadAsync: () => Promise<void>;
  getURI?: () => string | null;
}

interface AudioSound {
  unloadAsync: () => Promise<void>;
  stopAsync: () => Promise<void>;
}

export type PlaybackStatusCallback = (status: unknown) => void;

export interface RecordingUserOptions {
  androidOutputFormat?: number;
  androidEncoder?: number;
  iosQuality?: number;
  extension?: string;
}

interface RecordingOptions {
  android: {
    extension: string;
    outputFormat: number;
    audioEncoder: number;
    sampleRate: number;
    numberOfChannels: number;
    bitRate: number;
  };
  ios: {
    extension: string;
    outputFormat: number;
    audioQuality: number;
    sampleRate: number;
    numberOfChannels: number;
    bitRate: number;
    linearPCMBitDepth: number;
    linearPCMIsBigEndian: boolean;
    linearPCMIsFloat: boolean;
  };
  web: Record<string, never>;
}

const Audio = _ExpoAudio as unknown as AudioNamespace;

let currentRecording: AudioRecording | null = null;
let currentSound: AudioSound | null = null;

export async function requestAudioPermissionsAsync(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

export async function startRecording(options: RecordingUserOptions = {}): Promise<AudioRecording> {
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
  const RECORDING_OPTIONS: RecordingOptions = {
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

export async function stopRecording(): Promise<string | null> {
  if (!currentRecording) return null;
  try {
    await currentRecording.stopAndUnloadAsync();
    const uri = currentRecording.getURI?.() ?? null;
    currentRecording = null;
    return uri;
  } catch {
    // In case recording was already stopped
    const uri = currentRecording?.getURI?.() ?? null;
    currentRecording = null;
    return uri;
  }
}

export async function play(
  uri: string,
  onPlaybackStatusUpdate?: PlaybackStatusCallback,
): Promise<AudioSound> {
  if (!uri) throw new Error('No URI provided for playback');
  if (currentSound) {
    try { await currentSound.unloadAsync(); } catch {}
    currentSound = null;
  }
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onPlaybackStatusUpdate);
  currentSound = sound;
  return sound;
}

export async function stopPlayback(): Promise<void> {
  if (currentSound) {
    try { await currentSound.stopAsync(); } catch {}
    try { await currentSound.unloadAsync(); } catch {}
    currentSound = null;
  }
}
