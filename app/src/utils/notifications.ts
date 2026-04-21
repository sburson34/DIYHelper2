import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { updateHoneyDoList, updateContractorList, Project } from './storage';

// Show notifications while the app is in the foreground. The shape of
// NotificationBehavior varies between SDK versions (newer SDKs split
// shouldShowAlert into shouldShowBanner + shouldShowList for iOS); cast
// through unknown so this compiles against either.
Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    } as unknown as Notifications.NotificationBehavior),
});

export const requestPermissions = async (): Promise<boolean> => {
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

type NotificationContent = Parameters<typeof Notifications.scheduleNotificationAsync>[0]['content'];
type NotificationTrigger = Parameters<typeof Notifications.scheduleNotificationAsync>[0]['trigger'];

const scheduleLocal = async (
  content: NotificationContent,
  trigger: NotificationTrigger,
): Promise<string | null> => {
  try {
    return await Notifications.scheduleNotificationAsync({ content, trigger });
  } catch (e) {
    console.warn('schedule notification failed', e);
    return null;
  }
};

export const scheduleProjectCheckin = async (
  project: Project,
  daysFromNow = 3,
): Promise<string | null> => {
  const seconds = Math.max(60, Math.round(daysFromNow * 86400));
  const id = await scheduleLocal(
    {
      title: `How's "${project.title || 'your project'}" going?`,
      body: `Tap to pick up where you left off.`,
      data: { projectId: project.id, kind: 'checkin' },
    } as NotificationContent,
    { seconds } as NotificationTrigger,
  );
  if (id) await trackReminder(project, id);
  return id;
};

export const scheduleWeatherAlert = async (
  project: Project,
  goodDayIso: string | null | undefined,
  label?: string,
): Promise<string | null> => {
  if (!goodDayIso) return null;
  const when = new Date(goodDayIso);
  if (isNaN(when.getTime())) return null;
  const id = await scheduleLocal(
    {
      title: `Good day to work on "${project.title || 'your project'}"`,
      body: label || `The weather looks right for outdoor work.`,
      data: { projectId: project.id, kind: 'weather' },
    } as NotificationContent,
    { date: when } as NotificationTrigger,
  );
  if (id) await trackReminder(project, id);
  return id;
};

export const cancelForProject = async (project: Project | null | undefined): Promise<void> => {
  const ids: string[] = (project && (project.scheduledReminderIds as string[])) || [];
  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }
};

const trackReminder = async (project: Project, id: string): Promise<void> => {
  const list = Array.isArray(project.scheduledReminderIds) ? (project.scheduledReminderIds as string[]) : [];
  const next: Project = { ...project, scheduledReminderIds: [...list, id] };
  try {
    if ((project as { _list?: string })._list === 'contractor' || project.quoteStatus) {
      await updateContractorList(next);
    } else {
      await updateHoneyDoList(next);
    }
  } catch {}
};
