import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Linking, TouchableOpacity, Modal, Alert, Animated, Image } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { saveToHoneyDoList, saveToContractorList, getUserProfile } from '../utils/storage';
import { API_BASE_URL } from '../config/api';
import theme from '../theme';

const TABS = [
  { id: 'tools', label: 'Tools', icon: 'hammer-outline' },
  { id: 'steps', label: 'Steps', icon: 'list-outline' },
  { id: 'videos', label: 'Videos', icon: 'play-circle-outline' },
];

export default function ResultScreen({ navigation, route }) {
  // Safety check for navigation params
  const { project, originalRequest } = route.params || {};

  if (!project) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No project data found. Please try analysis again.</Text>
          <TouchableOpacity 
            style={[styles.actionButton, { marginTop: 20 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.actionButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  const [modalVisible, setModalVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [saveType, setSaveType] = useState('');
  const [activeTab, setActiveTab] = useState('steps');
  const [checkedSteps, setCheckedSteps] = useState(
    new Array(project.steps?.length || 0).fill(false)
  );

  const openLink = (url) => {
    if (url) {
      Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
    }
  };

  const contactProfessional = async () => {
    const profile = await getUserProfile();
    if (!profile) {
      Alert.alert(
        'Contact Info Needed',
        'Please set up your contact info in Settings so a professional can reach you.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings') },
        ]
      );
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/help-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: profile.name,
          customerEmail: profile.email,
          customerPhone: profile.phone,
          projectTitle: project.title || 'Untitled Project',
          userDescription: originalRequest?.description || '',
          projectData: JSON.stringify(project),
          imageBase64: originalRequest?.mediaItems?.[0]?.base64 || null,
        }),
      });
      if (response.ok) {
        Alert.alert('Request Submitted', 'Your request has been submitted! A professional will review it shortly.');
      } else {
        Alert.alert('Error', 'Failed to submit request. Please try again.');
      }
    } catch (e) {
      Alert.alert('Connection Error', 'Could not reach the server. Please check your connection and try again.');
    }
  };

  const saveJob = async (type) => {
    let success = false;
    if (type === 'Honey Do') {
      success = await saveToHoneyDoList({ ...project, originalRequest, checkedSteps });
    } else {
      success = await saveToContractorList({ ...project, originalRequest, checkedSteps });
    }

    if (success) {
      setSaveType(type);
      setModalVisible(true);
    }
  };

  const toggleStep = (index) => {
    const newChecked = [...checkedSteps];
    newChecked[index] = !newChecked[index];
    setCheckedSteps(newChecked);

    // If all steps are checked, show celebration
    if (newChecked.every(step => step) && newChecked.length > 0) {
      setCelebrationVisible(true);
    }
  };

  const renderToolsTab = () => (
    <View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tools & Materials 🛠️</Text>
        {project.tools_and_materials?.map((item, index) => (
          <View key={index} style={styles.materialItem}>
            <Icon name="checkmark-circle" size={18} color={theme.colors.accent} />
            <Text style={styles.listItem}>{item}</Text>
          </View>
        ))}
      </View>

      {project.shopping_links && project.shopping_links.length > 0 && (
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

  const mediaUrls = originalRequest?.mediaUrls || [];

  const getStepText = (step) => typeof step === 'string' ? step : step.text;
  const getStepAnnotations = (step) => typeof step === 'string' ? [] : (step.image_annotations || []);
  const getStepRefSearch = (step) => typeof step === 'string' ? null : step.reference_image_search;

  const renderStepsTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Project Blueprint</Text>

      {/* Photo overview annotations */}
      {project.image_annotations?.length > 0 && mediaUrls.length > 0 && (
        <View style={styles.photoOverviewSection}>
          <Text style={styles.photoOverviewTitle}>Photo Analysis</Text>
          {project.image_annotations.map((ann, i) => {
            const photoUri = mediaUrls[(ann.photo_number || 1) - 1];
            if (!photoUri) return null;
            return (
              <View key={i} style={styles.photoAnnotationCard}>
                <Image source={{ uri: photoUri }} style={styles.annotatedPhoto} />
                <Text style={styles.annotationText}>{ann.overview}</Text>
              </View>
            );
          })}
        </View>
      )}

      {project.steps?.map((step, index) => {
        const stepText = getStepText(step);
        const annotations = getStepAnnotations(step);
        const refSearch = getStepRefSearch(step);

        return (
          <View key={index}>
            <TouchableOpacity
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
              ]}>{stepText}</Text>
            </TouchableOpacity>

            {/* User photo annotations for this step */}
            {annotations.length > 0 && (
              <View style={styles.stepImagesSection}>
                {annotations.map((ann, i) => {
                  const photoUri = mediaUrls[(ann.photo_number || 1) - 1];
                  if (!photoUri) return null;
                  return (
                    <View key={i} style={styles.stepImageCard}>
                      <Image source={{ uri: photoUri }} style={styles.stepPhoto} />
                      <View style={styles.stepImageOverlay}>
                        <Icon name="camera" size={14} color={theme.colors.primary} />
                        <Text style={styles.stepImageLabel}>Photo {ann.photo_number}</Text>
                      </View>
                      <Text style={styles.stepImageCaption}>{ann.description}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Reference image search link */}
            {refSearch && (
              <TouchableOpacity
                style={styles.refImageLink}
                onPress={() => openLink(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(refSearch)}`)}
              >
                <Icon name="image-outline" size={16} color={theme.colors.primary} />
                <Text style={styles.refImageText}>View reference images</Text>
                <Icon name="open-outline" size={14} color={theme.colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );

  const renderVideosTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Visual Guides 📺</Text>
      {project.youtube_links && project.youtube_links.length > 0 ? (
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
          <Text style={styles.title}>{project.title || "Project Guide"}</Text>

          <View style={styles.infoGrid}>
            <View style={styles.infoBox}>
              <Icon name="speedometer-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Difficulty</Text>
              <Text style={styles.infoValue}>{project.difficulty}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="time-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Time</Text>
              <Text style={styles.infoValue}>{project.estimated_time}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="cash-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>Cost</Text>
              <Text style={styles.infoValue}>{project.estimated_cost || "N/A"}</Text>
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

        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[styles.actionButton, styles.startButton]}
            onPress={() => navigation.navigate('Safety', { project })}
          >
            <Text style={styles.actionButtonText}>Start Building! 🏗️</Text>
          </TouchableOpacity>

          <View style={styles.saveRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.saveButton, { flex: 1 }]}
              onPress={() => saveJob('Honey Do')}
            >
              <Text style={styles.actionButtonText}>Honey-Do List</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.saveButton, { flex: 1, backgroundColor: theme.colors.accent }]}
              onPress={() => saveJob('Contractor')}
            >
              <Text style={styles.actionButtonText}>Contractor List</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, styles.profButton]}
            onPress={contactProfessional}
          >
            <Text style={styles.actionButtonText}>Get Professional Help 🆘</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.moreDetailsButton]}
            onPress={() => navigation.navigate('Capture', { existingProject: { project, originalRequest } })}
          >
            <Text style={styles.actionButtonText}>Refine Blueprint ✏️</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Icon name="bookmark" size={50} color={theme.colors.success} style={{ marginBottom: 15 }} />
            <Text style={styles.modalTitle}>Job Saved!</Text>
            <Text style={styles.modalText}>The job has been saved to your {saveType} List.</Text>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setModalVisible(false);
                navigation.navigate('Capture');
              }}
            >
              <Text style={styles.modalButtonText}>Start New Project</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.colors.secondary }]}
              onPress={() => {
                setModalVisible(false);
                navigation.navigate(saveType === 'Honey Do' ? 'HoneyDoList' : 'ContractorList');
              }}
            >
              <Text style={styles.modalButtonText}>Go to {saveType} List</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={{ marginTop: 10 }}
              onPress={() => setModalVisible(false)}
            >
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Stay Here</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        transparent={true}
        visible={celebrationVisible}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: '#fff' }]}>
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
    marginBottom: 20,
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
  photoOverviewSection: {
    marginBottom: 16,
  },
  photoOverviewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 10,
  },
  photoAnnotationCard: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.medium,
    overflow: 'hidden',
    marginBottom: 12,
  },
  annotatedPhoto: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  annotationText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    padding: 10,
    lineHeight: 18,
  },
  stepImagesSection: {
    marginLeft: 40,
    marginBottom: 12,
  },
  stepImageCard: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.medium,
    overflow: 'hidden',
    marginBottom: 8,
  },
  stepPhoto: {
    width: '100%',
    height: 160,
    resizeMode: 'cover',
  },
  stepImageOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  stepImageLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  stepImageCaption: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 4,
    lineHeight: 18,
  },
  refImageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 40,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.primary + '10',
    borderRadius: theme.roundness.medium,
    alignSelf: 'flex-start',
  },
  refImageText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontSize: 14,
    padding: 20,
  },
  actionSection: {
    marginTop: 10,
    marginBottom: 40,
  },
  saveRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  actionButton: {
    padding: 18,
    borderRadius: theme.roundness.full,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  profButton: {
    backgroundColor: theme.colors.danger,
  },
  startButton: {
    backgroundColor: theme.colors.success,
    paddingVertical: 20,
  },
  saveButton: {
    backgroundColor: theme.colors.secondary,
    marginBottom: 0,
  },
  moreDetailsButton: {
    backgroundColor: theme.colors.textSecondary,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
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
