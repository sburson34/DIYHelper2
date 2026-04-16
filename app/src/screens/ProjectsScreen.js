import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import {
  getHoneyDoList, removeFromHoneyDoList,
  getContractorList, removeFromContractorList,
  getAppPrefs,
} from '../utils/storage';
import { browseCommunityProjects, getPropertyValueImpact } from '../api/backendClient';
import { cancelForProject } from '../utils/notifications';
import { useTranslation } from '../i18n/I18nContext';
import SegmentedControl from '../components/SegmentedControl';
import FilterPills from '../components/FilterPills';
import theme from '../theme';

const parseCost = (s) => {
  const matches = (s || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  const nums = matches.map(Number);
  return nums.length === 1 ? nums[0] : (nums[0] + nums[nums.length - 1]) / 2;
};

// Merged project list. Replaces the old HoneyDoList + ContractorList + Quotes
// + Community drawer entries. Two modes:
//   1. Mine — the user's saved projects, with a filter pill for All/DIY/Pros
//   2. Browse — community projects (opt-in shared projects from other users)
//
// When a Pros project is selected, the ROI badge is fetched lazily and shown
// on the card — same behavior as the old Contractors screen.

export default function ProjectsScreen({ navigation }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('mine');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [honey, setHoney] = useState([]);
  const [contractor, setContractor] = useState([]);
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [roiByProject, setRoiByProject] = useState({});

  const loadMine = useCallback(async () => {
    setRefreshing(true);
    const [h, c] = await Promise.all([getHoneyDoList(), getContractorList()]);
    setHoney(h || []);
    setContractor(c || []);
    setRefreshing(false);

    // Background: fetch ROI for pro projects with known repair_type
    try {
      const prefs = await getAppPrefs();
      const next = {};
      for (const p of c || []) {
        if (!p.repair_type) continue;
        const cost = parseCost(p.estimated_cost);
        if (!cost) continue;
        try {
          next[p.id] = await getPropertyValueImpact({
            zip: prefs.zip, repairType: p.repair_type, estimatedCost: cost,
          });
        } catch {}
      }
      setRoiByProject(next);
    } catch {}
  }, []);

  const loadCommunity = useCallback(async (q = '') => {
    setCommunityLoading(true);
    try {
      const list = await browseCommunityProjects(q);
      setCommunity(Array.isArray(list) ? list : []);
    } catch {
      setCommunity([]);
    } finally {
      setCommunityLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (mode === 'mine') loadMine();
      else loadCommunity(search);
    });
    return unsubscribe;
  }, [navigation, mode, loadMine, loadCommunity, search]);

  // Re-run community search when the search string changes while browsing
  useEffect(() => {
    if (mode !== 'browse') return;
    const handle = setTimeout(() => loadCommunity(search), 300);
    return () => clearTimeout(handle);
  }, [search, mode, loadCommunity]);

  // Compose + filter the "mine" list
  const mineItems = useMemo(() => {
    const honeyTagged = honey.map((p) => ({ ...p, _kind: 'diy' }));
    const contractorTagged = contractor.map((p) => ({ ...p, _kind: 'pro' }));
    let all = [...honeyTagged, ...contractorTagged];
    if (filter === 'diy') all = honeyTagged;
    if (filter === 'pros') all = contractorTagged;
    if (search.trim()) {
      const q = search.toLowerCase();
      all = all.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }
    // Newest first
    all.sort((a, b) => new Date(b.lastActivityAt || b.createdAt || 0) - new Date(a.lastActivityAt || a.createdAt || 0));
    return all;
  }, [honey, contractor, filter, search]);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      t('remove_project'),
      t('remove_project_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: async () => {
            try { await cancelForProject(item); } catch {}
            if (item._kind === 'diy') await removeFromHoneyDoList(item.id);
            else await removeFromContractorList(item.id);
            loadMine();
          },
        },
      ],
    );
  }, [t, loadMine]);

  const renderMineItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <TouchableOpacity
        style={styles.item}
        onPress={() => navigation.navigate('ProjectDetail', {
          project: item,
          listType: item._kind === 'diy' ? 'honey-do' : 'contractor',
        })}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item._kind === 'diy' ? 'DIY' : 'Pro'} project`}
      >
        <View style={styles.itemHeader}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
          <Icon name="chevron-forward" size={20} color={theme.colors.textSecondary} />
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.kindBadge, item._kind === 'pro' ? styles.proBadge : styles.diyBadge]}>
            <Icon
              name={item._kind === 'pro' ? 'hammer-outline' : 'construct-outline'}
              size={12}
              color={item._kind === 'pro' ? theme.colors.accent : theme.colors.primary}
              style={{ marginRight: 4 }}
            />
            <Text style={[
              styles.badgeText,
              { color: item._kind === 'pro' ? theme.colors.accent : theme.colors.primary },
            ]}>
              {item._kind === 'pro' ? t('pro_projects') : t('diy_projects')}
            </Text>
          </View>
          {item.estimated_cost && (
            <View style={styles.metaBadge}>
              <Icon name="cash-outline" size={12} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
              <Text style={styles.metaText}>{item.estimated_cost}</Text>
            </View>
          )}
          {item._kind === 'pro' && item.quoteStatus && (
            <View style={[styles.metaBadge, { backgroundColor: theme.colors.secondary + '15' }]}>
              <Text style={[styles.metaText, { color: theme.colors.secondary, fontWeight: '700' }]}>
                {item.quoteStatus}
              </Text>
            </View>
          )}
          {roiByProject[item.id] && roiByProject[item.id].estimatedValueAdd > 0 && (
            <View style={[styles.metaBadge, { backgroundColor: '#D1FAE5' }]}>
              <Icon name="trending-up" size={12} color="#065F46" style={{ marginRight: 4 }} />
              <Text style={[styles.metaText, { color: '#065F46', fontWeight: '700' }]}>
                +${Math.round(roiByProject[item.id].estimatedValueAdd).toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteIcon}
        onPress={() => handleDelete(item)}
        accessibilityLabel={`Delete ${item.title}`}
        accessibilityRole="button"
      >
        <Icon name="trash-outline" size={20} color={theme.colors.danger} />
      </TouchableOpacity>
    </View>
  );

  const renderBrowseItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.item, { marginBottom: 12 }]}
      onPress={() => navigation.navigate('Result', { project: item, originalRequest: {} })}
      accessibilityRole="button"
      accessibilityLabel={`Community project ${item.title}`}
    >
      <Text style={styles.itemTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
      {item.description ? (
        <Text style={styles.communityDesc} numberOfLines={2}>{item.description}</Text>
      ) : null}
      <View style={styles.badgeRow}>
        {item.difficulty && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaText}>{item.difficulty}</Text>
          </View>
        )}
        {item.estimated_time && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaText}>{item.estimated_time}</Text>
          </View>
        )}
        {item.estimated_cost && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaText}>{item.estimated_cost}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <SegmentedControl
          options={[
            { id: 'mine', label: t('my_projects') },
            { id: 'browse', label: t('browse_projects') },
          ]}
          selected={mode}
          onChange={(m) => { setMode(m); setSearch(''); }}
        />
      </View>

      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={theme.colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('search_placeholder') || 'Search projects…'}
          placeholderTextColor={theme.colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search projects"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {mode === 'mine' && (
        <FilterPills
          options={[
            { id: 'all', label: t('all_projects') },
            { id: 'diy', label: t('diy_projects') },
            { id: 'pros', label: t('pro_projects') },
          ]}
          selected={filter}
          onChange={setFilter}
        />
      )}

      {mode === 'mine' ? (
        <FlatList
          data={mineItems}
          keyExtractor={(item) => String(item.id || Math.random())}
          renderItem={renderMineItem}
          onRefresh={loadMine}
          refreshing={refreshing}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="folder-open-outline" size={80} color={theme.colors.border} />
              <Text style={styles.emptyText}>{t('no_projects_yet') || 'No projects yet. Start one from Home.'}</Text>
            </View>
          }
        />
      ) : (
        communityLoading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={community}
            keyExtractor={(item) => String(item.id || item.title)}
            renderItem={renderBrowseItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="people-outline" size={80} color={theme.colors.border} />
                <Text style={styles.emptyText}>{t('no_community_results') || 'No community projects found.'}</Text>
              </View>
            }
          />
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium,
  },
  searchInput: { flex: 1, padding: 10, color: theme.colors.text },
  listContent: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  itemContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  item: {
    flex: 1, backgroundColor: theme.colors.surface, padding: 16,
    borderRadius: theme.roundness.large,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  itemHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  itemTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, flex: 1, marginRight: 10 },
  communityDesc: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.roundness.medium,
    flexDirection: 'row', alignItems: 'center',
  },
  diyBadge: { backgroundColor: theme.colors.primary + '15' },
  proBadge: { backgroundColor: theme.colors.accent + '15' },
  metaBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.roundness.medium,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  metaText: { fontSize: 11, color: theme.colors.textSecondary },
  deleteIcon: { padding: 10 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 16, color: theme.colors.textSecondary, lineHeight: 22 },
});
