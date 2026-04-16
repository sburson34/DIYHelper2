import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';

// "…" overflow menu. Replaces rows of 4-6 secondary action buttons.
// Caller passes `actions` = [{ id, label, icon, onPress, destructive? }]
// The menu opens as a bottom sheet. Each action auto-closes the menu on tap.

export default function ActionMenu({ actions, triggerStyle, triggerIcon = 'ellipsis-horizontal', accessibilityLabel = 'More actions' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, triggerStyle]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
      >
        <Icon name={triggerIcon} size={22} color={theme.colors.text} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {actions.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={styles.row}
                onPress={() => {
                  setOpen(false);
                  // Give the modal a frame to close before the action runs
                  // so the user sees the close animation instead of a freeze.
                  setTimeout(() => a.onPress(), 50);
                }}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                {a.icon ? (
                  <Icon
                    name={a.icon}
                    size={22}
                    color={a.destructive ? theme.colors.danger : theme.colors.text}
                  />
                ) : <View style={{ width: 22 }} />}
                <Text style={[styles.rowLabel, a.destructive && { color: theme.colors.danger }]}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.row, styles.cancelRow]}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.rowLabel, { color: theme.colors.textSecondary, fontWeight: '700' }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    padding: 8, borderRadius: theme.roundness.full,
    backgroundColor: theme.colors.background,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.roundness.large,
    borderTopRightRadius: theme.roundness.large,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingVertical: 16, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  rowLabel: { fontSize: 16, color: theme.colors.text, fontWeight: '600' },
  cancelRow: { borderBottomWidth: 0, justifyContent: 'center' },
});
