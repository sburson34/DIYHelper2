import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import theme from '../theme';

export default function SafetyScreen({ navigation, route }) {
  const { project } = route.params || {};

  const defaultSafetyTips = [
    "Wear appropriate safety gear (PPE).",
    "Ensure proper ventilation.",
    "Keep a first-aid kit nearby.",
    "Disconnect power/water at the source if working with utilities.",
    "Keep children and pets away from the workspace."
  ];

  const defaultWhenToCallPro = [
    "If the project involves major structural changes.",
    "If you encounter unexpected electrical or plumbing issues.",
    "If you feel unsure about any technical step.",
    "If you don't have the necessary heavy-duty tools."
  ];

  const safetyTips = project?.safety_tips || defaultSafetyTips;
  const whenToCallPro = project?.when_to_call_pro || defaultWhenToCallPro;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerContainer}>
          <View style={styles.iconCircle}>
            <Icon name="shield-checkmark" size={60} color="#fff" />
          </View>
          <Text style={styles.title}>Safety First! 🛡️</Text>
          <Text style={styles.subtitle}>Before you start your workshop magic, let's review these important safety guidelines.</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.miniIconCircle, { backgroundColor: '#FFF7ED' }]}>
              <Icon name="warning" size={20} color="#EA580C" />
            </View>
            <Text style={styles.sectionTitle}>Safety Tips</Text>
          </View>
          <View style={[styles.card, styles.safetyCard]}>
            {safetyTips.map((tip, i) => (
              <View key={i} style={styles.listItem}>
                <View style={styles.itemNumber}>
                  <Text style={styles.itemNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.itemText}>{tip}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.miniIconCircle, { backgroundColor: '#FEF2F2' }]}>
              <Icon name="hammer" size={20} color="#DC2626" />
            </View>
            <Text style={styles.sectionTitle}>When to Call a Pro</Text>
          </View>
          <View style={[styles.card, styles.proCard]}>
            {whenToCallPro.map((item, i) => (
              <View key={i} style={styles.listItem}>
                <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.replace('WorkshopSteps', { project })}
        >
          <Icon name="checkmark-circle" size={24} color="#fff" style={{ marginRight: 10 }} />
          <Text style={styles.buttonText}>Workshop Ready! 🏗️</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: theme.colors.danger,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.colors.text,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  section: {
    marginBottom: 25,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  miniIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.text,
  },
  card: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  safetyCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FEF3C7',
  },
  proCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FEE2E2',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  itemNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  itemNumberText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#B45309',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 12,
    marginTop: 8,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    fontWeight: '500',
  },
  button: {
    flexDirection: 'row',
    backgroundColor: theme.colors.success,
    paddingVertical: 18,
    borderRadius: theme.roundness.full,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    shadowColor: theme.colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
