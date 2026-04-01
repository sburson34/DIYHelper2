import React from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Ionicons as Icon } from '@expo/vector-icons';
import CaptureScreen from './src/screens/CaptureScreen';
import ResultScreen from './src/screens/ResultScreen';
import SafetyScreen from './src/screens/SafetyScreen';
import ProjDet from './src/screens/ProjDet';
import WorkSteps from './src/screens/WorkSteps';
import HoneyDo from './src/screens/HoneyDo';
import Contractors from './src/screens/Contractors';
import theme from './src/theme';

const LogoHeader = ({ onPress, title = "DIY Helper", subtitle = "AI Home Repair Assistant" }) => (
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
        component={CaptureScreen}
        options={({ navigation }) => ({
          headerTitle: () => <LogoHeader onPress={() => {}} />,
          headerTitleAlign: 'left',
          headerRight: () => (
            <Icon
              name="menu"
              size={30}
              color="#FFFFFF"
              style={{ marginRight: 15 }}
              onPress={() => navigation.openDrawer()}
            />
          ),
          headerLeft: () => null,
        })}
      />
      <Stack.Screen
        name="Result"
        component={ResultScreen}
        options={{ title: 'Project Steps' }}
      />
      <Stack.Screen
        name="Safety"
        component={SafetyScreen}
        options={{ title: 'Safety First' }}
      />
      <Stack.Screen
        name="ProjectDetail"
        component={ProjDet}
        options={{ title: 'Project Detail' }}
      />
      <Stack.Screen
        name="WorkshopSteps"
        component={WorkSteps}
        options={{ title: 'Workshop Mode' }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer theme={MyTheme}>
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
          component={CaptureStack}
          options={{
            title: 'New Project',
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
            title: 'Honey Do List',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader
                onPress={() => navigation.navigate('NewProject')}
                title="Honey Do List"
                subtitle="DIY Helper"
              />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <Icon
                name="menu"
                size={30}
                color="#FFFFFF"
                style={{ marginRight: 15 }}
                onPress={() => navigation.openDrawer()}
              />
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
            title: 'Contractor List',
            headerShown: true,
            headerTitle: () => (
              <LogoHeader
                onPress={() => navigation.navigate('NewProject')}
                title="Contractor List"
                subtitle="DIY Helper"
              />
            ),
            headerTitleAlign: 'left',
            headerRight: () => (
              <Icon
                name="menu"
                size={30}
                color="#FFFFFF"
                style={{ marginRight: 15 }}
                onPress={() => navigation.openDrawer()}
              />
            ),
            headerLeft: () => null,
            drawerIcon: ({ color, size }) => (
              <Icon name="hammer-outline" size={size} color={color} />
            ),
          })}
        />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}
