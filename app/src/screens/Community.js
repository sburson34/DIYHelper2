// Community library (#18). Browse and search anonymized projects shared by other users.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { browseCommunityProjects } from '../api/backendClient';
import theme from '../theme';

export default function Community({ navigation }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      const results = await browseCommunityProjects(q);
      setItems(results || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Text style={styles.subtitle}>Projects shared by other DIYers.</Text>
        <View style={styles.searchRow}>
          <Icon name="search" size={18} color={theme.colors.textSecondary} />
          <TextInput
            style={styles.search}
            placeholder="Search projects..."
            placeholderTextColor={theme.colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query)}
            returnKeyType="search"
          />
        </View>
      </View>
      {loading && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 20 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id || i.title}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          !loading && (
            <View style={styles.empty}>
              <Icon name="people-outline" size={64} color={theme.colors.border} />
              <Text style={styles.emptyText}>No community projects yet. Be the first to share one!</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('NewProject', { screen: 'Result', params: { project: item } })}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            {item.description ? <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text> : null}
            <View style={styles.cardMeta}>
              {item.difficulty ? <Text style={styles.metaText}>{item.difficulty}</Text> : null}
              {item.estimated_time ? <Text style={styles.metaText}>· {item.estimated_time}</Text> : null}
              {item.estimated_cost ? <Text style={styles.metaText}>· {item.estimated_cost}</Text> : null}
            </View>
          </TouchableOpacity>
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 12, paddingHorizontal: 12, marginTop: 12,
  },
  search: { flex: 1, padding: 10, color: theme.colors.text },
  error: { color: theme.colors.danger, padding: 16 },
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardTitle: { fontWeight: '800', color: theme.colors.text, fontSize: 16 },
  cardDesc: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  metaText: { fontSize: 12, color: theme.colors.textSecondary },
  empty: { alignItems: 'center', marginTop: 60, padding: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
});
