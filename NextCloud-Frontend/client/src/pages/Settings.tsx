import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Shield, Bell, Palette, HardDrive, Puzzle, Info,
  Camera, Lock, Laptop, Smartphone, Check, CheckCircle,
  Trash2, Download, Zap, Plus, ExternalLink, X, AlertCircle,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { loadPreferences, savePreferences, ACCENT_COLORS } from "@/lib/preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── Toast ─────────────────────────────────────────────────
let toastTimeout: ReturnType<typeof setTimeout>;
function showToast(msg: string) {
  const existing = document.getElementById("cs-toast");
  if (existing) existing.remove();
  clearTimeout(toastTimeout);
  const el = document.createElement("div");
  el.id = "cs-toast";
  el.className =
    "fixed bottom-4 right-4 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm animate-fade-in";
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimeout = setTimeout(() => el.remove(), 2500);
}

// CloudSpace's Nextcloud app-password label (see server/credential-provider.ts).
const NEXTCLOUD_APP_LABEL = "CloudSpace Adapter";

// ─── Nav Config ────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: "Account",
    items: [
      { id: "profile", label: "Profile", icon: User },
      { id: "security", label: "Security", icon: Shield },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "App",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "storage", label: "Storage", icon: HardDrive },
      { id: "connected", label: "Connected Apps", icon: Puzzle },
    ],
  },
  {
    label: "Admin",
    items: [
      { id: "about", label: "About CloudSpace", icon: Info },
    ],
  },
];

