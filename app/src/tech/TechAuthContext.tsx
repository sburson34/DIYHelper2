import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { techLogin, setTechToken } from '../api/backendClient';
import { secureGet, secureSet, secureDelete } from '../utils/secureStorage';
import { clearTechCache, flushQueue } from './techQueue';

// Auth state for mobile "tech mode". A technician signs in once with a code the
// owner gave them; we hold the resulting bearer token in the secure keystore and
// hand it to the HTTP layer via setTechToken(). No password, no account — the
// token is the whole session, valid ~30 days server-side.

const TOKEN_KEY = 'tech_token';
const PROFILE_KEY = 'tech_profile';

export interface TechProfile {
  id: number;
  name: string;
}

interface TechAuthValue {
  ready: boolean;          // finished restoring from storage
  tech: TechProfile | null;
  login: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const TechAuthContext = createContext<TechAuthValue>({
  ready: false,
  tech: null,
  login: async () => {},
  logout: async () => {},
});

export function TechAuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tech, setTech] = useState<TechProfile | null>(null);

  // Restore a saved session on launch.
  useEffect(() => {
    (async () => {
      try {
        const token = await secureGet(TOKEN_KEY);
        const profileRaw = await secureGet(PROFILE_KEY);
        if (token && profileRaw) {
          setTechToken(token);
          setTech(JSON.parse(profileRaw) as TechProfile);
        }
      } catch {
        // corrupt/missing → stay logged out
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Flush queued field updates whenever the app returns to the foreground while
  // a tech is signed in — so a tech who worked offline syncs the moment their
  // phone reconnects, without having to open the jobs list.
  useEffect(() => {
    if (!tech) return undefined;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { flushQueue().catch(() => {}); }
    });
    return () => sub.remove();
  }, [tech]);

  const login = async (code: string): Promise<void> => {
    const res = await techLogin(code.trim());
    const profile: TechProfile = { id: res.technicianId, name: res.name };
    await secureSet(TOKEN_KEY, res.token);
    await secureSet(PROFILE_KEY, JSON.stringify(profile));
    setTechToken(res.token);
    setTech(profile);
  };

  const logout = async (): Promise<void> => {
    setTechToken(null);
    setTech(null);
    try { await secureDelete(TOKEN_KEY); } catch { /* ignore */ }
    try { await secureDelete(PROFILE_KEY); } catch { /* ignore */ }
    await clearTechCache();
  };

  return (
    <TechAuthContext.Provider value={{ ready, tech, login, logout }}>
      {children}
    </TechAuthContext.Provider>
  );
}

export function useTechAuth(): TechAuthValue {
  return useContext(TechAuthContext);
}
