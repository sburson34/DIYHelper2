import AsyncStorage from '@react-native-async-storage/async-storage';

const HONEY_DO_KEY = '@honey_do_list';
const CONTRACTOR_KEY = '@contractor_list';

const generateId = () => Date.now().toString();

export const saveToHoneyDoList = async (project) => {
  try {
    const existing = await getHoneyDoList();
    const newProject = { ...project, id: generateId(), createdAt: new Date().toISOString() };
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to honey do list', e);
    return false;
  }
};

export const getHoneyDoList = async () => {
  try {
    const value = await AsyncStorage.getItem(HONEY_DO_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list) ? list.filter(item => item && (item.id || item.title)) : [];
  } catch (e) {
    console.error('Failed to fetch honey do list', e);
    return [];
  }
};

export const updateHoneyDoList = async (updatedProject) => {
  try {
    const existing = await getHoneyDoList();
    const updated = existing.map(p => p.id === updatedProject.id ? updatedProject : p);
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update honey do list', e);
    return false;
  }
};

export const removeFromHoneyDoList = async (id) => {
  try {
    const existing = await getHoneyDoList();
    const updated = existing.filter(p => p.id !== id);
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to remove from honey do list', e);
    return false;
  }
};

export const saveToContractorList = async (project) => {
  try {
    const existing = await getContractorList();
    const newProject = { ...project, id: generateId(), createdAt: new Date().toISOString() };
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to contractor list', e);
    return false;
  }
};

export const getContractorList = async () => {
  try {
    const value = await AsyncStorage.getItem(CONTRACTOR_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list) ? list.filter(item => item && (item.id || item.title)) : [];
  } catch (e) {
    console.error('Failed to fetch contractor list', e);
    return [];
  }
};

export const updateContractorList = async (updatedProject) => {
  try {
    const existing = await getContractorList();
    const updated = existing.map(p => p.id === updatedProject.id ? updatedProject : p);
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update contractor list', e);
    return false;
  }
};

export const removeFromContractorList = async (id) => {
  try {
    const existing = await getContractorList();
    const updated = existing.filter(p => p.id !== id);
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to remove from contractor list', e);
    return false;
  }
};
