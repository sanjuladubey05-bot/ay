import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiClient } from '../services/apiClient';
import type { StorefrontIdentitySettings } from '../types/database';
import { sanitizeExternalHref, sanitizeMediaSrc } from '../utilities/displayUrl';

const DEFAULT_SETTINGS: StorefrontIdentitySettings = {
  storeName: 'LPS STORE',
  storeLogoUrl: null,
  heroHeading: 'LEVEL UP YOUR GAME',
  heroSubtitle: 'Your Gaming Top-Up Destination',
  supportEmail: 'support@lpsstore.example',
  whatsappContact: '+91 00000 00000',
  footerDescription:
    'A digital gaming top-up marketplace built with server-verified package pricing, Player ID validation, and transparent order tracking.',
  supportHours: 'Monday – Sunday · 10:00 – 22:00 IST',
  supportNote: 'Reach out for pending order status checks, Player ID updates, or catalog support.',
  announcementEnabled: false,
  announcementText: '',
  socialLinks: {
    discord: '',
    instagram: '',
    youtube: '',
    x: '',
  },
};

function normalizePublicSettings(raw: unknown): StorefrontIdentitySettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const o = raw as Record<string, unknown>;
  const social =
    o.socialLinks && typeof o.socialLinks === 'object'
      ? (o.socialLinks as Record<string, unknown>)
      : {};
  return {
    storeName:
      typeof o.storeName === 'string' && o.storeName.trim()
        ? o.storeName
        : DEFAULT_SETTINGS.storeName,
    storeLogoUrl:
      typeof o.storeLogoUrl === 'string' ? sanitizeMediaSrc(o.storeLogoUrl) : null,
    heroHeading:
      typeof o.heroHeading === 'string' && o.heroHeading.trim()
        ? o.heroHeading
        : DEFAULT_SETTINGS.heroHeading,
    heroSubtitle:
      typeof o.heroSubtitle === 'string' && o.heroSubtitle.trim()
        ? o.heroSubtitle
        : DEFAULT_SETTINGS.heroSubtitle,
    supportEmail:
      typeof o.supportEmail === 'string' && o.supportEmail.trim()
        ? o.supportEmail
        : DEFAULT_SETTINGS.supportEmail,
    whatsappContact:
      typeof o.whatsappContact === 'string'
        ? o.whatsappContact
        : DEFAULT_SETTINGS.whatsappContact,
    footerDescription:
      typeof o.footerDescription === 'string' && o.footerDescription.trim()
        ? o.footerDescription
        : DEFAULT_SETTINGS.footerDescription,
    supportHours:
      typeof o.supportHours === 'string' && o.supportHours.trim()
        ? o.supportHours
        : DEFAULT_SETTINGS.supportHours,
    supportNote:
      typeof o.supportNote === 'string'
        ? o.supportNote
        : DEFAULT_SETTINGS.supportNote,
    announcementEnabled: Boolean(o.announcementEnabled),
    announcementText: typeof o.announcementText === 'string' ? o.announcementText : '',
    socialLinks: {
      discord: sanitizeExternalHref(typeof social.discord === 'string' ? social.discord : '') || '',
      instagram:
        sanitizeExternalHref(typeof social.instagram === 'string' ? social.instagram : '') || '',
      youtube: sanitizeExternalHref(typeof social.youtube === 'string' ? social.youtube : '') || '',
      x: sanitizeExternalHref(typeof social.x === 'string' ? social.x : '') || '',
    },
  };
}

interface StorefrontSettingsContextValue {
  settings: StorefrontIdentitySettings;
  refreshSettings: () => Promise<void>;
}

const StorefrontSettingsContext = createContext<StorefrontSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  refreshSettings: async () => undefined,
});

export function StorefrontSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StorefrontIdentitySettings>(DEFAULT_SETTINGS);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await apiClient.getStoreFoundation();
      setSettings(normalizePublicSettings(res.publicSettings?.storefront_identity));
    } catch {
      // Keep safe defaults
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  return (
    <StorefrontSettingsContext.Provider value={{ settings, refreshSettings }}>
      {children}
    </StorefrontSettingsContext.Provider>
  );
}

export function useStorefrontSettings() {
  return useContext(StorefrontSettingsContext);
}
