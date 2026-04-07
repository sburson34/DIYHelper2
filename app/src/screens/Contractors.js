import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getContractorList, removeFromContractorList } from '../utils/storage';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function Contractors({ navigation }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(p => (p.title || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [items, search]);

  const totalCost = useMemo(() => {
    let total = 0;
    for (const p of items) {
      const matches = (p.estimated_cost || '').match(/\d+/g);
      if (matches && matches.length > 0) {
        const nums = matches.map(Number);
        const avg = nums.length === 1 ? nums[0] : (nums[0] + nums[nums.length - 1]) / 2;
        total += avg;
      }
    }
    return total;
  }, [items]);

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
      t('remove_project'),
      t('remove_project_msg'),
      [
        { text: t('cancel'), style: "cancel" },
        {
          text: t('remove'),
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
      {items.length > 0 && (
        <View style={styles.headerBar}>
          <View style={styles.searchRow}>
            <Icon name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search projects..."
              placeholderTextColor={theme.colors.textSecondary}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Icon name="close-circle" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {totalCost > 0 && (
            <Text style={styles.totalCost}>Estimated total: ~${totalCost.toFixed(0)}</Text>
          )}
        </View>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id || Math.random().toString()}
        onRefresh={loadItems}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="construct-outline" size={80} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('contractor_empty')}</Text>
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
                  <Text style={[styles.badgeText, { color: theme.colors.secondary }]}>{t('est_cost')}: {item.estimated_cost || t('not_available')}</Text>
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
  headerBar: { paddingHorizontal: 16, paddingTop: 12 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 12, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, padding: 10, color: theme.colors.text },
  totalCost: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'right' },
});
