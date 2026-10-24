import React, { createContext, useContext, useState, useEffect } from "react";

export type ThemePreference = "system" | "light" | "dark";

interface ThemeContextType {
  theme: "light" | "dark";
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  preference: "system",
  setPreference: () => {},
  toggleTheme: () => {},
});

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const readPreference = (): ThemePreference => {
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
};

// Default: follow the operating system (light/dark). A manual choice overrides it.
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState<boolean>(() => media().matches);

  useEffect(() => {
    const m = media();
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const theme: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
  }, [theme]);

  const setPreference = (p: ThemePreference) => {
    if (p === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", p);
    setPreferenceState(p);
  };

  const toggleTheme = () => setPreference(theme === "light" ? "dark" : "light");

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
