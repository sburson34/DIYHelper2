import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from '../i18n/I18nContext';
import { jobStatusColor } from '../constants/jobStatus';

// Tinted status chip shared by the customer (MyJobs) and technician (TechJobs)
// job cards. Label keys follow the myjobs_status_<status> convention in
// translations.ts; unknown statuses fall back to the raw string.
export default function JobStatusPill({ status }: { status?: string | null }) {
  const { t } = useTranslation();
  const color = jobStatusColor(status);
  const label = (status && t(`myjobs_status_${status}`)) || status || '';
  return (
    <View style={[styles.pill, { backgroundColor: color + '20' }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});
