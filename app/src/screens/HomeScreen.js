import React from 'react';
import CaptureScreen from './CaptureScreen';

// Home tab = Capture flow. CaptureScreen already renders its own
// SafeAreaView + ScrollView and has a built-in "resume recent project"
// card, so HomeScreen is a thin pass-through that lets us register a
// different route name in the tab stack without duplicating the tree.
//
// The "Not sure what's wrong? — Diagnose" CTA lives inside CaptureScreen
// itself; Emergency is reachable via long-pressing the Home tab icon
// (wired in App.js).

export default function HomeScreen({ navigation, route }) {
  return <CaptureScreen navigation={navigation} route={route} />;
}
