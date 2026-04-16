import React from 'react';
import Settings from './Settings';

// The "Me" tab is Settings with one addition: a "Report a problem" row
// below the Danger Zone (delete-my-data). Implemented by passing a render-
// prop into Settings, since Settings already owns all the profile,
// preferences, legal, and danger-zone sections in well-structured
// `languageSection` cards. Rewriting those would be a lot of risk for
// cosmetic benefit.
//
// If we need a more opinionated "Me" layout later, this is the file to grow
// — we'd move rendering out of Settings into grouped cards here.

export default function MeScreen({ navigation, route }) {
  return (
    <Settings
      navigation={navigation}
      route={route}
      showReportProblemLink
    />
  );
}
