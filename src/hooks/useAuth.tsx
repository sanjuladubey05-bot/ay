import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  isFirebaseConfigured,
  signInWithFirebaseGoogle,
  signOutFirebase,
  syncFirebaseUserProfile,
} from '../lib/firebase';
import { apiClient } from '../services/apiClient';
import type { AuthenticatedUser } from '../types/api';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  adminBootstrapRequired: boolean;
  authMode: 'local_postgres' | 'supabase_hybrid';
  firebaseReady: boolean;
  refreshAuth: () => Promise<void>;
  setUser: (user: AuthenticatedUser | null) => void;
  signInWithGoogle: () => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminBootstrapRequired, setAdminBootstrapRequired] = useState(false);
  const [authMode, setAuthMode] = useState<'local_postgres' | 'supabase_hybrid'>('local_postgres');

  const refreshAuth = useCallback(async () => {
    try {
      const status = await apiClient.getAuthStatus();
      setUser(status.user);
      setAdminBootstrapRequired(status.adminBootstrapRequired);
      setAuthMode(status.authMode);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const signInWithGoogle = useCallback(async (): Promise<AuthenticatedUser> => {
    const { user: fbUser, idToken } = await signInWithFirebaseGoogle();
    try {
      await syncFirebaseUserProfile(fbUser);
    } catch (err) {
      console.warn('Firestore profile sync skipped:', err);
    }
    const res = await apiClient.firebaseLogin(idToken);
    setUser(res.user);
    await refreshAuth();
    return res.user;
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    await Promise.all([apiClient.logout(), signOutFirebase()]);
    setUser(null);
    await refreshAuth();
  }, [refreshAuth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        adminBootstrapRequired,
        authMode,
        firebaseReady: isFirebaseConfigured,
        refreshAuth,
        setUser,
        signInWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
