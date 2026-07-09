import React, { useCallback, useEffect, useRef } from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';

// Swallow any error from preventAutoHideAsync — if it fails, the OS hides
// the splash on its own, which is strictly better than crashing at boot.
try { SplashScreen.preventAutoHideAsync(); } catch {}

// Safety net: no matter what happens during init (Sentry hanging, a provider
// throwing async, a native module failing to register), hide the splash after
// a hard timeout so the user always sees either the app or a red-box error.
// Without this, any silent init failure leaves the phone stuck on the logo.
setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 4000);
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme, DrawerActions } from '@react-navigation/native';
import { navigationIntegration } from './src/services/sentry';
import { track } from './src/services/telemetry';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Ionicons as Icon } from '@expo/vector-icons';
import CaptureScreen from './src/screens/CaptureScreen';
import ResultScreen from './src/screens/ResultScreen';
import SafetyScreen from './src/screens/SafetyScreen';
import ProjDet from './src/screens/ProjDet';
import WorkSteps from './src/screens/WorkSteps';
import PaintMatchScreen from './src/screens/PaintMatchScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AiConsentScreen from './src/screens/AiConsentScreen';
import AnnotateScreen from './src/screens/AnnotateScreen';
import WorkshopARScreen from './src/screens/WorkshopARScreen';
import LiveHelpScreen from './src/screens/LiveHelpScreen';
import HoneyDo from './src/screens/HoneyDo';
import Contractors from './src/screens/Contractors';
import Settings from './src/screens/Settings';
import Inventory from './src/screens/Inventory';
import ShoppingList from './src/screens/ShoppingList';
import Emergency from './src/screens/Emergency';
import Diagnose from './src/screens/Diagnose';
import Quotes from './src/screens/Quotes';
import Community from './src/screens/Community';
import ReportProblem from './src/screens/ReportProblem';
import TriageScreen from './src/screens/TriageScreen';
import BookingScreen from './src/screens/BookingScreen';
import MyJobsScreen from './src/screens/MyJobsScreen';
import TechLoginScreen from './src/screens/tech/TechLoginScreen';
import TechJobsScreen from './src/screens/tech/TechJobsScreen';
import TechJobDetailScreen from './src/screens/tech/TechJobDetailScreen';
import { TechAuthProvider, useTechAuth } from './src/tech/TechAuthContext';
import theme from './src/theme';
import { I18nProvider, useTranslation } from './src/i18n/I18nContext';
import { ThemeProvider } from './src/ThemeContext';
import { FeaturesProvider } from './src/config/features';
import { BrandConfigProvider, useBrandConfig } from './src/config/brandConfig';
import { TranslationProvider } from './src/mlkit/TranslationProvider';
import { requestCaptureReset } from './src/utils/captureBus';
import { getOnboardingSeen, setOnboardingSeen, getAiConsent, AI_CONSENT_VERSION, getPromoConsent } from './src/utils/storage';
import PromoConsentScreen from './src/screens/PromoConsentScreen';
import { useFonts } from 'expo-font';
import { brandFontAssets } from './src/fonts';
import { fontKeysFor } from './src/fontNames';
import { BRAND_FONT } from './src/config/appInfo';
import { applyGlobalFont } from './src/applyGlobalFont';
import ScreenErrorBoundary from './src/components/ScreenErrorBoundary';

// Helper used by both the logo header and the "New Project" drawer item.
// Asks the Capture screen to reset (it decides whether to prompt) and pops
// the capture stack back to the root so we always land on the main screen.
const goToFreshCapture = (navigation) => {
  requestCaptureReset();
  navigation.navigate('NewProject', { screen: 'Capture' });
};

const LogoHeader = ({ onPress, title, subtitle }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={onPress ? 0.7 : 1}
    style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16 }}
  >
    <Image
      source={require('./assets/logo.png')}
      style={{ width: 48, height: 48, borderRadius: 12, resizeMode: 'cover' }}
    />
    <View style={{ marginLeft: 12 }}>
      <Text style={{
        fontSize: 18,
        fontWeight: 'bold',
        color: '#FFFFFF',
        letterSpacing: -0.5
      }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{
          fontSize: 11,
          color: '#94A3B8', // slate-400
          fontWeight: '500'
        }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  </TouchableOpacity>
);

// Shared drawer-screen options for the pro-services screens (Triage, Book, My
// Jobs). Produces the same header + menu-button chrome the other drawer items
// build inline; centralized here so the additions stay readable.
const proScreenOptions = ({ navigation, t, title, icon, iconColor }) => ({
  title,
  headerShown: true,
  headerTitle: () => (
    <LogoHeader onPress={() => navigation.navigate('NewProject')} title={title} subtitle={t('app_title')} />
  ),
  headerTitleAlign: 'left',
  headerRight: () => (
    <TouchableOpacity
      onPress={() => navigation.openDrawer()}
      style={{ marginRight: 15 }}
      accessibilityLabel="Open navigation menu"
      accessibilityRole="button"
    >
      <Icon name="menu" size={30} color="#FFFFFF" />
    </TouchableOpacity>
  ),
  headerLeft: () => null,
  drawerIcon: ({ color, size }) => <Icon name={icon} size={size} color={iconColor || color} />,
});

