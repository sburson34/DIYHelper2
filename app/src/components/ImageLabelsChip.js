// Displays ML Kit-detected labels as pill badges under a photo preview.

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import theme from '../theme';

export default function ImageLabelsChip({ labels }) {
  if (!labels || labels.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.container}>
      {labels.map((item, idx) => (
        <View key={idx} style={styles.chip}>
          <Text style={styles.chipText}>{item.label}</Text>
          <Text style={styles.chipScore}>{Math.round(item.confidence * 100)}%</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.colors.secondary + '18',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.secondary,
  },
  chipScore: {
    fontSize: 9,
    color: theme.colors.textSecondary,
  },
});
