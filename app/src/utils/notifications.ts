import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  createPushRegistration,
  defaultPushCopy,
  resolveExpoProjectId,
  type AndroidChannelConfig,
  type PushCopy,
  type PushRegistrationStatus,
} from '@sburson34/mobile-shared/push';
import { updateHoneyDoList, updateContractorList, Project } from './storage';
import { registerPushToken, unregisterPushToken } from '../api/backendClient';
import { BRAND_NAME } from '../config/appInfo';

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

// ── Promotional (server-sent) push ─────────────────────────────────────
// Registration is the shared @sburson34/mobile-shared/push machinery: it asks
// permission, creates the Android channels, fetches the Expo token and POSTs it
// through the app's own API client — and every exit reports a
// PushRegistrationStatus with a sentence the screen can show, instead of a bare
// null that hid WHY a device can't be reached (simulator, missing push
// credential, no EAS projectId, backend refused). The status is also persisted,
// so a settings screen can read it later via getLastPushRegistrationStatus().

// Channel settings are create-once on Android: changing importance/sound needs
// a NEW id. "default" carries the local reminders; "promotions" is a dedicated
// high-importance channel so offers surface as a banner and users can mute
// promos separately in OS settings. Built lazily (a function) so a test double
// of expo-notifications without AndroidImportance can't crash the import.
const promoChannels = (): AndroidChannelConfig[] => [
  { id: 'default', name: 'DIYHelper reminders', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'promotions', name: 'Offers & promotions', importance: Notifications.AndroidImportance.HIGH },
];

export const PUSH_COPY: PushCopy = defaultPushCopy(BRAND_NAME);

export const promoPush = createPushRegistration({
  appName: BRAND_NAME,
  endpoint: '/api/push/register',
  // backendClient.registerPushToken owns the path + breadcrumb and throws on a
  // non-2xx, which is what lets the shared status record a backend refusal.
  // Brand + device id ride along as X-Brand / X-Device-Id headers.
  post: (_endpoint, body) => {
    const b = body as { token: string; platform: string };
    return registerPushToken(b.token, b.platform, true);
  },
  buildBody: ({ token, platform }) => ({ token, platform, marketingOptIn: true }),
  channels: promoChannels,
  copy: PUSH_COPY,
});

/** Ask for permission (prompting if needed), fetch the token, register it for promos. Never throws. */
export const registerForPromoPush = (): Promise<PushRegistrationStatus> => promoPush.registerPushToken(true);

/**
 * Whether the user's opt-in should be recorded. `registered` obviously; a token
 * the backend failed to store also counts — the user DID consent, and the old
 * flow never un-ticked the box over a server blip either. Anything else
 * (denied, simulator, misconfigured build, token fetch failed) is not an opt-in.
 */
export const promoPushAccepted = (status: PushRegistrationStatus): boolean =>
  status.state === 'registered' || (status.state === 'failed' && status.reason === PUSH_COPY.backendRejected);

/**
 * Opt this device out of promotional pushes. Best-effort and silent: fetches
 * the current token WITHOUT prompting (turning something off must never raise
 * the OS permission dialog) and tells the server to stop sending to it.
 */
export const unregisterPromoPush = async (): Promise<void> => {
  try {
    if (!Device.isDevice) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = resolveExpoProjectId();
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (token) await unregisterPushToken(token);
  } catch (e) {
    console.warn('push unregister failed', e);
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

// Schedule a standalone maintenance reminder not tied to a saved Project (e.g.
// "remind me to schedule my next furnace service"). Returns the notification id
// so the caller can cancel it, or null if scheduling failed. monthsFromNow is
// clamped to at least ~1 hour so a "0" can't fire instantly.
export const scheduleMaintenanceReminder = async (
  title: string,
  body: string,
  monthsFromNow = 6,
): Promise<string | null> => {
  const seconds = Math.max(3600, Math.round(monthsFromNow * 30 * 86400));
  return scheduleLocal(
    {
      title,
      body,
      data: { kind: 'maintenance' },
    } as NotificationContent,
    { seconds } as NotificationTrigger,
  );
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
