import React, { createContext, useContext, useEffect, useState } from 'react';
import { getBrandConfig, BrandConfig } from '../api/backendClient';

// Per-brand customer-app configuration (see GET /api/config). Fetched once at
// launch and exposed via useBrandConfig(). Until it resolves — or if it fails
// (offline) — the app runs on these defaults, which turn every core customer
// feature ON so a new brand works with zero server config. Memberships stay OFF
// until a brand opts in AND a payment provider is live (the server computes the
// effective value, so we never surface a paid flow that can't charge).
export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  brand: '',
  companyName: '',
  phone: null,
  reviewUrl: null,
  serviceTypes: [],
  membershipEnabled: false,
  features: {
    booking: true,
    triage: true,
    appointmentTracking: true,
    reviews: true,
    referrals: true,
    maintenanceReminders: true,
    memberships: false,
    // Rollout-gated features: OFF by default, a brand turns them on via
    // Brand.FeaturesJson once the company has configured the server side
    // (business hours for selfScheduling; nothing extra for assets/properties).
    selfScheduling: false,
    assets: false,
    multiProperty: false,
  },
};

const BrandConfigContext = createContext<BrandConfig>(DEFAULT_BRAND_CONFIG);

export function BrandConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_BRAND_CONFIG);

  useEffect(() => {
    let alive = true;
    getBrandConfig()
      .then((c) => {
        if (!alive || !c) return;
        // Merge over defaults so a server that omits a key can't dark-ship a
        // feature, and features stays a full object for the gating checks.
        setConfig({
          ...DEFAULT_BRAND_CONFIG,
          ...c,
          features: { ...DEFAULT_BRAND_CONFIG.features, ...(c.features || {}) },
        });
      })
      .catch(() => {
        // Keep defaults — the app must work offline / before the backend is up.
      });
    return () => {
      alive = false;
    };
  }, []);

  return <BrandConfigContext.Provider value={config}>{children}</BrandConfigContext.Provider>;
}

export function useBrandConfig(): BrandConfig {
  return useContext(BrandConfigContext);
}
