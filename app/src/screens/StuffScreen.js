import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SegmentedControl from '../components/SegmentedControl';
import Inventory from './Inventory';
import ShoppingList from './ShoppingList';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

// Merged "stuff you own / stuff you need to buy" screen. Inventory and
// ShoppingList are kept as separate components (no risk of regressing their
// existing behavior), just wrapped in a segmented control for one-tap
// switching. This replaces two drawer entries with one tab.

export default function StuffScreen({ navigation }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('tools');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.controlWrap}>
        <SegmentedControl
          options={[
            { id: 'tools', label: t('tools_i_own') },
            { id: 'shopping', label: t('shopping_list_tab') },
          ]}
          selected={tab}
          onChange={setTab}
        />
      </View>
      <View style={styles.body}>
        {tab === 'tools' ? (
          <Inventory navigation={navigation} />
        ) : (
          <ShoppingList navigation={navigation} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  controlWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  body: { flex: 1 },
});
