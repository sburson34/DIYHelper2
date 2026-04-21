import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity, Modal, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { updateHoneyDoList, updateContractorList, removeFromHoneyDoList, removeFromContractorList, getAppPrefs } from '../utils/storage';
import { useTranslation } from '../i18n/I18nContext';
import theme from '../theme';
import { getWeather, uploadReceipt } from '../api/backendClient';
import { cancelForProject } from '../utils/notifications';
import * as ImagePicker from 'expo-image-picker';

// Steps from the AI analyzer are either plain strings (older projects, simple
// responses) or objects like { text, image_annotations, reference_image_search }.
// Rendering the object directly crashes with "Objects are not valid as a React child".
const getStepText = (step) => (typeof step === 'string' ? step : step?.text || '');

export default function ProjDet({ navigation, route }) {
  const { t } = useTranslation();
  const TABS = [
    { id: 'tools', label: t('tab_tools'), icon: 'hammer-outline' },
    { id: 'steps', label: t('tab_steps'), icon: 'list-outline' },
    { id: 'videos', label: t('tab_videos'), icon: 'play-circle-outline' },
    { id: 'receipts', label: 'Receipts', icon: 'receipt-outline' },
  ];
  const { project: initialProject, listType } = route.params || {};
  const [project, setProject] = useState(initialProject);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('steps');
  const [weather, setWeather] = useState(null);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState(
    initialProject?.checkedSteps || new Array(initialProject?.steps?.length || 0).fill(false)
  );

  // Fetch weather only for outdoor projects with a zip on file
  useEffect(() => {
    if (!initialProject?.outdoor) return;
    (async () => {
      try {
        const prefs = await getAppPrefs();
        if (!prefs.zip) return;
        const data = await getWeather(prefs.zip, 5);
        setWeather(data);
      } catch {}
    })();
  }, [initialProject?.outdoor]);

  useEffect(() => {
    // Update local storage when checkedSteps change
    const updatedProject = { ...project, checkedSteps };
    if (listType === 'honey-do') {
      updateHoneyDoList(updatedProject);
    } else if (listType === 'contractor') {
      updateContractorList(updatedProject);
    }
    setProject(updatedProject);
    // `project` is intentionally omitted — this effect calls setProject, so
    // including it would cause an infinite loop. `listType` is stable from
    // route params for the lifetime of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      t('delete_project'),
      t('delete_project_msg'),
      [
        { text: t('cancel'), style: "cancel" },
        {
          text: t('delete'),
          style: "destructive",
          onPress: async () => {
            try { await cancelForProject(project); } catch {}
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

  const scanReceipt = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan a receipt.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      setScanningReceipt(true);
      const parsed = await uploadReceipt({
        base64Image: result.assets[0].base64,
        mimeType: 'image/jpeg',
        projectId: project.id,
      });
      const existing = Array.isArray(project.purchasedMaterials) ? project.purchasedMaterials : [];
      const updated = {
        ...project,
        purchasedMaterials: [
          ...existing,
          {
            receiptId: Date.now().toString(),
            merchant: parsed.merchant,
            date: parsed.date,
            total: parsed.total,
            lineItems: parsed.lineItems || [],
          },
        ],
      };
      setProject(updated);
      if (listType === 'honey-do') await updateHoneyDoList(updated);
      else await updateContractorList(updated);
      Alert.alert('Receipt saved', `${parsed.merchant || 'Merchant'} · ${parsed.lineItems?.length || 0} items · total $${parsed.total || 0}`);
    } catch (e) {
      Alert.alert('Receipt scan failed', e.message || 'Unknown error');
    } finally {
      setScanningReceipt(false);
    }
  };

  const receiptsTotal = (project?.purchasedMaterials || [])
    .reduce((sum, r) => sum + (Number(r.total) || 0), 0);

  const renderToolsTab = () => (
    <View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('tools_and_materials')}</Text>
        {project?.tools_and_materials?.map((item, index) => (
          <View key={index} style={styles.materialItem}>
            <Icon name="checkmark-circle" size={18} color={theme.colors.accent} />
            <Text style={styles.listItem}>{item}</Text>
          </View>
        ))}
      </View>

      {project?.shopping_links && project.shopping_links.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('where_to_buy')}</Text>
          {project.shopping_links.map((link, index) => (
            <TouchableOpacity key={index} onPress={() => openLink(link.url)} style={styles.linkItem}>
              <Text style={styles.linkText}>{t('buy')} {link.item}</Text>
              <Icon name="open-outline" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderStepsTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('project_blueprint_emoji')}</Text>
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
          ]}>{getStepText(step)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderVideosTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t('visual_guides')}</Text>
      {project?.youtube_links && project.youtube_links.length > 0 ? (
        project.youtube_links.map((link, index) => {
          if (typeof link === 'string') {
            return (
              <TouchableOpacity key={index} onPress={() => openLink(link)} style={styles.linkItem}>
                <Text style={styles.linkText}>{t('watch_tutorial')} {index + 1}</Text>
                <Icon name="play-circle-outline" size={20} color={theme.colors.danger} />
              </TouchableOpacity>
            );
          }
          const url = link.url || (link.videoId ? `https://www.youtube.com/watch?v=${link.videoId}` : null);
          return (
            <TouchableOpacity key={index} onPress={() => openLink(url)} style={styles.videoCard}>
              {link.thumbnailUrl ? (
                <Image source={{ uri: link.thumbnailUrl }} style={styles.videoThumb} />
              ) : (
                <View style={[styles.videoThumb, { backgroundColor: theme.colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                  <Icon name="play-circle-outline" size={30} color={theme.colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={2}>
                  {link.title || link.query || `Tutorial ${index + 1}`}
                </Text>
                {link.channel ? (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                    {link.channel}
                  </Text>
                ) : null}
              </View>
              <Icon name="play-circle" size={24} color={theme.colors.danger} />
            </TouchableOpacity>
          );
        })
      ) : (
        <Text style={styles.emptyText}>{t('no_videos')}</Text>
      )}
    </View>
  );

  const renderReceiptsTab = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Receipts</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
        Spent so far: ${receiptsTotal.toFixed(2)} · Estimated: {project?.estimated_cost || '—'}
      </Text>
      <TouchableOpacity
        style={[styles.linkItem, { backgroundColor: theme.colors.primary + '20' }]}
        onPress={scanReceipt}
        disabled={scanningReceipt}
      >
        <Text style={[styles.linkText, { color: theme.colors.primary }]}>
          {scanningReceipt ? 'Scanning…' : '+ Scan a receipt'}
        </Text>
        <Icon name="camera-outline" size={20} color={theme.colors.primary} />
      </TouchableOpacity>
      {(project?.purchasedMaterials || []).map((r, i) => (
        <View key={i} style={{ padding: 12, backgroundColor: theme.colors.background, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '800' }}>{r.merchant || 'Receipt'}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {r.date || ''} · ${Number(r.total || 0).toFixed(2)}
          </Text>
          {(r.lineItems || []).slice(0, 6).map((li, j) => (
            <Text key={j} style={{ color: theme.colors.textSecondary, fontSize: 11, marginLeft: 4, marginTop: 2 }}>
              • {li.description} {li.total ? `— $${Number(li.total).toFixed(2)}` : ''}
            </Text>
          ))}
        </View>
      ))}
      {(!project?.purchasedMaterials || project.purchasedMaterials.length === 0) && (
        <Text style={styles.emptyText}>No receipts yet.</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{project?.title || t('project_details')}</Text>

          <View style={styles.infoGrid}>
            <View style={styles.infoBox}>
              <Icon name="speedometer-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('difficulty')}</Text>
              <Text style={styles.infoValue}>{project?.difficulty}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="time-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('time')}</Text>
              <Text style={styles.infoValue}>{project?.estimated_time}</Text>
            </View>
            <View style={styles.infoBox}>
              <Icon name="cash-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.infoLabel}>{t('cost')}</Text>
              <Text style={styles.infoValue}>{project?.estimated_cost || t('not_available')}</Text>
            </View>
          </View>

          {weather && weather.forecast && weather.forecast.length > 0 && (
            <View style={styles.weatherBanner}>
              <Icon
                name={weather.forecast.some(d => d.goodForOutdoorWork) ? 'sunny-outline' : 'rainy-outline'}
                size={18}
                color={weather.forecast.some(d => d.goodForOutdoorWork) ? '#047857' : '#92400E'}
              />
              <Text style={styles.weatherBannerText}>
                {weather.forecast.find(d => d.goodForOutdoorWork)
                  ? `Good weather for outdoor work on ${weather.forecast.find(d => d.goodForOutdoorWork).date}`
                  : `No ideal outdoor days in the next ${weather.forecast.length} day forecast`}
              </Text>
            </View>
          )}
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
          {activeTab === 'receipts' && renderReceiptsTab()}
        </View>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
        >
          <Icon name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteButtonText}>{t('delete_project')}</Text>
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
  },
  videoCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 10, borderRadius: 12, backgroundColor: theme.colors.background, marginBottom: 10,
  },
  videoThumb: { width: 96, height: 54, borderRadius: 6 },
  weatherBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 14, padding: 10, borderRadius: 10, backgroundColor: '#ECFDF5',
  },
  weatherBannerText: { color: '#065F46', fontSize: 13, fontWeight: '700', flex: 1 },
});
