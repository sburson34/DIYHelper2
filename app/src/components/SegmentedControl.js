import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import theme from '../theme';

// iOS-style segmented control. Takes the full width, uses equal-width
// segments, and highlights the selected option with the primary color.
// Used in places where the user has exactly 2 or 3 related options
// (e.g. Tools I own / Shopping list, Mine / Browse).
export default function SegmentedControl({ options, selected, onChange, style }) {
  return (
    <View style={[styles.container, style]}>
      {options.map((opt) => {
        const active = opt.id === selected;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.medium,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.roundness.medium - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: theme.colors.surface,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  label: { color: theme.colors.textSecondary, fontWeight: '700', fontSize: 14 },
  labelActive: { color: theme.colors.text },
});
