// CloudSpace-only user preferences persisted in localStorage. These are UI
// preferences that Nextcloud doesn't model (accent color, font size, compact
// mode, profile bio/locale, notification toggles). The auth theme (light/dark)
// is handled separately in App.tsx via "cloudspace-theme".

export type NotificationPrefs = Record<string, boolean>;

export type Preferences = {
  accent: string;
  fontSize: number;
  compact: boolean;
  bio: string;
  language: string;
  timezone: string;
  notifications: NotificationPrefs;
};

const KEY = "cloudspace-prefs";

const DEFAULTS: Preferences = {
  accent: "indigo",
  fontSize: 14,
  compact: false,
  bio: "",
  language: "en",
  timezone: "asia-calcutta",
  notifications: {},
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...DEFAULTS,
      ...parsed,
      notifications: { ...(parsed.notifications || {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(patch: Partial<Preferences>) {
  const next = { ...loadPreferences(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota / disabled storage */ }
  return next;
}

// Accent colors shared between Settings and the startup applier.
export const ACCENT_COLORS = [
  { name: "indigo", hex: "#4F46E5", hsl: "239 84% 67%" },
  { name: "violet", hex: "#7C3AED", hsl: "263 70% 50%" },
  { name: "rose", hex: "#E11D48", hsl: "347 77% 50%" },
  { name: "emerald", hex: "#059669", hsl: "160 84% 39%" },
  { name: "amber", hex: "#D97706", hsl: "38 92% 50%" },
  { name: "sky", hex: "#0284C7", hsl: "199 89% 48%" },
];

// Apply persisted appearance to the document. Called at startup and after changes.
export function applyAppearance(prefs: Preferences = loadPreferences()) {
  const root = document.documentElement;
  const accent = ACCENT_COLORS.find((c) => c.name === prefs.accent);
  if (accent) root.style.setProperty("--primary", accent.hsl);
  if (prefs.fontSize) root.style.fontSize = `${prefs.fontSize}px`;
  root.classList.toggle("compact", Boolean(prefs.compact));
}
