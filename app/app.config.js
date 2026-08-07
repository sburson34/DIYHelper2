// Dynamic Expo config for white-label builds.
//
// The static defaults still live in app.json (plugins, permissions, EAS
// projectId, version, Sentry). This file layers the ACTIVE BRAND's identity on
// top of them: app name, slug, deep-link scheme, bundle id / package, icon,
// splash, iOS permission copy, and the brand colors that the JS runtime reads
// via expo-constants (Constants.expoConfig.extra.brand).
//
// The active brand is chosen by the BRAND env var (default "diyhelper"):
//
//   BRAND=acme-home npm run prebuild      # regenerate android/ for that brand
//   BRAND=acme-home npm run build:beta    # then build its APK
//
// Every brand is defined by brands/<id>/brand.json + icon.png + splash.png.
// Nothing under src/ changes per brand — add a folder, build, done.
//
// Precedence note: when both app.json and app.config.js exist, Expo reads
// app.json first and passes it to this function as `config`; whatever we return
// here wins. So the fields we override below take effect; everything we leave
// untouched (plugins, extra.sentryDsn, etc.) is inherited from app.json.

const fs = require('fs');
const path = require('path');

const BRANDS_DIR = path.resolve(__dirname, 'brands');
const BRAND = process.env.BRAND || 'diyhelper';

function loadBrand(id) {
  const file = path.join(BRANDS_DIR, id, 'brand.json');
  if (!fs.existsSync(file)) {
    const available = fs.existsSync(BRANDS_DIR)
      ? fs.readdirSync(BRANDS_DIR).filter((d) => fs.existsSync(path.join(BRANDS_DIR, d, 'brand.json')))
      : [];
    throw new Error(
      `[app.config] Unknown BRAND "${id}". Expected brands/${id}/brand.json. ` +
        `Available brands: ${available.join(', ') || '(none)'}.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const brand = loadBrand(BRAND);
const asset = (file) => `./brands/${BRAND}/${file}`;
const co = brand.companyShortName;

module.exports = ({ config }) => ({
  ...config,
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,

  // Over-the-air JS updates, served by the portfolio distribution host
  // (apps.diyhelper.org — Sburson.Shared.Backend's MapExpoUpdates).
  //
  // PER BRAND, not per repo, and that is load-bearing rather than tidy. Each brand is a
  // separately installed app with its own package id, and brand identity travels in
  // extra.brand below — which an update RESTORES into Constants.expoConfig, because on an
  // updated device that object comes from the manifest rather than from the binary. One
  // shared bundle would therefore not merely reach the wrong app, it would repaint every
  // other brand with whichever brand happened to publish: Acme Home users would open their
  // app to DIYHelper's name and colors. Keyed on brand.slug so a new brands/<id>/ folder
  // gets its own update channel with no further wiring.
  //
  // A new brand must ALSO be added to AppDistribution__Apps in
  // infrastructure-shared/config/diyhelper.env, or its bundles are served to nobody.
  //
  // THIS URL IS COMPILED INTO THE BINARY and read at launch, so it cannot be changed for
  // an installed app without a rebuild and reinstall.
  updates: {
    url: `https://apps.diyhelper.org/apps/${brand.slug}/manifest`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  // The interlock: a bundle only reaches a device whose NATIVE version string matches, so
  // JS built against new native code can never land on a binary lacking it. Bump `version`
  // in app.json ONLY for native changes — it strands every install until they reinstall.
  runtimeVersion: { policy: 'appVersion' },
  icon: asset('icon.png'),
  splash: {
    image: asset('splash.png'),
    resizeMode: 'contain',
    backgroundColor: brand.splashBackground,
  },
  ios: {
    ...config.ios,
    bundleIdentifier: brand.bundleId,
    infoPlist: {
      ...(config.ios && config.ios.infoPlist),
      NSCameraUsageDescription: `${co} needs camera access to capture photos and videos of your home repair projects.`,
      NSMicrophoneUsageDescription: `${co} needs microphone access for voice descriptions and hands-free workshop mode.`,
      NSPhotoLibraryUsageDescription: `${co} needs photo library access to save and share project photos.`,
      NSSpeechRecognitionUsageDescription: `${co} uses speech recognition for voice commands in workshop mode.`,
    },
  },
  android: {
    ...config.android,
    package: brand.bundleId,
    adaptiveIcon: {
      foregroundImage: asset('icon.png'),
      backgroundColor: brand.iconBackground || brand.splashBackground,
    },
  },
  extra: {
    ...(config.extra || {}),
    brand: {
      id: brand.id,
      name: brand.name,
      companyShortName: brand.companyShortName,
      fontFamily: brand.fontFamily,
      colors: brand.colors,
      releasePrefix: brand.releasePrefix || brand.slug,
      privacyPolicyUrl: brand.privacyPolicyUrl,
      termsUrl: brand.termsUrl,
    },
  },
});
