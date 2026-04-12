// Horizontal scrollable bar of extracted entity chips.
// Tappable: phone → call, address → maps.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';

const TYPE_CONFIG = {
  date: { icon: 'calendar-outline', color: '#7C3AED' },
  money: { icon: 'cash-outline', color: '#059669' },
  phone: { icon: 'call-outline', color: '#2563EB' },
  address: { icon: 'location-outline', color: '#DC2626' },
  measurement: { icon: 'resize-outline', color: '#D97706' },
  other: { icon: 'information-circle-outline', color: theme.colors.textSecondary },
};

export default function ExtractedEntitiesBar({ entities }) {
  if (!entities || entities.length === 0) return null;

  const handlePress = (entity) => {
    if (entity.type === 'phone') {
      Linking.openURL(`tel:${entity.text.replace(/[^\d+]/g, '')}`);
    } else if (entity.type === 'address') {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(entity.text)}`);
    }
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.container}>
      {entities.map((entity, idx) => {
        const config = TYPE_CONFIG[entity.type] || TYPE_CONFIG.other;
        const tappable = entity.type === 'phone' || entity.type === 'address';
        const Wrapper = tappable ? TouchableOpacity : View;
        return (
          <Wrapper
            key={idx}
            style={[styles.chip, { borderColor: config.color + '40' }]}
            {...(tappable ? { onPress: () => handlePress(entity) } : {})}
          >
            <Icon name={config.icon} size={14} color={config.color} />
            <Text style={[styles.chipText, { color: config.color }]} numberOfLines={1}>
              {entity.text}
            </Text>
          </Wrapper>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', marginVertical: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
    maxWidth: 200,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