const Stack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();

// Per-screen wrappers so the error boundary resets when navigating away and back.
const CaptureWithBoundary = (props) => (
  <ScreenErrorBoundary screenName="CaptureScreen">
    <CaptureScreen {...props} />
  </ScreenErrorBoundary>
);
const ResultWithBoundary = (props) => (
  <ScreenErrorBoundary screenName="ResultScreen">
    <ResultScreen {...props} />
  </ScreenErrorBoundary>
);
const DiagnoseWithBoundary = (props) => (
  <ScreenErrorBoundary screenName="DiagnoseScreen">
    <Diagnose {...props} />
  </ScreenErrorBoundary>
);

// Deep linking: diyhelper://project/<id> and https://diyhelper.org/project/<id>
// both open ProjectDetail with the given id. Anything else falls through to the
// default initial route.
const linking = {
  prefixes: ['diyhelper://', 'https://diyhelper.org'],
  config: {
    screens: {
      NewProject: {
        screens: {
          ProjectDetail: 'project/:id',
          Result: 'result',
          Capture: '',
        },
      },
      HoneyDoList: 'honey-do',
      ContractorList: 'contractors',
      Triage: 'triage',
      Book: 'book',
      MyJobs: 'my-jobs',
      Emergency: 'emergency',
      Settings: 'settings',
    },
  },
};

const MyTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    notification: theme.colors.secondary,
  },
};

function CaptureStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator
      initialRouteName="Capture"
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.text,
          elevation: 0,
          shadowOpacity: 0,
          height: 120,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        },
        headerTitleStyle: {
          fontWeight: 'bold',
          color: '#FFFFFF',
        },
        headerTintColor: '#FFFFFF',
      }}
    >
      <Stack.Screen
        name="Capture"
        component={CaptureWithBoundary}
        options={({ navigation }) => ({
          headerTitle: () => <LogoHeader onPress={() => goToFreshCapture(navigation)} title={t('app_title')} subtitle={t('app_subtitle')} />,
          headerTitleAlign: 'left',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              style={{ marginRight: 15, padding: 10 }}
              accessibilityLabel="Open navigation menu"
              accessibilityRole="button"
            >
              <Icon name="menu" size={30} color="#FFFFFF" />
            </TouchableOpacity>
          ),
          headerLeft: () => null,
        })}
      />
      <Stack.Screen
        name="Result"
        component={ResultWithBoundary}
        options={{ title: t('nav_project_steps') }}
      />
      <Stack.Screen
        name="Safety"
        component={SafetyScreen}
        options={{ title: t('nav_safety_first') }}
      />
      <Stack.Screen
        name="ProjectDetail"
        component={ProjDet}
        options={{ title: t('nav_project_detail') }}
      />
      <Stack.Screen
        name="WorkshopSteps"
        component={WorkSteps}
        options={{ title: t('nav_workshop_mode') }}
      />
      <Stack.Screen
        name="PaintMatch"
        component={PaintMatchScreen}
        options={{ title: 'Paint Color Match' }}
      />
      <Stack.Screen
        name="Annotate"
        component={AnnotateScreen}
        options={{ title: 'Annotate Photo', headerShown: false }}
      />
      <Stack.Screen
        name="WorkshopAR"
        component={WorkshopARScreen}
        options={{ title: 'AR Guide', headerShown: false }}
      />
      <Stack.Screen
        name="LiveHelp"
        component={LiveHelpScreen}
        options={{ title: 'Live DIY Coach' }}
      />
    </Stack.Navigator>
  );
}

