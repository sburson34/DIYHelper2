import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Linking, TouchableOpacity, Pressable, Modal, Alert, Animated, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { saveToHoneyDoList, saveToContractorList, getUserProfile, saveUserProfile, saveLocalHelpRequest, getCommunityOptIn, getAppPrefs, getToolInventory, addToInventory, removeFromInventory } from '../utils/storage';
import { API_BASE_URL } from '../config/api';
import { submitCommunityProject } from '../api/backendClient';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';

export default function ResultScreen({ navigation, route }) {
  const { t } = useTranslation();
  const TABS = [
    { id: 'tools', label: t('tab_tools'), icon: 'hammer-outline' },
    { id: 'steps', label: t('tab_steps'), icon: 'list-outline' },
    { id: 'videos', label: t('tab_videos'), icon: 'play-circle-outline' },
  ];
  const { project, originalRequest } = route.params || {};

  const [modalVisible, setModalVisible] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [contactModalVisible, setContactModalVisible] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [saveType, setSaveType] = useState('');
  const [activeTab, setActiveTab] = useState('steps');
  const [zip, setZip] = useState('');
  const [inventory, setInventory] = useState([]);

  const loadInventory = async () => setInventory(await getToolInventory());

  useEffect(() => {
    (async () => {
      const prefs = await getAppPrefs();
      setZip(prefs.zip || '');
      loadInventory();
    })();
  }, []);

  // Case-insensitive name match against inventory
  const findOwned = (name) => {
    if (!name) return null;
    const target = name.toLowerCase().trim();
    return inventory.find(i => (i.name || '').toLowerCase().trim() === target) || null;
  };

  const toggleOwned = async (name) => {
    if (!name) return;
    const existing = findOwned(name);
    if (existing) {
      await removeFromInventory(existing.id);
    } else {
      await addToInventory({ name });
    }
    loadInventory();
  };
  const [checkedSteps, setCheckedSteps] = useState(
    new Array(project?.steps?.length || 0).fill(false)
  );

  if (!project) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('no_project_data')}</Text>
          <TouchableOpacity
            style={[styles.actionButton, { marginTop: 20 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.actionButtonText}>{t('go_back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const openLink = (url) => {
    if (url) {
      Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
    }
  };

  const formatUSPhone = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const isValidUSPhone = (phone) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10;
  };

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const contactProfessional = async () => {
    const profile = await getUserProfile();
    const hasPhone = profile?.phone && isValidUSPhone(profile.phone);
    const hasEmail = profile?.email && isValidEmail(profile.email);

    if (hasPhone || hasEmail) {
      // Already have valid contact info, submit directly
      try {
        const response = await fetch(`${API_BASE_URL}/api/help-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: profile.name || '',
            customerEmail: profile.email || '',
            customerPhone: profile.phone || '',
            projectTitle: project.title || 'Untitled Project',
            userDescription: originalRequest?.description || '',
            projectData: JSON.stringify(project),
            imageBase64: originalRequest?.mediaItems?.[0]?.base64 || null,
          }),
        });
        if (response.ok) {
          try {
            const created = await response.json();
            await saveLocalHelpRequest({
              id: String(created.id || Date.now()),
              projectTitle: project.title || 'Untitled Project',
              userDescription: originalRequest?.description || '',
              status: 'sent',
            });
          } catch {}
          Alert.alert(t('request_submitted'), t('request_submitted_msg'));
        } else {
          Alert.alert(t('error'), t('submit_failed'));
        }
      } catch (e) {
        Alert.alert(t('connection_error'), t('connection_error_msg'));
      }
      return;
    }

    // No valid contact info yet, show modal
    setContactPhone(profile?.phone || '');
    setContactEmail(profile?.email || '');
    setContactModalVisible(true);
  };

  const submitContactRequest = async () => {
    const hasPhone = contactPhone.trim().length > 0;
    const hasEmail = contactEmail.trim().length > 0;

    if (!hasPhone && !hasEmail) {
      Alert.alert(t('contact_required_title'), t('contact_required_msg'));
      return;
    }
    if (hasPhone && !isValidUSPhone(contactPhone)) {
      Alert.alert(t('invalid_phone'), t('invalid_phone_msg'));
      return;
    }
    if (hasEmail && !isValidEmail(contactEmail)) {
      Alert.alert(t('invalid_email'), t('invalid_email_msg'));
      return;
    }

    setContactSubmitting(true);
    try {
      // Save locally so Settings screen can access it
      const existingProfile = await getUserProfile() || {};
      await saveUserProfile({
        ...existingProfile,
        phone: hasPhone ? contactPhone.trim() : (existingProfile.phone || ''),
        email: hasEmail ? contactEmail.trim() : (existingProfile.email || ''),
      });

      // Submit to backend
      const response = await fetch(`${API_BASE_URL}/api/help-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: existingProfile.name || '',
          customerEmail: hasEmail ? contactEmail.trim() : '',
          customerPhone: hasPhone ? contactPhone.trim() : '',
          projectTitle: project.title || 'Untitled Project',
          userDescription: originalRequest?.description || '',
          projectData: JSON.stringify(project),
          imageBase64: originalRequest?.mediaItems?.[0]?.base64 || null,
        }),
      });
      setContactModalVisible(false);
      if (response.ok) {
        Alert.alert(t('request_submitted'), t('request_submitted_msg'));
      } else {
        Alert.alert(t('error'), t('submit_failed'));
      }
    } catch (e) {
      setContactModalVisible(false);
      Alert.alert(t('connection_error'), t('connection_error_msg'));
    } finally {
      setContactSubmitting(false);
    }
  };

  // #26 PDF export. expo-print is part of Expo SDK; if not installed we fall back to share text.
  const exportPdf = async () => {
    try {
      const Print = require('expo-print');
      const Sharing = require('expo-sharing');
      const stepsHtml = (project.steps || [])
        .map((s, i) => `<li>${typeof s === 'string' ? s : (s.text || '')}</li>`)
        .join('');
      const toolsHtml = (project.tools_and_materials || []).map(t => `<li>${t}</li>`).join('');
      const html = `
        <html><head><meta charset="utf-8"/><style>
          body { font-family: -apple-system, sans-serif; padding: 24px; color: #0F2253; }
          h1 { color: #FCA004; }
          h2 { border-bottom: 2px solid #FCA004; padding-bottom: 4px; margin-top: 24px; }
          .meta { display: flex; gap: 16px; color: #636E72; font-size: 12px; }
          li { margin-bottom: 6px; line-height: 1.5; }
        </style></head><body>
          <h1>${project.title || 'DIY Project'}</h1>
          <div class="meta">
            <span><b>Difficulty:</b> ${project.difficulty || '—'}</span>
            <span><b>Time:</b> ${project.estimated_time || '—'}</span>
            <span><b>Cost:</b> ${project.estimated_cost || '—'}</span>
          </div>
          <h2>Tools &amp; Materials</h2><ul>${toolsHtml}</ul>
          <h2>Steps</h2><ol>${stepsHtml}</ol>
          ${(project.safety_tips && project.safety_tips.length) ? `<h2>Safety Tips</h2><ul>${project.safety_tips.map(s => `<li>${s}</li>`).join('')}</ul>` : ''}
        </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: project.title });
      } else {
        Alert.alert('PDF created', `Saved to ${uri}`);
      }
    } catch (e) {
      Alert.alert('Export not available', 'Install expo-print and expo-sharing to enable PDF export. Error: ' + e.message);
    }
  };

  // #17 Share as a card (also offers community share if user opted in)
  const shareProject = async () => {
    try {
      const Sharing = require('expo-sharing');
      const summary = `${project.title}\n\nDifficulty: ${project.difficulty}\nTime: ${project.estimated_time}\nCost: ${project.estimated_cost}\n\n${(project.steps || []).slice(0, 3).map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : s.text}`).join('\n')}\n\nGenerated by DIYHelper`;
      // Try to share via React Native's built-in Share
      const RN = require('react-native');
      await RN.Share.share({ message: summary, title: project.title });

      // If opted in, also push to community library
      const optedIn = await getCommunityOptIn();
      if (optedIn) {
        try {
          await submitCommunityProject({
            title: project.title,
            description: originalRequest?.description || '',
            difficulty: project.difficulty,
            estimated_time: project.estimated_time,
            estimated_cost: project.estimated_cost,
            steps: project.steps,
            tools_and_materials: project.tools_and_materials,
          });
        } catch (e) {
          console.warn('community share failed:', e.message);
        }
      }
    } catch (e) {
      Alert.alert('Could not share', e.message);
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
        <Text style={styles.sectionTitle}>{t('tools_and_materials')}</Text>
        <Text style={styles.ownHint}>Tap an item to mark it as something you already own.</Text>
        {project.tools_and_materials?.map((item, index) => {
          const owned = !!findOwned(item);
          return (
            <TouchableOpacity
              key={index}
              style={[styles.materialItem, owned && styles.materialItemOwned]}
              onPress={() => toggleOwned(item)}
              activeOpacity={0.7}
            >
              <Icon
                name={owned ? 'checkbox' : 'square-outline'}
                size={20}
                color={owned ? theme.colors.success : theme.colors.textSecondary}
              />
              <Text style={[styles.listItem, owned && styles.listItemOwned]}>
                {item}{owned ? '  (owned)' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {project.shopping_links && project.shopping_links.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('where_to_buy')}</Text>
          {zip ? (
            <TouchableOpacity
              style={styles.localStoreLink}
              onPress={() => openLink(`https://www.homedepot.com/l/storeSearch?searchText=${zip}`)}
            >
              <Icon name="location-outline" size={16} color={theme.colors.secondary} />
              <Text style={styles.localStoreText}>Find these at Home Depot near {zip}</Text>
            </TouchableOpacity>
          ) : null}
          {project.shopping_links.map((link, index) => {
            const owned = !!findOwned(link.item);
            return (
              <View key={index} style={[styles.shoppingItem, owned && styles.shoppingItemOwned]}>
                <TouchableOpacity
                  style={styles.shoppingHeaderRow}
                  onPress={() => toggleOwned(link.item)}
                  activeOpacity={0.7}
                >
                  <Icon
                    name={owned ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={owned ? theme.colors.success : theme.colors.textSecondary}
                  />
                  <Text style={[styles.shoppingItemName, owned && styles.listItemOwned]}>
                    {link.item}{owned ? '  (owned)' : ''}
                  </Text>
                </TouchableOpacity>
                {!owned && (
                  <View style={styles.shoppingButtons}>
                    {link.amazon_url && (
                      <TouchableOpacity onPress={() => openLink(link.amazon_url)} style={[styles.shopButton, styles.amazonButton]}>
                        <Text style={styles.shopButtonText}>Amazon</Text>
                        <Icon name="open-outline" size={14} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {link.homedepot_url && (
                      <TouchableOpacity onPress={() => openLink(link.homedepot_url)} style={[styles.shopButton, styles.homeDepotButton]}>
                        <Text style={styles.shopButtonText}>Home Depot</Text>
                        <Icon name="open-outline" size={14} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const mediaUrls = originalRequest?.mediaUrls || [];

  // Stable Image source objects keyed by uri. Recreating {uri: ...} on every
  // re-render forces Android to re-decode the file, which blocks the JS thread
  // and makes taps on tabs / "I own this" feel laggy. Caching by uri keeps the
  // same prop reference across renders so RN's image cache hits cleanly.
  const sourceCache = useMemo(() => {
    const map = new Map();
    for (const uri of mediaUrls) {
      if (uri) map.set(uri, { uri });
    }
    return map;
  }, [mediaUrls.join('|')]);
  const sourceFor = useCallback((uri) => sourceCache.get(uri) || { uri }, [sourceCache]);

  const getStepText = (step) => typeof step === 'string' ? step : step.text;
  const getStepAnnotations = (step) => typeof step === 'string' ? [] : (step.image_annotations || []);
  const getStepRefSearch = (step) => typeof step === 'string' ? null : step.reference_image_search;

  const renderStepsTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('project_blueprint')}</Text>

      {/* Photo overview annotations */}
      {project.image_annotations?.length > 0 && mediaUrls.length > 0 && (
        <View style={styles.photoOverviewSection}>
          <Text style={styles.photoOverviewTitle}>{t('photo_analysis')}</Text>
          {project.image_annotations.map((ann, i) => {
            const photoUri = mediaUrls[(ann.photo_number || 1) - 1];
            if (!photoUri) return null;
            return (
              <View key={i} style={styles.photoAnnotationCard}>
                <Image source={sourceFor(photoUri)} style={styles.annotatedPhoto} />
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
                      <Image source={sourceFor(photoUri)} style={styles.stepPhoto} />
                      <View style={styles.stepImageOverlay}>
                        <Icon name="camera" size={14} color={theme.colors.primary} />
                        <Text style={styles.stepImageLabel}>{t('photo')} {ann.photo_number}</Text>
                      </View>
                      <Text style={styles.stepImageCaption}>{ann.description}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Reference image search link — only show when user uploaded photos and a real query exists */}
            {mediaUrls.length > 0 && refSearch && refSearch.trim() !== '' && refSearch.toLowerCase() !== 'null' && (
              <TouchableOpacity
                style={styles.refImageLink}
                onPress={() => openLink(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(refSearch)}`)}
              >
                <Icon name="image-outline" size={16} color={theme.colors.primary} />
                <Text style={styles.refImageText}>{t('view_reference_images')}</Text>
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
      <Text style={styles.sectionTitle}>{t('visual_guides')}</Text>
      {project.youtube_links && project.youtube_links.length > 0 ? (
        project.youtube_links.map((link, index) => (
          <TouchableOpacity key={index} onPress={() => openLink(link)} style={styles.linkItem}>
            <Text style={styles.linkText}>{t('watch_tutorial')} {index + 1}</Text>
            <Icon name="play-circle-outline" size={20} color={theme.colors.danger} />
          </TouchableOpacity>
        ))
      ) : (
        <Text style={styles.emptyText}>{t('no_videos')}</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{project.title || t('project_guide')}</Text>

          {project._fromCache && (
            <View style={styles.cacheBanner}>
              <Icon name="cloud-offline-outline" size={16} color="#92400E" />
              <Text style={styles.cacheBannerText}>Offline — showing cached analysis</Text>
            </View>
          )}

          {project.permit_required && (
            <View style={styles.permitBanner}>
              <Icon name="document-text" size={16} color="#92400E" />
              <Text style={styles.permitBannerText}>
                Permit may be required. {project.permit_notes || 'Check with your local building department.'}
              </Text>
            </View>
          )}

          {project.diy_vs_pro_summary && (
            <View style={styles.diyProCard}>
              <Text style={styles.diyProTitle}>DIY vs. Pro</Text>
              <Text style={styles.diyProSummary}>{project.diy_vs_pro_summary}</Text>
              <View style={styles.diyProGrid}>
                <View style={styles.diyProCol}>
                  <Text style={styles.diyProLabel}>DIY</Text>
                  <Text style={styles.diyProValue}>{project.estimated_cost || '—'}</Text>
                  <Text style={styles.diyProSub}>{project.estimated_time || '—'}</Text>
                </View>
                <View style={styles.diyProCol}>
                  <Text style={styles.diyProLabel}>Pro</Text>
                  <Text style={styles.diyProValue}>{project.pro_cost || '—'}</Text>
                  <Text style={styles.diyProSub}>{project.pro_time || '—'}</Text>
                </View>
              </View>
              {project.recommendation && (
                <Text style={styles.diyProRec}>Recommended: {project.recommendation}</Text>
              )}
            </View>
          )}


          <View style={styles.infoGrid}>
            <View style={styles.infoBox}>
              <Icon name="speedometer-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('difficulty')}</Text>
              <Text style={styles.infoValue}>{project.difficulty}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="time-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('time')}</Text>
              <Text style={styles.infoValue}>{project.estimated_time}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="cash-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('cost')}</Text>
              <Text style={styles.infoValue}>{project.estimated_cost || t('not_available')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <Pressable
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
            </Pressable>
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
            <Text style={styles.actionButtonText}>{t('start_building')}</Text>
          </TouchableOpacity>

          <View style={styles.saveRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.saveButton, { flex: 1 }]}
              onPress={() => saveJob('Honey Do')}
            >
              <Text style={styles.actionButtonText}>{t('honey_do_list')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.saveButton, { flex: 1, backgroundColor: theme.colors.accent }]}
              onPress={() => saveJob('Contractor')}
            >
              <Text style={styles.actionButtonText}>{t('contractor_list')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, styles.profButton]}
            onPress={contactProfessional}
          >
            <Text style={styles.actionButtonText}>{t('get_pro_help_emoji')}</Text>
          </TouchableOpacity>

          <View style={styles.saveRow}>
            <TouchableOpacity
              style={[styles.actionButton, { flex: 1, backgroundColor: theme.colors.textSecondary, marginBottom: 0 }]}
              onPress={shareProject}
            >
              <Text style={styles.actionButtonText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { flex: 1, backgroundColor: theme.colors.textSecondary, marginBottom: 0 }]}
              onPress={exportPdf}
            >
              <Text style={styles.actionButtonText}>Export PDF</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, styles.moreDetailsButton]}
            onPress={() => navigation.navigate('Capture', { existingProject: { project, originalRequest } })}
          >
            <Text style={styles.actionButtonText}>{t('refine_blueprint')}</Text>
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
            <Text style={styles.modalTitle}>{t('job_saved')}</Text>
            <Text style={styles.modalText}>{t('job_saved_msg')} {saveType === 'Honey Do' ? t('honey_do_list') : t('contractor_list')}.</Text>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setModalVisible(false);
                navigation.navigate('Capture');
              }}
            >
              <Text style={styles.modalButtonText}>{t('start_new_project')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.colors.secondary }]}
              onPress={() => {
                setModalVisible(false);
                navigation.navigate(saveType === 'Honey Do' ? 'HoneyDoList' : 'ContractorList');
              }}
            >
              <Text style={styles.modalButtonText}>{t('go_to')} {saveType === 'Honey Do' ? t('honey_do_list') : t('contractor_list')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 10 }}
              onPress={() => setModalVisible(false)}
            >
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{t('stay_here')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        transparent={true}
        visible={contactModalVisible}
        animationType="fade"
        onRequestClose={() => setContactModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContainer}>
            <Icon name="call-outline" size={40} color={theme.colors.danger} style={{ marginBottom: 10 }} />
            <Text style={styles.modalTitle}>{t('contact_info')}</Text>
            <Text style={styles.modalText}>{t('contact_info_desc')}</Text>

            <View style={styles.contactField}>
              <Text style={styles.contactLabel}>{t('phone_us')}</Text>
              <TextInput
                style={styles.contactInput}
                value={contactPhone}
                onChangeText={(text) => setContactPhone(formatUSPhone(text))}
                placeholder="(555) 123-4567"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.contactField}>
              <Text style={styles.contactLabel}>{t('email')}</Text>
              <TextInput
                style={styles.contactInput}
                value={contactEmail}
                onChangeText={setContactEmail}
                placeholder="your@email.com"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.colors.danger }]}
              onPress={submitContactRequest}
              disabled={contactSubmitting}
            >
              <Text style={styles.modalButtonText}>
                {contactSubmitting ? t('submitting') : t('get_help')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 10 }}
              onPress={() => setContactModalVisible(false)}
            >
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
            <Text style={styles.modalTitle}>{t('project_completed')}</Text>
            <Text style={styles.modalText}>{t('project_completed_msg')}</Text>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.colors.success }]}
              onPress={() => {
                setCelebrationVisible(false);
              }}
            >
              <Text style={styles.modalButtonText}>{t('awesome')}</Text>
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
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  materialItemOwned: {
    backgroundColor: theme.colors.success + '12',
  },
  listItem: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginLeft: 8,
    flex: 1,
  },
  listItemOwned: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  ownHint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  shoppingItemOwned: {
    backgroundColor: theme.colors.success + '12',
  },
  shoppingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
  shoppingItem: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.roundness.medium,
    padding: 12,
    marginBottom: 10,
  },
  shoppingItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
    flex: 1,
    marginLeft: 8,
  },
  shoppingButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  shopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.roundness.full,
    flex: 1,
    justifyContent: 'center',
  },
  amazonButton: {
    backgroundColor: '#FF9900',
  },
  homeDepotButton: {
    backgroundColor: '#F96302',
  },
  shopButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  contactField: {
    width: '100%',
    marginBottom: 12,
  },
  contactLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  contactInput: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.roundness.medium,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  celebrationIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  cacheBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', padding: 10, borderRadius: 10, marginBottom: 12,
  },
  cacheBannerText: { color: '#92400E', fontWeight: '600', fontSize: 12 },
  permitBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', padding: 10, borderRadius: 10, marginBottom: 12,
  },
  permitBannerText: { color: '#92400E', fontSize: 12, flex: 1, lineHeight: 16 },
  diyProCard: {
    backgroundColor: theme.colors.background, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12,
  },
  diyProTitle: { fontWeight: '800', color: theme.colors.text, fontSize: 14, marginBottom: 6 },
  diyProSummary: { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  diyProGrid: { flexDirection: 'row', gap: 12 },
  diyProCol: {
    flex: 1, padding: 10, borderRadius: 10, backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center',
  },
  diyProLabel: { fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase' },
  diyProValue: { fontSize: 16, fontWeight: '800', color: theme.colors.primary, marginTop: 4 },
  diyProSub: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  diyProRec: { color: theme.colors.success, fontWeight: '700', fontSize: 13, marginTop: 8 },
  localStoreLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10,
    backgroundColor: theme.colors.secondary + '10', borderRadius: 10, marginBottom: 10,
  },
  localStoreText: { color: theme.colors.secondary, fontWeight: '700', fontSize: 13 },
});
