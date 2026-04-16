import React, { useRef } from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

// Swallow any error from preventAutoHideAsync — if it fails, the OS hides
// the splash on its own, which is strictly better than crashing at boot.
try { SplashScreen.preventAutoHideAsync(); } catch {}

// Safety net: no matter what happens during init (Sentry hanging, a provider
// throwing async, a native module failing to register), hide the splash after
// a hard timeout so the user always sees either the app or a red-box error.
setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 4000);

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { navigationIntegration } from './src/services/sentry';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons as Icon } from '@expo/vector-icons';

// Screens — main flow
import HomeScreen from './src/screens/HomeScreen';
import ResultScreen from './src/screens/ResultScreen';
import SafetyScreen from './src/screens/SafetyScreen';
import ProjDet from './src/screens/ProjDet';
import WorkSteps from './src/screens/WorkSteps';
import PaintMatchScreen from './src/screens/PaintMatchScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AnnotateScreen from './src/screens/AnnotateScreen';
import WorkshopARScreen from './src/screens/WorkshopARScreen';

// Screens — consolidated tabs
import ProjectsScreen from './src/screens/ProjectsScreen';
import StuffScreen from './src/screens/StuffScreen';
import MeScreen from './src/screens/MeScreen';

// Screens — secondary (reached from within a tab)
import Emergency from './src/screens/Emergency';
import Diagnose from './src/screens/Diagnose';
import Quotes from './src/screens/Quotes';
import ReportProblem from './src/screens/ReportProblem';

import theme from './src/theme';
import { I18nProvider, useTranslation } from './src/i18n/I18nContext';
import { ThemeProvider } from './src/ThemeContext';
import { FeaturesProvider } from './src/config/features';
import { TranslationProvider } from './src/mlkit/TranslationProvider';
import { getOnboardingSeen, setOnboardingSeen } from './src/utils/storage';
import ScreenErrorBoundary from './src/components/ScreenErrorBoundary';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Deep linking config — same shape as before, routes resolve through whichever
// tab stack currently owns the screen name. React Navigation handles the
// lookup automatically so diyhelper://project/abc still works.
const linking = {
  prefixes: ['diyhelper://', 'https://diyhelper.org'],
  config: {
    screens: {
      Home: {
        screens: {
          HomeMain: '',
          Result: 'result',
          ProjectDetail: 'project/:id',
        },
      },
      Projects: 'projects',
      Stuff: 'stuff',
      Me: 'settings',
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

// ── Per-tab stack navigators ─────────────────────────────────────────
// Each tab has its own stack so the user can drill into a detail screen
// (e.g. Home → Result → Safety → WorkshopSteps) and a different tab tap
// won't reset their position. Shared screens like ProjectDetail are
// registered in multiple stacks.

function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.text },
        headerTitleStyle: { color: '#fff', fontWeight: 'bold' },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen
        name="HomeMain"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Your Guide' }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ title: 'Safety First' }} />
      <Stack.Screen name="ProjectDetail" component={ProjDet} options={{ title: 'Project' }} />
      <Stack.Screen name="WorkshopSteps" component={WorkSteps} options={{ title: 'Workshop' }} />
      <Stack.Screen name="PaintMatch" component={PaintMatchScreen} options={{ title: 'Paint Color Match' }} />
      <Stack.Screen name="Annotate" component={AnnotateScreen} options={{ headerShown: false }} />
      <Stack.Screen name="WorkshopAR" component={WorkshopARScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Diagnose" component={Diagnose} options={{ title: "What's Wrong?" }} />
      <Stack.Screen name="Emergency" component={Emergency} options={{ title: 'Emergency' }} />
    </Stack.Navigator>
  );
}

function ProjectsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.text },
        headerTitleStyle: { color: '#fff', fontWeight: 'bold' },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="ProjectsMain" component={ProjectsScreen} options={{ title: 'Projects' }} />
      <Stack.Screen name="ProjectDetail" component={ProjDet} options={{ title: 'Project' }} />
      <Stack.Screen name="WorkshopSteps" component={WorkSteps} options={{ title: 'Workshop' }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Your Guide' }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ title: 'Safety First' }} />
      <Stack.Screen name="Quotes" component={Quotes} options={{ title: 'Quote Tracker' }} />
    </Stack.Navigator>
  );
}

function StuffStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.text },
        headerTitleStyle: { color: '#fff', fontWeight: 'bold' },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="StuffMain" component={StuffScreen} options={{ title: 'Stuff' }} />
    </Stack.Navigator>
  );
}

function MeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.text },
        headerTitleStyle: { color: '#fff', fontWeight: 'bold' },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="MeMain" component={MeScreen} options={{ title: 'Me' }} />
      <Stack.Screen name="ReportProblem" component={ReportProblem} options={{ title: 'Report a Problem' }} />
      <Stack.Screen name="Emergency" component={Emergency} options={{ title: 'Emergency' }} />
    </Stack.Navigator>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const navigationRef = useRef(null);

  return (
    <NavigationContainer
      theme={MyTheme}
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        try {
          navigationIntegration.registerNavigationContainer(navigationRef);
        } catch {}
        SplashScreen.hideAsync().catch(() => {});
      }}
    >
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textSecondary,
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            height: 64,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          tabBarIcon: ({ color, size, focused }) => {
            const icons = {
              Home: focused ? 'home' : 'home-outline',
              Projects: focused ? 'list' : 'list-outline',
              Stuff: focused ? 'cube' : 'cube-outline',
              Me: focused ? 'person-circle' : 'person-circle-outline',
            };
            return <Icon name={icons[route.name] || 'ellipse'} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen
          name="Home"
          component={HomeStack}
          options={{ tabBarLabel: t('nav_home') || 'Home' }}
          listeners={({ navigation }) => ({
            // Long-press on Home tab opens Emergency immediately. Matches the
            // "press the red button" convention: the tab becomes the shortcut.
            tabLongPress: () => {
              navigation.navigate('Home', { screen: 'Emergency' });
            },
          })}
        />
        <Tab.Screen
          name="Projects"
          component={ProjectsStack}
          options={{ tabBarLabel: t('nav_projects') || 'Projects' }}
        />
        <Tab.Screen
          name="Stuff"
          component={StuffStack}
          options={{ tabBarLabel: t('nav_stuff') || 'Stuff' }}
        />
        <Tab.Screen
          name="Me"
          component={MeStack}
          options={{ tabBarLabel: t('nav_me') || 'Me' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// Onboarding gate — shows the 3-step intro on first launch, remembers
// the user dismissed it via AsyncStorage.
function OnboardingGate() {
  const [seen, setSeen] = React.useState(null);
  React.useEffect(() => { getOnboardingSeen().then(setSeen); }, []);
  if (seen === null) return null;
  if (!seen) return <OnboardingScreen onFinish={() => { setOnboardingSeen(); setSeen(true); }} />;
  return (
    <ScreenErrorBoundary screenName="Root">
      <AppContent />
    </ScreenErrorBoundary>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <I18nProvider>
          <FeaturesProvider>
            <TranslationProvider targetLang="es">
              <OnboardingGate />
            </TranslationProvider>
          </FeaturesProvider>
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
