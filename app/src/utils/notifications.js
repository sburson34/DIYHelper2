import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { updateHoneyDoList, updateContractorList } from './storage';

// Show notifications while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const requestPermissions = async () => {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'DIYHelper reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    return status === 'granted';
  } catch (e) {
    console.warn('notifications permission error', e);
    return false;
  }
};

const scheduleLocal = async (content, trigger) => {
  try {
    return await Notifications.scheduleNotificationAsync({ content, trigger });
  } catch (e) {
    console.warn('schedule notification failed', e);
    return null;
  }
};

export const scheduleProjectCheckin = async (project, daysFromNow = 3) => {
  const seconds = Math.max(60, Math.round(daysFromNow * 86400));
  const id = await scheduleLocal(
    {
      title: `How's "${project.title || 'your project'}" going?`,
      body: `Tap to pick up where you left off.`,
      data: { projectId: project.id, kind: 'checkin' },
    },
    { seconds }
  );
  if (id) await trackReminder(project, id);
  return id;
};

export const scheduleWeatherAlert = async (project, goodDayIso, label) => {
  if (!goodDayIso) return null;
  const when = new Date(goodDayIso);
  if (isNaN(when.getTime())) return null;
  const id = await scheduleLocal(
    {
      title: `Good day to work on "${project.title || 'your project'}"`,
      body: label || `The weather looks right for outdoor work.`,
      data: { projectId: project.id, kind: 'weather' },
    },
    { date: when }
  );
  if (id) await trackReminder(project, id);
  return id;
};

export const cancelForProject = async (project) => {
  const ids = (project && project.scheduledReminderIds) || [];
  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }
};

const trackReminder = async (project, id) => {
  const list = Array.isArray(project.scheduledReminderIds) ? project.scheduledReminderIds : [];
  const next = { ...project, scheduledReminderIds: [...list, id] };
  try {
    if (project._list === 'contractor' || project.quoteStatus) {
      await updateContractorList(next);
    } else {
      await updateHoneyDoList(next);
    }
  } catch {}
};
