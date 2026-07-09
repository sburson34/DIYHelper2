import * as ImagePicker from 'expo-image-picker';

export interface PickedPhoto {
  uri: string;
  base64: string;
  mimeType: string;
}

const toPicked = (res: ImagePicker.ImagePickerResult): PickedPhoto | null => {
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  if (!a.base64) return null;
  return { uri: a.uri, base64: a.base64, mimeType: a.mimeType || 'image/jpeg' };
};

// Prompt for a single photo via the system camera or library, compressed and
// base64-encoded for upload. Returns null on cancel or denied permission — the
// caller treats a photo as optional, so this never throws. Kept separate from
// CaptureScreen's full expo-camera UI: the booking/triage flows only need a
// quick one-shot pick, not the in-app camera with ML-Kit labeling.
export const pickPhoto = async (source: 'camera' | 'library'): Promise<PickedPhoto | null> => {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return null;
      return toPicked(
        await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, mediaTypes: ['images'] }),
      );
    }
    return toPicked(
      await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true, mediaTypes: ['images'] }),
    );
  } catch {
    return null;
  }
};
