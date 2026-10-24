
import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";

export interface AppSettings {
  allowGuestAccess: boolean;
  faviconFetchEnabled: boolean;
  iconFallbackPreference: 'emoji' | 'text';
}

interface AppSettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
}

const defaultSettings: AppSettings = {
  allowGuestAccess: false,
  faviconFetchEnabled: true,
  iconFallbackPreference: 'emoji',
};

const AppSettingsContext = createContext<AppSettingsContextType>({
  settings: defaultSettings,
  updateSettings: () => {},
});

export const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const storedSettings = localStorage.getItem("bookmarkhub_settings");
    return storedSettings ? JSON.parse(storedSettings) : defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem("bookmarkhub_settings", JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      return updated;
    });
    toast.success("Settings updated successfully");
  };

  return (
    <AppSettingsContext.Provider
      value={{
        settings,
        updateSettings,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = () => useContext(AppSettingsContext);