// ─── Profile Section ───────────────────────────────────────
function ProfileSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ data: { name: string; email: string; username?: string } }>({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { name: string; email: string; username?: string } }>("/api/user"),
  });
  const user = data?.data;

  const [prefs] = useState(() => loadPreferences());
  const [name, setName] = useState("");
  const [bio, setBio] = useState(prefs.bio);
  const [language, setLanguage] = useState(prefs.language);
  const [timezone, setTimezone] = useState(prefs.timezone);
  const username = user?.username || (user?.email || "").split("@")[0] || "";

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const isDirty = useMemo(() => {
    const origName = user?.name || "";
    return name !== origName || bio !== prefs.bio || language !== prefs.language || timezone !== prefs.timezone;
  }, [name, bio, language, timezone, user?.name, prefs]);

  const handleDiscard = () => {
    setName(user?.name || "");
    setBio(prefs.bio);
    setLanguage(prefs.language);
    setTimezone(prefs.timezone);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Display name is the only Nextcloud-persisted field; the rest are local CloudSpace prefs.
      savePreferences({ bio, language, timezone });
      return apiRequest("PATCH", "/api/user", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      showToast("Profile updated");
    },
  });

  return (
    <div className="relative">
      <h2 className="text-xl font-bold">Profile</h2>
      <p className="text-sm text-muted-foreground mb-4">Manage your personal information</p>
      <Separator className="mb-6" />

      {/* Avatar */}
      <div className="flex items-center gap-6 py-6 border-b">
        <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-semibold">
          {getInitials(name || user?.name || "User")}
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Profile photo</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => showToast("Photo upload coming soon")}>
              <Camera size={14} /> Upload new photo
            </Button>
            <Button variant="ghost" size="sm">Remove</Button>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4 py-6">
        <div>
          <Label className="text-sm">Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">Email</Label>
            <div className="relative mt-1">
              <Input value={user?.email || ""} disabled className="pr-8" />
              <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div>
            <Label className="text-sm">Username</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
              <Input value={username} disabled className="pl-7 pr-8" />
              <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Your Nextcloud username can't be changed.</p>
          </div>
        </div>
        <div>
          <Label className="text-sm">Bio</Label>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            placeholder="Tell people about yourself…"
            className="mt-1"
            rows={3}
          />
          <p className="text-xs text-muted-foreground mt-1 text-right">{bio.length}/160</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
                <SelectItem value="pa">Punjabi</SelectItem>
                <SelectItem value="ur">Urdu</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asia-calcutta">Asia/Calcutta (IST, UTC+5:30)</SelectItem>
                <SelectItem value="utc">UTC</SelectItem>
                <SelectItem value="us-eastern">US/Eastern (EST, UTC-5)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-4 border-t mt-4 gap-2">
        <Button variant="ghost" onClick={handleDiscard}>
          Discard changes
        </Button>
        <Button className="gap-1" onClick={() => saveMutation.mutate()}>
          <CheckCircle size={14} /> Save profile
        </Button>
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="sticky bottom-0 left-0 right-0 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800 px-6 py-3 flex items-center justify-between mt-4 -mx-8 -mb-8 rounded-b-lg">
          <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertCircle size={14} /> Unsaved changes
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button size="sm" onClick={() => saveMutation.mutate()}>Save changes</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Security Section ──────────────────────────────────────
// Password change, 2FA, and device/session management all require Nextcloud's
// CSRF-protected web endpoints that this adapter (app-password auth) can't reach,
// so we point to Nextcloud rather than fake them.
function SecurityItem({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 py-4 border-b last:border-b-0">
      <Icon size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function SecuritySection() {
  return (
    <div>
      <h2 className="text-xl font-bold">Security</h2>
      <p className="text-sm text-muted-foreground mb-4">Manage your account security</p>
      <Separator className="mb-6" />

      <div className="rounded-xl border bg-muted/20 px-4">
        <SecurityItem icon={Lock} title="Password" desc="Change your account password from your Nextcloud account's Security settings." />
        <SecurityItem icon={Shield} title="Two-factor authentication" desc="Set up TOTP or other 2FA methods in Nextcloud's Security settings." />
        <SecurityItem icon={Laptop} title="Devices & sessions" desc="View and revoke connected devices and app passwords in Nextcloud's Security settings." />
      </div>

      <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
        <AlertCircle size={13} />
        CloudSpace signs in with an app password, so these are handled directly by Nextcloud.
      </p>
    </div>
  );
}

// ─── Notifications Section ─────────────────────────────────
const EMAIL_TOGGLES = [
  { label: "New message", desc: "When someone sends you a direct message", default: true },
  { label: "File shared with you", desc: "When a file or folder is shared with you", default: true },
  { label: "Comment on file", desc: "When someone comments on your file", default: true },
  { label: "Login from new device", desc: "When your account is accessed from a new device", default: true },
  { label: "Weekly summary", desc: "A weekly digest of your activity", default: false },
  { label: "System updates", desc: "Important system announcements", default: true },
];
const APP_TOGGLES = [
  { label: "Mentions", desc: "When someone mentions you", default: true },
  { label: "Direct messages", desc: "New direct messages in Talk", default: true },
  { label: "File activity", desc: "Changes to files you follow", default: false },
  { label: "Calendar reminders", desc: "Upcoming event notifications", default: true },
  { label: "Deck card assigned", desc: "When a card is assigned to you", default: true },
  { label: "Mail (badge count)", desc: "Show unread mail count in sidebar", default: true },
];

function NotificationsSection() {
  const [prefs, setPrefs] = useState(() => loadPreferences().notifications);
  const checked = (label: string, def: boolean) => (label in prefs ? prefs[label] : def);
  const setToggle = (label: string, value: boolean) => setPrefs((p) => ({ ...p, [label]: value }));

  const renderToggle = (t: { label: string; desc: string; default: boolean }) => (
    <div key={t.label} className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm font-medium">{t.label}</p>
        <p className="text-xs text-muted-foreground">{t.desc}</p>
      </div>
      <Switch checked={checked(t.label, t.default)} onCheckedChange={(v) => setToggle(t.label, v)} />
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold">Notifications</h2>
      <p className="text-sm text-muted-foreground mb-4">Choose how you want to be notified</p>
      <Separator className="mb-6" />

      <div className="grid grid-cols-2 gap-8">
        <div>
          <h3 className="font-medium mb-4">Email notifications</h3>
          {EMAIL_TOGGLES.map(renderToggle)}
        </div>
        <div>
          <h3 className="font-medium mb-4">In-app notifications</h3>
          {APP_TOGGLES.map(renderToggle)}
        </div>
      </div>

      <div className="pt-6 border-t mt-6">
        <Button onClick={() => { savePreferences({ notifications: prefs }); showToast("Notification preferences saved"); }}>
          Save notification preferences
        </Button>
      </div>
    </div>
  );
}

// ─── Appearance Section ────────────────────────────────────
function AppearanceSection() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const stored = localStorage.getItem("cloudspace-theme");
    if (stored === "dark") return "dark";
    if (stored === "light") return "light";
    return "system";
  });

  const [prefs] = useState(() => loadPreferences());
  const [accentColor, setAccentColor] = useState(prefs.accent);
  const [fontSize, setFontSize] = useState(prefs.fontSize);
  const [compact, setCompact] = useState(prefs.compact);

  const applyTheme = (t: "light" | "dark" | "system") => {
    setTheme(t);
    const root = document.documentElement;
    if (t === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
      localStorage.setItem("cloudspace-theme", prefersDark ? "dark" : "light");
    } else {
      root.classList.toggle("dark", t === "dark");
      localStorage.setItem("cloudspace-theme", t);
    }
  };

  const applyAccentColor = (color: typeof ACCENT_COLORS[0]) => {
    setAccentColor(color.name);
    document.documentElement.style.setProperty("--primary", color.hsl);
    savePreferences({ accent: color.name });
  };

  return (
    <div>
      <h2 className="text-xl font-bold">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-4">Customize the look and feel</p>
      <Separator className="mb-6" />

      {/* Theme */}
      <h3 className="font-medium mb-3">Theme</h3>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {(["light", "dark", "system"] as const).map((t) => (
          <button
            key={t}
            onClick={() => applyTheme(t)}
            className={cn(
              "rounded-xl border-2 p-4 cursor-pointer transition-all text-left relative",
              theme === t ? "border-primary bg-accent" : "border-border hover:border-muted-foreground/30"
            )}
          >
            {/* Mini preview */}
            <div className={cn(
              "w-full h-16 rounded-lg mb-3 overflow-hidden flex gap-1 p-1",
              t === "dark" ? "bg-gray-900" : t === "light" ? "bg-gray-100" : "bg-gradient-to-r from-gray-100 to-gray-900"
            )}>
              <div className={cn("w-1/4 rounded", t === "dark" ? "bg-gray-800" : "bg-white")} />
              <div className="flex-1 flex flex-col gap-1">
                <div className={cn("h-2 rounded", t === "dark" ? "bg-gray-700" : "bg-gray-200")} />
                <div className={cn("flex-1 rounded", t === "dark" ? "bg-gray-800" : "bg-white")} />
              </div>
            </div>
            <p className="text-sm font-medium capitalize">{t === "system" ? "System default" : t}</p>
            {theme === t && (
              <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Check size={12} className="text-primary-foreground" />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Accent color */}
      <h3 className="font-medium mb-3">Accent color</h3>
      <div className="flex gap-3 flex-wrap mb-8">
        {ACCENT_COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => applyAccentColor(c)}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center transition-all",
              accentColor === c.name && "ring-2 ring-offset-2 ring-offset-background"
            )}
            style={{ backgroundColor: c.hex, ...(accentColor === c.name ? { boxShadow: `0 0 0 2px ${c.hex}` } : {}) }}
          >
            {accentColor === c.name && <Check size={14} className="text-white" />}
          </button>
        ))}
      </div>

      {/* Font size */}
      <h3 className="font-medium mb-3">Font size</h3>
      <div className="max-w-sm mb-2">
        <Slider
          value={[fontSize]}
          onValueChange={(v) => {
            setFontSize(v[0]);
            document.documentElement.style.fontSize = v[0] + "px";
            savePreferences({ fontSize: v[0] });
          }}
          min={12}
          max={18}
          step={1}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>12px</span>
          <span>{fontSize}px</span>
          <span>18px</span>
        </div>
      </div>
      <p className="text-muted-foreground mb-8 border rounded-lg p-3" style={{ fontSize: fontSize + "px" }}>
        The quick brown fox jumps over the lazy dog
      </p>

      {/* Compact mode */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Compact mode</p>
          <p className="text-sm text-muted-foreground">Reduce padding and spacing across the app</p>
        </div>
        <Switch
          checked={compact}
          onCheckedChange={(checked) => {
            setCompact(checked);
            document.documentElement.classList.toggle("compact", checked);
            savePreferences({ compact: checked });
            showToast(checked ? "Compact mode enabled" : "Compact mode disabled");
          }}
        />
      </div>
    </div>
  );
}