// Native "tech mode": a self-contained stack that shows the login screen until
// a technician is signed in, then their job list + job detail. Auth state comes
// from TechAuthProvider; switching login↔jobs happens by swapping the registered
// screens (React Navigation resets cleanly on the set change).
const TechStackNav = createNativeStackNavigator();
function TechStack() {
  const { ready, tech } = useTechAuth();
  const { t } = useTranslation();
  if (!ready) return null;
  return (
    <TechStackNav.Navigator>
      {tech ? (
        <>
          <TechStackNav.Screen name="TechJobs" component={TechJobsScreen} options={{ headerShown: false }} />
          <TechStackNav.Screen
            name="TechJobDetail"
            component={TechJobDetailScreen}
            options={{
              title: t('tech_job_title'),
              headerStyle: { backgroundColor: theme.colors.text },
              headerTintColor: '#FFFFFF',
            }}
          />
        </>
      ) : (
        <TechStackNav.Screen name="TechLogin" component={TechLoginScreen} options={{ headerShown: false }} />
      )}
    </TechStackNav.Navigator>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const config = useBrandConfig();
  // Hand the NavigationContainer ref to Sentry's react-navigation integration
  // so route changes are emitted as breadcrumbs (and tx spans when tracing).
  const navigationRef = useRef(null);

  // Route a tapped promotional push. Backend campaigns may carry a { url }
  // payload (deep link into the app via its scheme, or an external https link);
  // open whatever's there. Harmless no-op for notifications without a url.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response?.notification?.request?.content?.data;
      const url = data && typeof data.url === 'string' ? data.url : null;
      if (url) Linking.openURL(url).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer
      theme={MyTheme}
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        try {
          navigationIntegration.registerNavigationContainer(navigationRef);
        } catch {
          // Sentry not initialized (no DSN) — safe to ignore.
        }
        SplashScreen.hideAsync().catch(() => {});
      }}
      onStateChange={(state) => {
        // Anonymous product telemetry: record which screen the user landed on.
        // Best-effort — never let a telemetry hiccup break navigation.
        try {
          const route = state?.routes?.[state.index];
          if (route?.name) {
            track('screen_viewed', { screen: route.name });
          }
        } catch {
          // ignore
        }
      }}
    >
      <Drawer.Navigator
        initialRouteName="NewProject"
        screenOptions={{
          drawerActiveTintColor: theme.colors.primary,
          drawerInactiveTintColor: theme.colors.textSecondary,
          drawerStyle: {
            backgroundColor: theme.colors.surface,
            width: 280,
            borderTopRightRadius: theme.roundness.large,
            borderBottomRightRadius: theme.roundness.large,
          },
          headerShown: false,
          headerStyle: {
            backgroundColor: theme.colors.text,
            elevation: 0,
            shadowOpacity: 0,
            borderBottomLeftRadius: 32,
            borderBottomRightRadius: 32,
            height: 120,
          },
          headerTitleStyle: {
            fontWeight: 'bold',
            color: '#FFFFFF',
          },
          headerTintColor: '#FFFFFF',
        }}
      >
        <Drawer.Screen
          name="NewProject"
          children={() => (
            <ScreenErrorBoundary screenName="CaptureStack">
              <CaptureStack />
            </ScreenErrorBoundary>
          )}
          listeners={({ navigation }) => ({
            drawerItemPress: (e) => {
              // Always fire a reset request when "New Project" is tapped from the drawer.
              // CaptureScreen decides whether to prompt (focused + dirty) or just clear.
              requestCaptureReset();
              // Then ensure we land on the Capture screen at the root of its stack.
              e.preventDefault();
              navigation.navigate('NewProject', { screen: 'Capture' });
              navigation.closeDrawer();
            },
          })}
          options={{
            title: t('nav_new_project'),
            headerShown: false, // Stack has its own header
            drawerIcon: ({ color, size }) => (
              <Icon name="add-circle-outline" size={size} color={color} />
            ),
          }}
        />
        {config.features.triage && (
          <Drawer.Screen
            name="Triage"
            component={TriageScreen}
            options={({ navigation }) => proScreenOptions({ navigation, t, title: t('nav_triage'), icon: 'medkit-outline' })}
          />
        )}
        {config.features.booking && (
          <Drawer.Screen
            name="Book"
            component={BookingScreen}
            options={({ navigation }) => proScreenOptions({ navigation, t, title: t('nav_book'), icon: 'calendar-outline' })}
          />
        )}
        {config.features.appointmentTracking && (
          <Drawer.Screen
            name="MyJobs"
            component={MyJobsScreen}
            options={({ navigation }) => proScreenOptions({ navigation, t, title: t('nav_my_jobs'), icon: 'clipboard-outline' })}
          />
        )}
        <Drawer.Screen
          name="HoneyDoList"
          component={HoneyDo}
          options={({ navigation }) => ({
            title: t('nav_honey_do_list'),
            headerShown: true,
            headerTitle: () => (
              <LogoHeader
                onPress={() => goToFreshCapture(navigation)}
                title={t('nav_honey_do_list')}
                subtitle={t('app_title')}
              />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => (
              <Icon name="list-outline" size={size} color={color} />
            ),
          })}
        />
        <Drawer.Screen
          name="ContractorList"
          component={Contractors}
          options={({ navigation }) => ({
            title: t('nav_contractor_list'),
            headerShown: true,
            headerTitle: () => (
              <LogoHeader
                onPress={() => goToFreshCapture(navigation)}
                title={t('nav_contractor_list')}
                subtitle={t('app_title')}
              />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => (
              <Icon name="hammer-outline" size={size} color={color} />
            ),
          })}
        />
        <Drawer.Screen
          name="Inventory"
          component={Inventory}
          options={({ navigation }) => ({
            title: t('nav_inventory') || 'My Tools',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_inventory') || 'My Tools'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="construct-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="ShoppingList"
          component={ShoppingList}
          options={({ navigation }) => ({
            title: t('nav_shopping') || 'Shopping List',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_shopping') || 'Shopping List'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="cart-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="Diagnose"
          component={DiagnoseWithBoundary}
          options={({ navigation }) => ({
            title: t('nav_diagnose') || "What's Wrong?",
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_diagnose') || "What's Wrong?"} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="search-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="LiveCoach"
          component={LiveHelpScreen}
          options={({ navigation }) => ({
            title: t('nav_live_coach') || 'Live DIY Coach',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_live_coach') || 'Live DIY Coach'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="videocam-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="Quotes"
          component={Quotes}
          options={({ navigation }) => ({
            title: t('nav_quotes') || 'Quote Tracker',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_quotes') || 'Quote Tracker'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="chatbox-ellipses-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="Community"
          component={Community}
          options={({ navigation }) => ({
            title: t('nav_community') || 'Community',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_community') || 'Community'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="people-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="Emergency"
          component={Emergency}
          options={({ navigation }) => ({
            title: t('nav_emergency') || 'Emergency',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => navigation.navigate('NewProject')} title={t('nav_emergency') || 'Emergency'} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="warning-outline" size={size} color="#DC2626" />,
          })}
        />
        <Drawer.Screen
          name="ReportProblem"
          component={ReportProblem}
          options={({ navigation }) => ({
            title: t('nav_report_problem'),
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => goToFreshCapture(navigation)} title={t('nav_report_problem')} subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="chatbubble-ellipses-outline" size={size} color={color} />,
          })}
        />
        <Drawer.Screen
          name="TechMode"
          component={TechStack}
          options={{
            title: t('nav_tech_mode'),
            headerShown: false,
            drawerIcon: ({ color, size }) => <Icon name="briefcase-outline" size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="Settings"
          component={Settings}
          options={({ navigation }) => ({
            title: t('nav_settings'),
            headerShown: true,
            headerTitle: () => (
              <LogoHeader
                onPress={() => goToFreshCapture(navigation)}
                title={t('nav_settings')}
                subtitle={t('app_title')}
              />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.openDrawer()}
                style={{ marginRight: 15 }}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => (
              <Icon name="settings-outline" size={size} color={color} />
            ),
          })}
        />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}

// Wrapper that decides whether to show onboarding (first launch), the AI
// consent gate (first AI-enabled launch or after version bump), or the main
// app. Lives inside I18nProvider so onboarding copy can be translated.
function OnboardingGate() {
  const [seen, setSeen] = React.useState(null); // null = loading
  const [consentOk, setConsentOk] = React.useState(null); // null = loading
  const [promoAsked, setPromoAsked] = React.useState(null); // null = loading
  React.useEffect(() => {
    getOnboardingSeen().then(setSeen);
    getAiConsent().then(c => {
      // Treat as answered once the user has responded to the current consent
      // version. A bump of AI_CONSENT_VERSION re-prompts returning users.
      setConsentOk(!!(c && c.version === AI_CONSENT_VERSION));
    });
    // A null promo record means we've never asked; show the priming screen once.
    getPromoConsent().then(p => setPromoAsked(p !== null));
  }, []);
  if (seen === null || consentOk === null || promoAsked === null) return null;
  if (!seen) {
    return <OnboardingScreen onFinish={() => { setOnboardingSeen(); setSeen(true); }} />;
  }
  if (!consentOk) {
    return (
      <AiConsentScreen
        onAccept={() => setConsentOk(true)}
        onDecline={() => setConsentOk(true)}
      />
    );
  }
  if (!promoAsked) {
    return <PromoConsentScreen onDone={() => setPromoAsked(true)} />;
  }
  return <AppContent />;
}

export default function App() {
  // Load the active brand's typeface (no-op/instant for System brands), then
  // apply it app-wide. The splash stays up until fonts resolve.
  const [fontsLoaded] = useFonts(brandFontAssets(BRAND_FONT));
  useEffect(() => {
    if (!fontsLoaded) return;
    const keys = fontKeysFor(BRAND_FONT);
    if (keys) applyGlobalFont(keys.regular);
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <I18nProvider>
          <FeaturesProvider>
            <BrandConfigProvider>
              <TechAuthProvider>
                <TranslationProvider targetLang="es">
                  <OnboardingGate />
                </TranslationProvider>
              </TechAuthProvider>
            </BrandConfigProvider>
          </FeaturesProvider>
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
