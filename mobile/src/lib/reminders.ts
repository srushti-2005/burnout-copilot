import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Expo Go cannot load expo-notifications on Android (SDK 53+), so we skip it there.
export const remindersSupported =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

function getNotifications(): any {
  // loaded lazily, only when NOT running in Expo Go
  return require('expo-notifications');
}

export function initReminders() {
  if (!remindersSupported) return;
  const N = getNotifications();
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function onReminderTapped(cb: (route: string) => void): () => void {
  if (!remindersSupported) return () => {};
  const N = getNotifications();
  const sub = N.addNotificationResponseReceivedListener((resp: any) => {
    const route = resp.notification.request.content.data?.route;
    if (route) cb(route);
  });
  return () => sub.remove();
}

export async function enableReminders(everyMinutes: number): Promise<boolean> {
  if (!remindersSupported) return false;
  const N = getNotifications();

  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('checkin', {
      name: 'Check-in reminders',
      importance: N.AndroidImportance.DEFAULT,
    });
  }
  const perm = await N.requestPermissionsAsync();
  if (!perm.granted) return false;

  await N.cancelAllScheduledNotificationsAsync();
  await N.scheduleNotificationAsync({
    content: {
      title: 'Quick check-in',
      body: `What were the last ${everyMinutes} minutes?`,
      data: { route: '/checkin' },
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(60, everyMinutes * 60),
      repeats: true,
      channelId: 'checkin',
    },
  });
  return true;
}

export async function disableReminders() {
  if (!remindersSupported) return;
  await getNotifications().cancelAllScheduledNotificationsAsync();
}