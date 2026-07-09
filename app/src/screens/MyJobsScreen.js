// "My Jobs" (Wave 1). The customer's own requests, scoped to their device (no
// login). Shows a live status tracker (new → scheduled → on the way → in
// progress → done) with the confirmed time and a "tech arriving in ~N min" ETA,
// and folds in the retention layer: leave-a-review, refer-a-friend, a
// maintenance reminder, and the membership CTA when the brand offers one.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Linking, Share, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { listMyRequests, startMembershipCheckout, respondToQuote } from '../api/backendClient';
import { getUserProfile } from '../utils/storage';
import { scheduleMaintenanceReminder } from '../utils/notifications';
import { useTranslation } from '../i18n/I18nContext';
import { useBrandConfig } from '../config/brandConfig';
import theme from '../theme';

const STEPS = ['new', 'scheduled', 'on_the_way', 'in_progress', 'completed'];
const STEP_COLOR = {
  new: '#0EA5E9',
  scheduled: '#8B5CF6',
  on_the_way: '#F59E0B',
  in_progress: '#F59E0B',
  completed: '#10B981',
  cancelled: '#9CA3AF',
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function MyJobsScreen({ navigation }) {
  const { t } = useTranslation();
  const config = useBrandConfig();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listMyRequests();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // Leave whatever we had; a transient network error shouldn't blank the list.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const stepLabel = (s) => t(`myjobs_status_${s}`);

  const leaveReview = () => {
    if (config.reviewUrl) Linking.openURL(config.reviewUrl).catch(() => {});
  };

  const referFriend = async () => {
    const company = config.companyName || t('myjobs_this_company');
    try {
      await Share.share({ message: t('myjobs_referral_message').replace('{company}', company) });
    } catch {
      // user dismissed the share sheet
    }
  };

  const remindMaintenance = async (job) => {
    const company = config.companyName || t('myjobs_this_company');
    const id = await scheduleMaintenanceReminder(
      t('myjobs_reminder_title').replace('{company}', company),
      t('myjobs_reminder_body').replace('{service}', job.serviceType || t('booking_generic_service')),
      6,
    );
    Alert.alert(
      id ? t('myjobs_reminder_set_title') : t('myjobs_reminder_failed_title'),
      id ? t('myjobs_reminder_set_msg') : t('myjobs_reminder_failed_msg'),
    );
  };

  const joinMembership = async () => {
    setCheckingOut(true);
    try {
      const profile = await getUserProfile();
      const emailAddr = profile?.email;
      if (!emailAddr) {
        Alert.alert(t('myjobs_membership_need_email_title'), t('myjobs_membership_need_email_msg'), [
          { text: t('myjobs_go_book'), onPress: () => navigation.navigate('Book') },
          { text: t('common_ok'), style: 'cancel' },
        ]);
        return;
      }
      const res = await startMembershipCheckout({ customerEmail: emailAddr, customerName: profile?.name });
      if (res.available && res.checkoutUrl) {
        Linking.openURL(res.checkoutUrl).catch(() => {});
      } else {
        Alert.alert(t('myjobs_membership_unavailable_title'), res.reason || t('myjobs_membership_unavailable_msg'));
      }
    } catch (e) {
      Alert.alert(t('myjobs_membership_unavailable_title'), e.message);
    } finally {
      setCheckingOut(false);
    }
  };

  const respondQuote = async (job, decision) => {
    try {
      await respondToQuote(job.id, decision);
      load();
    } catch (e) {
      Alert.alert(t('myjobs_quote_failed'), e.message || '');
    }
  };

  const renderJob = ({ item }) => {
    const status = item.status || 'new';
    const cancelled = status === 'cancelled';
    const reachedIdx = STEPS.indexOf(status);
    const scheduled = fmtDate(item.scheduledFor);
    const done = status === 'completed';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.jobTitle} numberOfLines={1}>{item.projectTitle || t('booking_default_title')}</Text>
          <View style={[styles.statusPill, { backgroundColor: (STEP_COLOR[status] || '#9CA3AF') + '20' }]}>
            <Text style={[styles.statusPillText, { color: STEP_COLOR[status] || '#9CA3AF' }]}>{stepLabel(status)}</Text>
          </View>
        </View>
        {item.serviceType ? <Text style={styles.serviceType}>{item.serviceType}</Text> : null}

        {!cancelled && (
          <View style={styles.timeline}>
            {STEPS.map((s, i) => {
              const reached = reachedIdx >= i;
              return (
                <React.Fragment key={s}>
                  <View style={[styles.tlDot, reached && { backgroundColor: STEP_COLOR[s] }]} />
                  {i < STEPS.length - 1 && <View style={[styles.tlLine, reached && { backgroundColor: STEP_COLOR[s] }]} />}
                </React.Fragment>
              );
            })}
          </View>
        )}

        {status === 'on_the_way' && item.techEtaMinutes != null ? (
          <View style={styles.etaRow}>
            <Icon name="navigate" size={16} color={STEP_COLOR.on_the_way} />
            <Text style={styles.etaText}>{t('myjobs_eta').replace('{min}', String(item.techEtaMinutes))}</Text>
          </View>
        ) : scheduled ? (
          <View style={styles.etaRow}>
            <Icon name="calendar-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={styles.scheduledText}>{t('myjobs_scheduled_for').replace('{when}', scheduled)}</Text>
          </View>
        ) : null}

        {/* Quote the company sent — approve or decline right here. */}
        {item.quoteStatus === 'sent' ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quoteLabel}>{t('myjobs_quote_received')}</Text>
            <Text style={styles.quoteAmount}>${Number(item.quoteTotal || 0).toFixed(2)}</Text>
            <View style={styles.quoteActions}>
              <TouchableOpacity style={[styles.quoteBtn, styles.quoteApprove]} onPress={() => respondQuote(item, 'approved')} accessibilityRole="button">
                <Text style={styles.quoteApproveText}>{t('myjobs_quote_approve')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.quoteBtn, styles.quoteDecline]} onPress={() => respondQuote(item, 'declined')} accessibilityRole="button">
                <Text style={styles.quoteDeclineText}>{t('myjobs_quote_decline')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : item.quoteStatus === 'approved' ? (
          <View style={styles.quoteResolved}>
            <Icon name="checkmark-circle" size={16} color={theme.colors.success} />
            <Text style={styles.quoteResolvedText}>{t('myjobs_quote_approved').replace('{amount}', `$${Number(item.quoteTotal || 0).toFixed(2)}`)}</Text>
          </View>
        ) : item.quoteStatus === 'declined' ? (
          <View style={styles.quoteResolved}>
            <Icon name="close-circle" size={16} color={theme.colors.textSecondary} />
            <Text style={styles.quoteResolvedText}>{t('myjobs_quote_declined')}</Text>
          </View>
        ) : null}

        {/* Post-job retention actions appear once the work is done. */}
        {done && (
          <View style={styles.jobActions}>
            {config.features.reviews && config.reviewUrl ? (
              <TouchableOpacity style={styles.smallBtn} onPress={leaveReview} accessibilityRole="button">
                <Icon name="star" size={15} color={theme.colors.primary} />
                <Text style={styles.smallBtnText}>{t('myjobs_leave_review')}</Text>
              </TouchableOpacity>
            ) : null}
            {config.features.maintenanceReminders ? (
              <TouchableOpacity style={styles.smallBtn} onPress={() => remindMaintenance(item)} accessibilityRole="button">
                <Icon name="notifications-outline" size={15} color={theme.colors.primary} />
                <Text style={styles.smallBtnText}>{t('myjobs_remind_maintenance')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
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
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListHeaderComponent={
          <View>
            {config.features.memberships && config.membershipEnabled ? (
              <TouchableOpacity style={styles.memberCard} onPress={joinMembership} disabled={checkingOut} accessibilityRole="button">
                <Icon name="shield-checkmark" size={24} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberTitle}>{t('myjobs_membership_title')}</Text>
                  <Text style={styles.memberSub}>{t('myjobs_membership_sub')}</Text>
                </View>
                {checkingOut ? <ActivityIndicator color="#fff" /> : <Icon name="chevron-forward" size={22} color="#fff" />}
              </TouchableOpacity>
            ) : null}
            {config.features.referrals ? (
              <TouchableOpacity style={styles.referBtn} onPress={referFriend} accessibilityRole="button">
                <Icon name="gift-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.referText}>{t('myjobs_refer_friend')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="clipboard-outline" size={64} color={theme.colors.border} />
            <Text style={styles.emptyText}>{t('myjobs_empty')}</Text>
            {config.features.booking ? (
              <TouchableOpacity style={styles.bookBtn} onPress={() => navigation.navigate('Book')} accessibilityRole="button">
                <Text style={styles.bookBtnText}>{t('myjobs_book_now')}</Text>
              </TouchableOpacity>
            ) : null}
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
  card: {
    backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  jobTitle: { flex: 1, fontWeight: '800', fontSize: 16, color: theme.colors.text },
  serviceType: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  statusPillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  timeline: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 4 },
  tlDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.border },
  tlLine: { flex: 1, height: 3, backgroundColor: theme.colors.border, marginHorizontal: 2 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  etaText: { color: STEP_COLOR.on_the_way, fontWeight: '800', fontSize: 14 },
  scheduledText: { color: theme.colors.textSecondary, fontSize: 13 },
  quoteBox: { marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: theme.colors.primary + '10', borderWidth: 1, borderColor: theme.colors.primary + '30' },
  quoteLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  quoteAmount: { color: theme.colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
  quoteActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  quoteBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10 },
  quoteApprove: { backgroundColor: theme.colors.success },
  quoteApproveText: { color: '#fff', fontWeight: '800' },
  quoteDecline: { borderWidth: 1, borderColor: theme.colors.border },
  quoteDeclineText: { color: theme.colors.textSecondary, fontWeight: '700' },
  quoteResolved: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  quoteResolvedText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  jobActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: theme.colors.primary + '12',
  },
  smallBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  memberCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16,
    backgroundColor: theme.colors.secondary, marginBottom: 12,
  },
  memberTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },
  memberSub: { color: '#FFFFFFCC', fontSize: 12, marginTop: 2 },
  referBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.primary + '40',
    backgroundColor: theme.colors.primary + '10', marginBottom: 16,
  },
  referText: { color: theme.colors.primary, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 50, padding: 30 },
  emptyText: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, lineHeight: 20 },
  bookBtn: { marginTop: 18, backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  bookBtnText: { color: '#fff', fontWeight: '800' },
});
