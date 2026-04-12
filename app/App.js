import React, { useCallback, useRef } from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme, DrawerActions } from '@react-navigation/native';
import { navigationIntegration } from './src/services/sentry';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Ionicons as Icon } from '@expo/vector-icons';
import CaptureScreen from './src/screens/CaptureScreen';
import ResultScreen from './src/screens/ResultScreen';
import SafetyScreen from './src/screens/SafetyScreen';
import ProjDet from './src/screens/ProjDet';
import WorkSteps from './src/screens/WorkSteps';
import PaintMatchScreen from './src/screens/PaintMatchScreen';
import AnnotateScreen from './src/screens/AnnotateScreen';
import WorkshopARScreen from './src/screens/WorkshopARScreen';
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
import theme from './src/theme';
import { I18nProvider, useTranslation } from './src/i18n/I18nContext';
import { ThemeProvider } from './src/ThemeContext';
import { FeaturesProvider } from './src/config/features';
import { TranslationProvider } from './src/mlkit/TranslationProvider';
import { requestCaptureReset } from './src/utils/captureBus';
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
    </Stack.Navigator>
  );
}

function AppContent() {
  const { t } = useTranslation();
  // Hand the NavigationContainer ref to Sentry's react-navigation integration
  // so route changes are emitted as breadcrumbs (and tx spans when tracing).
  const navigationRef = useRef(null);
  return (
    <NavigationContainer
      theme={MyTheme}
      ref={navigationRef}
      onReady={() => {
        try {
          navigationIntegration.registerNavigationContainer(navigationRef);
        } catch {
          // Sentry not initialized (no DSN) — safe to ignore.
        }
        SplashScreen.hideAsync();
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="search-outline" size={size} color={color} />,
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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
            title: 'Report a Problem',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader onPress={() => goToFreshCapture(navigation)} title="Report a Problem" subtitle={t('app_title')} />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
                <Icon name="menu" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => <Icon name="chatbubble-ellipses-outline" size={size} color={color} />,
          })}
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
              <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 15 }}>
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

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <I18nProvider>
          <FeaturesProvider>
            <TranslationProvider targetLang="es">
              <AppContent />
            </TranslationProvider>
          </FeaturesProvider>
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
