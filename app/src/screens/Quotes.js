// Quote tracker (#21). Local mirror of help requests with status pipeline.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getLocalHelpRequests, updateLocalHelpRequest } from '../utils/storage';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

const STATUSES = ['sent', 'quoted', 'scheduled', 'done'];
const STATUS_COLOR = {
  sent: '#0EA5E9',
  quoted: '#F59E0B',
  scheduled: '#8B5CF6',
  done: '#10B981',
};

export default function Quotes({ navigation }) {
  const { t } = useTranslation();
  const STATUS_LABEL = {
    sent: t('quotes_status_sent'),
    quoted: t('quotes_status_quoted'),
    scheduled: t('quotes_status_scheduled'),
    done: t('quotes_status_done'),
  };
  const [items, setItems] = useState([]);

  const load = async () => setItems(await getLocalHelpRequests());

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  const advance = async (item) => {
    const idx = STATUSES.indexOf(item.status || 'sent');
    const next = STATUSES[Math.min(idx + 1, STATUSES.length - 1)];
    await updateLocalHelpRequest(item.id, { status: next });
    load();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('quotes_title')}</Text>
        <Text style={styles.subtitle}>{t('quotes_subtitle')}</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="chatbox-ellipses-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('quotes_empty')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = item.status || 'sent';
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.itemTitle}>{item.projectTitle || t('quotes_untitled')}</Text>
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[status] + '20' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[status] }]}>{STATUS_LABEL[status]}</Text>
                </View>
              </View>
              {item.userDescription ? <Text style={styles.itemDesc} numberOfLines={2}>{item.userDescription}</Text> : null}
              <View style={styles.timeline}>
                {STATUSES.map((s, i) => {
                  const reached = STATUSES.indexOf(status) >= i;
                  return (
                    <React.Fragment key={s}>
                      <View style={[styles.tlDot, reached && { backgroundColor: STATUS_COLOR[s] }]} />
                      {i < STATUSES.length - 1 && <View style={[styles.tlLine, reached && { backgroundColor: STATUS_COLOR[s] }]} />}
                    </React.Fragment>
                  );
                })}
              </View>
              {status !== 'done' && (() => {
                const nextLabel = STATUS_LABEL[STATUSES[STATUSES.indexOf(status) + 1]];
                const buttonText = t('quotes_mark_as').replace('{status}', nextLabel);
                return (
                  <TouchableOpacity
                    style={styles.advanceBtn}
                    onPress={() => advance(item)}
                    accessibilityLabel={buttonText}
                    accessibilityRole="button"
                  >
                    <Text style={styles.advanceText}>{buttonText}</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  itemTitle: { flex: 1, fontWeight: '800', fontSize: 16, color: theme.colors.text },
  itemDesc: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 6 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  timeline: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 },
  tlDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.border },
  tlLine: { flex: 1, height: 3, backgroundColor: theme.colors.border, marginHorizontal: 2 },
  advanceBtn: { marginTop: 10, backgroundColor: theme.colors.primary + '15', padding: 10, borderRadius: 10, alignItems: 'center' },
  advanceText: { color: theme.colors.primary, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60, padding: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
});
