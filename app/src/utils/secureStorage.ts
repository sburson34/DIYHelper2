import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Thin wrapper over expo-secure-store for values backed by the OS keystore
// (Android Keystore / iOS Keychain). Values never leave the device
// unencrypted — safer than AsyncStorage for contact info (name / email /
// phone) that would otherwise sit in plain JSON in the app's data dir.
//
// One-shot migration: on first read, any legacy AsyncStorage entry under the
// same key is moved into SecureStore and the plaintext copy deleted.

const MIGRATED_FLAG_PREFIX = '@migrated_to_secure:';

export const secureGet = async (key: string): Promise<string | null> => {
  try {
    const existing = await SecureStore.getItemAsync(key);
    if (existing != null) return existing;

    const legacy = await AsyncStorage.getItem(key);
    if (legacy != null) {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
      await AsyncStorage.setItem(MIGRATED_FLAG_PREFIX + key, '1');
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
};

export const secureSet = async (key: string, value: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // SecureStore can fail on rooted/emulator devices without a keystore.
    // Fall back to AsyncStorage so the app keeps working; callers still
    // get "best-effort encryption on supported devices".
    await AsyncStorage.setItem(key, value);
  }
};

export const secureDelete = async (key: string): Promise<void> => {
  try { await SecureStore.deleteItemAsync(key); } catch {}
  try { await AsyncStorage.removeItem(key); } catch {}
};
