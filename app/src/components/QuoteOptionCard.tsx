import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { QuoteOption } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

type Props = {
  option: QuoteOption;
  onChoose: (option: QuoteOption) => void;
  disabled?: boolean;
};

// One tier of a Good/Better/Best quote, rendered as a selectable card in a
// horizontal rail on MyJobs. Shows the first three line descriptions so the
// customer sees what differs between tiers without opening anything.
export default function QuoteOptionCard({ option, onChoose, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{option.name}</Text>
      <Text style={styles.total}>${Number(option.total || 0).toFixed(2)}</Text>
      <View style={styles.lines}>
        {(option.lines || []).slice(0, 3).map((l, i) => (
          <Text key={i} style={styles.line} numberOfLines={1}>• {l.description}</Text>
        ))}
        {(option.lines || []).length > 3 ? (
          <Text style={styles.more}>+{option.lines.length - 3}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.chooseBtn, disabled && styles.chooseBtnDisabled]}
        onPress={() => onChoose(option)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${t('myjobs_quote_choose')} — ${option.name}`}
      >
        <Text style={styles.chooseText}>{t('myjobs_quote_choose')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 190, marginRight: 10, padding: 14, borderRadius: 14,
    backgroundColor: theme.colors.primary + '10',
    borderWidth: 1, borderColor: theme.colors.primary + '30',
  },
  name: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  total: { color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  lines: { marginTop: 8, minHeight: 48 },
  line: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
  more: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  chooseBtn: { marginTop: 10, backgroundColor: theme.colors.success, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  chooseBtnDisabled: { opacity: 0.5 },
  chooseText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
