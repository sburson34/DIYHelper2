import React, { useState } from 'react';
import { View, Image, ActivityIndicator, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { API_BASE_URL } from '../config/api';
import theme from '../theme';

type Props = {
  /** Server media URL — absolute, or API-relative ("/api/.../media/before"). */
  uri?: string | null;
  /**
   * Base64 payload. Takes precedence over `uri`: a freshly captured photo
   * (or a queued offline tech patch) must show instantly and survive offline,
   * and legacy rows still ship base64 during the S3 dual-read window.
   */
  base64?: string | null;
  /** Auth headers for protected media routes (tech bearer, device headers). */
  headers?: Record<string, string>;
  mimeType?: string;
  style?: object;
  testID?: string;
};

/**
 * Job-photo renderer for the base64 → S3-URL migration. Prefers local/legacy
 * base64, falls back to the authenticated media URL with a spinner while
 * loading and a tap-to-retry state on failure (expired presigned links render
 * as silent blanks otherwise — retry re-requests through the API proxy).
 */
export default function RemoteImage({ uri, base64, headers, mimeType = 'image/jpeg', style, testID }: Props) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (base64) {
    return <Image testID={testID} style={style} source={{ uri: `data:${mimeType};base64,${base64}` }} />;
  }

  if (!uri) {
    return (
      <View testID={testID} style={[styles.placeholder, style]}>
        <Icon name="image-outline" size={28} color={theme.colors.border} />
      </View>
    );
  }

  const absolute = uri.startsWith('/') ? `${API_BASE_URL}${uri}` : uri;
  // Cache-busting query param forces RN's image cache past a failed/expired fetch.
  const src = attempt > 0 ? `${absolute}${absolute.includes('?') ? '&' : '?'}retry=${attempt}` : absolute;

  if (failed) {
    return (
      <TouchableOpacity
        testID={testID}
        style={[styles.placeholder, style]}
        onPress={() => { setFailed(false); setAttempt((a) => a + 1); }}
        accessibilityRole="button"
      >
        <Icon name="refresh" size={24} color={theme.colors.textSecondary} />
        <Text style={styles.retryText}>Tap to retry</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={style}>
      <Image
        testID={testID}
        style={StyleSheet.absoluteFill}
        source={{ uri: src, headers }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true); }}
      />
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.background,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
  },
  retryText: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