// ─── Storage Section ───────────────────────────────────────
function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function StorageSection() {
  const { data, isLoading } = useQuery<{ data: { storageUsed?: number; storageQuota?: number } }>({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { storageUsed?: number; storageQuota?: number } }>("/api/user"),
  });
  const used = data?.data?.storageUsed ?? 0;
  const quota = data?.data?.storageQuota ?? 0;
  const unlimited = quota <= 0; // Nextcloud reports -3 for unlimited
  const free = unlimited ? null : Math.max(0, quota - used);
  const relative = unlimited ? 0 : quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

  return (
    <div>
      <h2 className="text-xl font-bold">Storage</h2>
      <p className="text-sm text-muted-foreground mb-4">Your Nextcloud storage usage</p>
      <Separator className="mb-6" />

      {/* Quota overview — real data from Nextcloud */}
      <div className="bg-muted/40 rounded-xl p-6 mb-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading usage…</p>
        ) : (
          <>
            <p className="text-xl font-bold">
              {formatBytes(used)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                used{unlimited ? " · unlimited quota" : ` of ${formatBytes(quota)}`}
              </span>
            </p>
            {!unlimited && (
              <>
                <div className="w-full h-2.5 bg-muted rounded-full mt-3 overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${relative}%` }} />
                </div>
                <p className="text-sm text-muted-foreground mt-2">{formatBytes(free ?? 0)} free</p>
              </>
            )}
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Per-app usage breakdown isn't exposed by Nextcloud's API. Manage trash and files from the Files page.
      </p>
    </div>
  );
}

