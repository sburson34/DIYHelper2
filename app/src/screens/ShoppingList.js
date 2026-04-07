// Aggregated shopping list across all active honey-do projects (#6, #7).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getHoneyDoList, getShoppingBought, setShoppingBought, getToolInventory } from '../utils/storage';
import theme from '../theme';

export default function ShoppingList({ navigation }) {
  const [items, setItems] = useState([]);
  const [bought, setBought] = useState({});

  const load = async () => {
    const projects = await getHoneyDoList();
    const inventory = (await getToolInventory()).map(i => i.name.toLowerCase());
    const boughtMap = await getShoppingBought();
    const map = new Map();
    for (const p of projects) {
      const links = Array.isArray(p.shopping_links) ? p.shopping_links : [];
      for (const sl of links) {
        const name = typeof sl === 'string' ? sl : sl.item;
        if (!name) continue;
        if (inventory.some(o => name.toLowerCase().includes(o))) continue; // skip owned
        const key = name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            key, name,
            amazon: typeof sl === 'object' ? sl.amazon_url : null,
            homedepot: typeof sl === 'object' ? sl.homedepot_url : null,
            projects: [p.title],
          });
        } else {
          map.get(key).projects.push(p.title);
        }
      }
    }
    setItems(Array.from(map.values()));
    setBought(boughtMap);
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  const toggle = async (key) => {
    const next = !bought[key];
    setBought({ ...bought, [key]: next });
    await setShoppingBought(key, next);
  };

  const remaining = items.filter(i => !bought[i.key]).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Shopping List</Text>
        <Text style={styles.subtitle}>{remaining} item{remaining === 1 ? '' : 's'} remaining across all projects</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="cart-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>No items yet. Save a project to your Honey-Do list and its materials will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, bought[item.key] && styles.rowDone]}>
            <TouchableOpacity onPress={() => toggle(item.key)} style={styles.checkBtn}>
              <Icon
                name={bought[item.key] ? 'checkmark-circle' : 'ellipse-outline'}
                size={26}
                color={bought[item.key] ? theme.colors.success : theme.colors.textSecondary}
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, bought[item.key] && styles.itemNameDone]}>{item.name}</Text>
              <Text style={styles.itemMeta}>For: {item.projects.join(', ')}</Text>
            </View>
            {item.amazon && (
              <TouchableOpacity onPress={() => Linking.openURL(item.amazon)} style={styles.linkBtn}>
                <Icon name="cart" size={18} color={theme.colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: theme.colors.surface, borderRadius: theme.roundness.medium,
    marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
  },
  rowDone: { opacity: 0.55 },
  checkBtn: { padding: 2 },
  itemName: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  itemNameDone: { textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  linkBtn: { padding: 8 },
  empty: { alignItems: 'center', marginTop: 60, padding: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
});
