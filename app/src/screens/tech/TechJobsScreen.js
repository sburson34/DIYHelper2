// Tech-mode job list — the technician's assigned jobs, active first. Shows the
// cached list instantly (works offline), refreshes online, and flushes any
// queued field updates on focus. A pending-sync badge appears when updates are
// waiting for a connection.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { techListJobs } from '../../api/backendClient';
import { flushQueue, getJobsCache, saveJobsCache, pendingCount } from '../../tech/techQueue';
import { useTechAuth } from '../../tech/TechAuthContext';
import { useTranslation } from '../../i18n/I18nContext';
import theme from '../../theme';

const STATUS_COLOR = {
  new: '#0EA5E9', scheduled: '#8B5CF6', on_the_way: '#F59E0B',
  in_progress: '#F59E0B', completed: '#10B981', cancelled: '#9CA3AF',
};

const fmtWhen = (iso, window) => {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  return window || '';
};

export default function TechJobsScreen({ navigation }) {
  const { t } = useTranslation();
  const { tech, logout } = useTechAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    // Push any queued offline edits first, then pull the fresh list.
    await flushQueue();
    setPending(await pendingCount());
    try {
      const data = await techListJobs();
      setJobs(data);
      saveJobsCache(data);
    } catch {
      // Offline / server down — fall back to the cached list.
      const cached = await getJobsCache();
      if (cached.length) setJobs(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setPending(await pendingCount());
    }
  }, []);

  React.useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const renderJob = ({ item }) => {
    const color = STATUS_COLOR[item.status] || '#9CA3AF';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('TechJobDetail', { id: item.id })}
        accessibilityRole="button"
      >
        <View style={styles.cardHeader}>
          <Text style={styles.jobTitle} numberOfLines={1}>{item.projectTitle || t('tech_job_default_title')}</Text>
          <View style={[styles.pill, { backgroundColor: color + '20' }]}>
            <Text style={[styles.pillText, { color }]}>{t(`myjobs_status_${item.status}`) || item.status}</Text>
          </View>
        </View>
        {item.serviceType ? <Text style={styles.service}>{item.serviceType}</Text> : null}
        <Text style={styles.customer}>{item.customerName}</Text>
        <Text style={styles.when}>{fmtWhen(item.scheduledFor, item.preferredWindow)}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topbar}>
        <View style={styles.topbarLeft}>
          <TouchableOpacity
            onPress={() => navigation.getParent()?.openDrawer?.()}
            accessibilityRole="button"
            accessibilityLabel={t('open_menu')}
            style={styles.menuBtn}
          >
            <Icon name="menu" size={26} color={theme.colors.text} />
          </TouchableOpacity>
          <View>
            <Text style={styles.hello}>{t('tech_jobs_title')}</Text>
            {tech ? <Text style={styles.who}>{tech.name}</Text> : null}
          </View>
        </View>
        <TouchableOpacity onPress={logout} accessibilityRole="button" accessibilityLabel={t('tech_sign_out')}>
          <Icon name="log-out-outline" size={24} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {pending > 0 ? (
        <View style={styles.pendingBar}>
          <Icon name="cloud-offline-outline" size={16} color={theme.colors.warning} />
          <Text style={styles.pendingText}>{t('tech_pending_sync').replace('{n}', String(pending))}</Text>
        </View>
      ) : null}
      <FlatList
        data={jobs}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="clipboard-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('tech_jobs_empty')}</Text>
          </View>
        }
        renderItem={renderJob}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, paddingBottom: 8 },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  menuBtn: { padding: 2 },
  hello: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  who: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
  pendingBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 8 },
  pendingText: { color: theme.colors.warning, fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  jobTitle: { flex: 1, fontWeight: '800', fontSize: 16, color: theme.colors.text },
  service: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  customer: { color: theme.colors.text, fontSize: 14, marginTop: 6, fontWeight: '600' },
  when: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  empty: { alignItems: 'center', marginTop: 60, padding: 30 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
});