// ─── Connected Apps Section ────────────────────────────────
function ConnectedAppsSection() {
  return (
    <div>
      <h2 className="text-xl font-bold">Connected Apps</h2>
      <p className="text-sm text-muted-foreground mb-4">OAuth apps and app passwords connected to your account</p>
      <Separator className="mb-6" />

      <div className="rounded-xl border bg-muted/20 p-6 text-center">
        <Puzzle size={28} className="text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">Managed in Nextcloud</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Connected clients, OAuth apps, and app passwords (including this one — “{NEXTCLOUD_APP_LABEL}”) are listed and
          revocable under your Nextcloud account's Security settings.
        </p>
      </div>
    </div>
  );
}

// ─── About Section ─────────────────────────────────────────
function AboutSection() {
  const { data: serverInfo } = useQuery<{ data: { version: string; versionstring: string; productname: string } }>({
    queryKey: ["/api/server-info"],
    queryFn: () => fetchJson<{ data: { version: string; versionstring: string; productname: string } }>("/api/server-info"),
  });
  const ncVersion = serverInfo?.data?.versionstring || serverInfo?.data?.version || "—";

  return (
    <div>
      <h2 className="text-xl font-bold">About CloudSpace</h2>
      <p className="text-sm text-muted-foreground mb-4">System information</p>
      <Separator className="mb-6" />

      <div className="flex flex-col items-center text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold mb-4">
          CS
        </div>
        <h3 className="text-2xl font-bold">CloudSpace</h3>
        <p className="text-muted-foreground mt-1">A modern frontend for your self-hosted Nextcloud</p>
      </div>

      <div className="border rounded-lg divide-y max-w-sm mx-auto mb-6">
        {[
          ["Frontend version", "0.1.0"],
          ["Nextcloud version", ncVersion],
          ["Stack", "React 19 + Tailwind CSS v3 + shadcn/ui"],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-4 mb-8">
        <a href="https://github.com/DExPioson/Gaurav-NextCloud" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
          <ExternalLink size={14} /> GitHub
        </a>
        <span className="text-muted-foreground">|</span>
        <button onClick={() => showToast("Opening Nextcloud docs")} className="text-sm text-primary hover:underline flex items-center gap-1">
          <ExternalLink size={14} /> Nextcloud docs
        </button>
        <span className="text-muted-foreground">|</span>
        <button onClick={() => showToast("Opening issue tracker")} className="text-sm text-primary hover:underline flex items-center gap-1">
          <ExternalLink size={14} /> Report issue
        </button>
      </div>

      <p className="text-center text-sm text-muted-foreground italic">Open source. Self-hosted. Yours.</p>
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────
export default function Settings() {
  const [activeSection, setActiveSection] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return params.get("section") || "profile";
  });

  const renderSection = () => {
    switch (activeSection) {
      case "profile": return <ProfileSection />;
      case "security": return <SecuritySection />;
      case "notifications": return <NotificationsSection />;
      case "appearance": return <AppearanceSection />;
      case "storage": return <StorageSection />;
      case "connected": return <ConnectedAppsSection />;
      case "about": return <AboutSection />;
      default: return <ProfileSection />;
    }
  };

  return (
    <div className="flex h-[calc(100vh-var(--topbar-height))]">
      {/* Left nav */}
      <div className="w-[220px] border-r flex-shrink-0 overflow-y-auto py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "px-3 py-2 rounded-lg mx-1 cursor-pointer text-sm flex items-center gap-2.5 w-[calc(100%-8px)] text-left",
                    activeSection === item.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon size={16} className={activeSection === item.id ? "text-accent-foreground" : ""} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
