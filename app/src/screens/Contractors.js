import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, SafeAreaView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getContractorList, removeFromContractorList } from '../utils/storage';
import theme from '../theme';

export default function Contractors({ navigation }) {
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadItems();
    });
    return unsubscribe;
  }, [navigation]);

  const loadItems = async () => {
    setRefreshing(true);
    const list = await getContractorList();
    setItems(list || []);
    setRefreshing(false);
  };

  const handleDelete = (id) => {
    Alert.alert(
      "Remove Project",
      "Are you sure you want to remove this project?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const success = await removeFromContractorList(id);
            if (success) {
              loadItems();
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id || Math.random().toString()}
        onRefresh={loadItems}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="construct-outline" size={80} color={theme.colors.border} />
            <Text style={styles.emptyText}>No active contractor projects. Keeping it DIY? 💪</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemContainer}>
            <TouchableOpacity
              style={styles.item}
              onPress={() => navigation.navigate('ProjectDetail', { project: item, listType: 'contractor' })}
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Icon name="chevron-forward" size={20} color={theme.colors.secondary} />
              </View>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: theme.colors.secondary + '20' }]}>
                  <Icon name="cash-outline" size={14} color={theme.colors.secondary} style={{ marginRight: 4 }} />
                  <Text style={[styles.badgeText, { color: theme.colors.secondary }]}>Est. Cost: {item.estimated_cost || 'N/A'}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteIcon}
              onPress={() => handleDelete(item.id)}
            >
              <Icon name="trash-outline" size={20} color={theme.colors.danger} />
            </TouchableOpacity>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  item: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    padding: 20,
    borderRadius: theme.roundness.large,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  deleteIcon: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.text,
    flex: 1,
    marginRight: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.roundness.medium,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    paddingHorizontal: 40,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    lineHeight: 26,
  },
});
