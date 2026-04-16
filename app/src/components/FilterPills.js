import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import theme from '../theme';

// Horizontal row of pill-shaped filter buttons. Caller passes `options`
// like [{id:'all', label:'All'}, {id:'diy', label:'DIY'}] and a selected id.
// Scrolls horizontally if the pills overflow the row — good for filter sets
// that may grow later without breaking the layout.
export default function FilterPills({ options, selected, onChange, style }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
    >
      {options.map((opt) => {
        const active = opt.id === selected;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: theme.roundness.full,
    backgroundColor: theme.colors.background,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  pillActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  label: { color: theme.colors.textSecondary, fontWeight: '700', fontSize: 13 },
  labelActive: { color: '#fff' },
});
