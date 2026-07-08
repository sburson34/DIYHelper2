// Notifications module calls setNotificationHandler at module scope.
// We reset modules per test to get clean state.

let Notifications;
let requestPermissions, scheduleProjectCheckin, scheduleWeatherAlert, cancelForProject;
let registerForPushNotificationsAsync;
let updateHoneyDoList, updateContractorList;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Must re-declare mocks after resetModules
  jest.mock('react-native', () => ({
    Platform: { OS: 'android', Version: 33, select: (obj) => obj.android || obj.default },
  }));

  jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
    setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
    scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-id-123')),
    cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
    getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[abc]' })),
    setNotificationHandler: jest.fn(),
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  }));

  // Read a global flag so a single test can simulate a simulator without
  // resetModules gymnastics. Defaults to a physical device.
  jest.mock('expo-device', () => ({ get isDevice() { return global.__EXPO_IS_DEVICE !== false; } }));
  global.__EXPO_IS_DEVICE = true;

  jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: { eas: { projectId: 'test-project-id' } } } },
  }));

  jest.mock('../utils/storage', () => ({
    updateHoneyDoList: jest.fn(() => Promise.resolve(true)),
    updateContractorList: jest.fn(() => Promise.resolve(true)),
  }));

  Notifications = require('expo-notifications');
  const storage = require('../utils/storage');
  updateHoneyDoList = storage.updateHoneyDoList;
  updateContractorList = storage.updateContractorList;

  const notifModule = require('../utils/notifications');
  requestPermissions = notifModule.requestPermissions;
  scheduleProjectCheckin = notifModule.scheduleProjectCheckin;
  scheduleWeatherAlert = notifModule.scheduleWeatherAlert;
  cancelForProject = notifModule.cancelForProject;
  registerForPushNotificationsAsync = notifModule.registerForPushNotificationsAsync;
});

describe('requestPermissions', () => {
  it('returns true when already granted', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const granted = await requestPermissions();
    expect(granted).toBe(true);
  });

  it('requests permissions when not granted and grants them', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const granted = await requestPermissions();
    expect(granted).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('returns false when denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const granted = await requestPermissions();
    expect(granted).toBe(false);
  });

  it('sets up Android notification channel', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await requestPermissions();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({
      name: 'DIYHelper reminders',
    }));
  });

  it('returns false on error', async () => {
    Notifications.getPermissionsAsync.mockRejectedValue(new Error('fail'));
    const granted = await requestPermissions();
    expect(granted).toBe(false);
  });
});

describe('scheduleProjectCheckin', () => {
  it('schedules a notification and tracks reminder', async () => {
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-1');
    const project = { id: '1', title: 'Fix sink', scheduledReminderIds: [] };
    const id = await scheduleProjectCheckin(project, 3);
    expect(id).toBe('notif-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        title: expect.stringContaining('Fix sink'),
      }),
      trigger: { seconds: 259200 },
    }));
    expect(updateHoneyDoList).toHaveBeenCalled();
  });

  it('enforces minimum 60 seconds', async () => {
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-2');
    await scheduleProjectCheckin({ id: '1', title: 'Test', scheduledReminderIds: [] }, 0);
    const call = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(call.trigger.seconds).toBe(60);
  });
});

describe('scheduleWeatherAlert', () => {
  it('schedules with a date trigger', async () => {
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-3');
    const project = { id: '1', title: 'Deck', scheduledReminderIds: [] };
    const when = new Date('2026-04-15T12:00:00Z').toISOString();
    const id = await scheduleWeatherAlert(project, when, 'Great weather');
    expect(id).toBe('notif-3');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        body: 'Great weather',
      }),
    }));
  });

  it('returns null for invalid date', async () => {
    const id = await scheduleWeatherAlert({ id: '1' }, 'not-a-date');
    expect(id).toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('returns null when no date provided', async () => {
    const id = await scheduleWeatherAlert({ id: '1' }, null);
    expect(id).toBeNull();
  });
});

describe('cancelForProject', () => {
  it('cancels all scheduled reminders', async () => {
    await cancelForProject({ scheduledReminderIds: ['a', 'b', 'c'] });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
  });

  it('handles missing scheduledReminderIds', async () => {
    await cancelForProject({});
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('handles null project', async () => {
    await cancelForProject(null);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('registerForPushNotificationsAsync', () => {
  it('returns an Expo token when permission granted on a device', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const token = await registerForPushNotificationsAsync();
    expect(token).toBe('ExponentPushToken[abc]');
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' });
  });

  it('creates the high-importance promotions channel on Android', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await registerForPushNotificationsAsync();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('promotions', expect.objectContaining({
      name: 'Offers & promotions',
    }));
  });

  it('returns null when permission denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const token = await registerForPushNotificationsAsync();
    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns null on a non-physical device (simulator)', async () => {
    global.__EXPO_IS_DEVICE = false;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const token = await registerForPushNotificationsAsync();
    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    global.__EXPO_IS_DEVICE = true;
  });
});

describe('trackReminder routing', () => {
  it('updates contractor list for contractor projects', async () => {
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-4');
    const project = { id: '1', title: 'Roof', quoteStatus: 'sent', scheduledReminderIds: [] };
    await scheduleProjectCheckin(project, 1);
    expect(updateContractorList).toHaveBeenCalled();
    expect(updateHoneyDoList).not.toHaveBeenCalled();
  });
});
