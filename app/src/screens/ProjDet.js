import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Linking, TouchableOpacity, Modal, Alert } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { updateHoneyDoList, updateContractorList, removeFromHoneyDoList, removeFromContractorList } from '../utils/storage';
import theme from '../theme';

const TABS = [
  { id: 'tools', label: 'Tools', icon: 'hammer-outline' },
  { id: 'steps', label: 'Steps', icon: 'list-outline' },
  { id: 'videos', label: 'Videos', icon: 'play-circle-outline' },
];

export default function ProjDet({ navigation, route }) {
  const { project: initialProject, listType } = route.params || {};
  const [project, setProject] = useState(initialProject);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('steps');
  const [checkedSteps, setCheckedSteps] = useState(
    initialProject?.checkedSteps || new Array(initialProject?.steps?.length || 0).fill(false)
  );

  useEffect(() => {
    // Update local storage when checkedSteps change
    const updatedProject = { ...project, checkedSteps };
    if (listType === 'honey-do') {
      updateHoneyDoList(updatedProject);
    } else if (listType === 'contractor') {
      updateContractorList(updatedProject);
    }
    setProject(updatedProject);
  }, [checkedSteps]);

  const openLink = (url) => {
    if (url) {
      Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
    }
  };

  const toggleStep = (index) => {
    const newChecked = [...checkedSteps];
    newChecked[index] = !newChecked[index];
    setCheckedSteps(newChecked);

    // If all steps are checked, show celebration
    if (newChecked.every(step => step) && newChecked.length > 0 && !checkedSteps[index]) {
      setCelebrationVisible(true);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Project",
      "Are you sure you want to remove this project from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            let success = false;
            if (listType === 'honey-do') {
              success = await removeFromHoneyDoList(project.id);
            } else {
              success = await removeFromContractorList(project.id);
            }
            if (success) {
              navigation.goBack();
            }
          }
        }
      ]
    );
  };

  const renderToolsTab = () => (
    <View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tools & Materials 🛠️</Text>
        {project?.tools_and_materials?.map((item, index) => (
          <View key={index} style={styles.materialItem}>
            <Icon name="checkmark-circle" size={18} color={theme.colors.accent} />
            <Text style={styles.listItem}>{item}</Text>
          </View>
        ))}
      </View>

      {project?.shopping_links && project.shopping_links.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Where to Buy 🛒</Text>
          {project.shopping_links.map((link, index) => (
            <TouchableOpacity key={index} onPress={() => openLink(link.url)} style={styles.linkItem}>
              <Text style={styles.linkText}>Buy {link.item}</Text>
              <Icon name="open-outline" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderStepsTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Project Blueprint 📋</Text>
      {project?.steps?.map((step, index) => (
        <TouchableOpacity
          key={index}
          style={styles.stepContainer}
          onPress={() => toggleStep(index)}
          activeOpacity={0.7}
        >
          <View style={[
            styles.stepBadge,
            checkedSteps[index] && { backgroundColor: theme.colors.success }
          ]}>
            {checkedSteps[index] ? (
              <Icon name="checkmark" size={18} color="#fff" />
            ) : (
              <Text style={styles.stepNumber}>{index + 1}</Text>
            )}
          </View>
          <Text style={[
            styles.stepText,
            checkedSteps[index] && styles.stepTextCompleted
          ]}>{step}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderVideosTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Visual Guides 📺</Text>
      {project?.youtube_links && project.youtube_links.length > 0 ? (
        project.youtube_links.map((link, index) => (
          <TouchableOpacity key={index} onPress={() => openLink(link)} style={styles.linkItem}>
            <Text style={styles.linkText}>Watch Tutorial {index + 1}</Text>
            <Icon name="play-circle-outline" size={20} color={theme.colors.danger} />
          </TouchableOpacity>
        ))
      ) : (
        <Text style={styles.emptyText}>No tutorial videos found for this project.</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{project?.title || "Project Details"}</Text>

          <View style={styles.infoGrid}>
            <View style={styles.infoBox}>
              <Icon name="speedometer-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Difficulty</Text>
              <Text style={styles.infoValue}>{project?.difficulty}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="time-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Time</Text>
              <Text style={styles.infoValue}>{project?.estimated_time}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="cash-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Cost</Text>
              <Text style={styles.infoValue}>{project?.estimated_cost || "N/A"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tabItem,
                activeTab === tab.id && styles.activeTabItem
              ]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Icon
                name={tab.icon}
                size={20}
                color={activeTab === tab.id ? theme.colors.primary : theme.colors.textSecondary}
              />
              <Text style={[
                styles.tabLabel,
                activeTab === tab.id && styles.activeTabLabel
              ]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.tabContent}>
          {activeTab === 'tools' && renderToolsTab()}
          {activeTab === 'steps' && renderStepsTab()}
          {activeTab === 'videos' && renderVideosTab()}
        </View>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
        >
          <Icon name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteButtonText}>Delete Project</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        transparent={true}
        visible={celebrationVisible}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.celebrationIcon}>
              <Icon name="trophy" size={60} color={theme.colors.accent} />
            </View>
            <Text style={styles.modalTitle}>Project Completed!</Text>
            <Text style={styles.modalText}>Excellent work! You've successfully finished this DIY project. Your workshop skills are top-notch! 🛠️🎉</Text>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.colors.success }]}
              onPress={() => {
                setCelebrationVisible(false);
              }}
            >
              <Text style={styles.modalButtonText}>Awesome!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 16,
  },
  headerCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.large,
    padding: 20,
    marginBottom: 20,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.large,
    padding: 20,
    marginBottom: 20,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  infoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  infoBox: {
    alignItems: 'center',
    flex: 1,
  },
  infoLabel: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  infoValue: {
    color: theme.colors.primary,
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.full,
    padding: 4,
    marginBottom: 20,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: theme.roundness.full,
    gap: 6,
  },
  activeTabItem: {
    backgroundColor: theme.colors.primary + '15',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  activeTabLabel: {
    color: theme.colors.primary,
  },
  tabContent: {
    minHeight: 200,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 15,
    color: theme.colors.text,
  },
  materialItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  listItem: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginLeft: 8,
  },
  linkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.medium,
    marginBottom: 10,
  },
  linkText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  stepContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-start',
    backgroundColor: theme.colors.background,
    padding: 12,
    borderRadius: theme.roundness.medium,
  },
  stepBadge: {
    backgroundColor: theme.colors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumber: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
  },
  stepTextCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontSize: 14,
    padding: 20,
  },
  deleteButton: {
    flexDirection: 'row',
    backgroundColor: theme.colors.danger,
    padding: 18,
    borderRadius: theme.roundness.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 40,
    gap: 10,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness.large,
    padding: 25,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 10,
    color: theme.colors.text,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 25,
  },
  modalButton: {
    width: '100%',
    padding: 15,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.roundness.full,
    alignItems: 'center',
    marginBottom: 12,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  celebrationIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  }
});
