import { useState, useEffect, useCallback } from "react";
import { Switch, Route, useLocation, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { fetchJson } from "@/lib/api";
import { defaultCapabilities, type AppCapabilities } from "@/lib/capabilities";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Files from "@/pages/Files";
import Talk from "@/pages/Talk";
import Calendar from "@/pages/Calendar";
import Notes from "@/pages/Notes";
import Contacts from "@/pages/Contacts";
import Deck from "@/pages/Deck";
import Mail from "@/pages/Mail";
import Activity from "@/pages/Activity";
import Media from "@/pages/Media";
import Settings from "@/pages/Settings";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("cloudspace-theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("cloudspace-theme", theme);
  }, [theme]);

  return { theme, setTheme };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function FeatureUnavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function AppShell({ capabilities }: { capabilities: AppCapabilities }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1024);
  const [activeCapabilities, setActiveCapabilities] = useState(capabilities);

  const handleResize = useCallback(() => {
    if (window.innerWidth < 768) {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    setActiveCapabilities(capabilities);
  }, [capabilities]);

  useEffect(() => {
    let cancelled = false;

    fetchJson<AppCapabilities>("/api/capabilities")
      .then((next) => {
        if (!cancelled) {
          setActiveCapabilities(next);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} capabilities={activeCapabilities} />
      <div
        className="flex flex-1 flex-col transition-all duration-200"
        style={{ marginLeft: collapsed ? 60 : 240 }}
      >
        <TopBar sidebarCollapsed={collapsed} />
        <main className="flex-1 overflow-auto pt-14">
          <div key={location} className="h-full animate-fade-in">
            <Switch>
              <Route path="/">{() => <Dashboard />}</Route>
              <Route path="/files">{() => <Files />}</Route>
              <Route path="/talk">{() => activeCapabilities.talk ? <Talk /> : <FeatureUnavailable title="Talk is unavailable" detail="The Nextcloud Talk app is not enabled for this connection." />}</Route>
              <Route path="/calendar">{() => activeCapabilities.calendar ? <Calendar /> : <FeatureUnavailable title="Calendar is unavailable" detail="The Nextcloud Calendar app is not enabled for this connection." />}</Route>
              <Route path="/notes">{() => activeCapabilities.notes ? <Notes /> : <FeatureUnavailable title="Notes are unavailable" detail="The custom notes layer is not available for this connection." />}</Route>
              <Route path="/contacts">{() => activeCapabilities.contacts ? <Contacts /> : <FeatureUnavailable title="Contacts are unavailable" detail="The Nextcloud Contacts app is not enabled for this connection." />}</Route>
              <Route path="/deck">{() => activeCapabilities.deck ? <Deck /> : <FeatureUnavailable title="Deck is unavailable" detail="The Nextcloud Deck app is not enabled for this connection." />}</Route>
              <Route path="/mail">{() => activeCapabilities.mail ? <Mail /> : <FeatureUnavailable title="Mail is unavailable" detail="Nextcloud Mail is not configured for this user or the Mail app is missing." />}</Route>
              <Route path="/activity">{() => activeCapabilities.activity ? <Activity /> : <FeatureUnavailable title="Activity is unavailable" detail="This area is still disabled until it is wired to a real Nextcloud backend." />}</Route>
              <Route path="/media">{() => <Media />}</Route>
              <Route path="/settings">{() => <Settings />}</Route>
            </Switch>
          </div>
        </main>
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Connecting to Nextcloud...
    </div>
  );
}

function AppRoutes() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [capabilities, setCapabilities] = useState<AppCapabilities>(defaultCapabilities);
  const { data: session, isLoading } = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: async () => {
      try {
        const payload = await fetchJson<{ ok: boolean; user: unknown }>("/api/auth/session");
        return payload.user;
      } catch {
        return null;
      }
    },
    retry: false,
  });

  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.setQueryData(["/api/auth/session"], null);
      setLocation("/login");
    };

    window.addEventListener("cloudspace:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("cloudspace:unauthorized", handleUnauthorized);
  }, [queryClient, setLocation]);

  useEffect(() => {
    if (!session) {
      setCapabilities(defaultCapabilities);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchCaps = () => {
      fetchJson<AppCapabilities>("/api/capabilities")
        .then((next) => {
          if (cancelled) return;
          setCapabilities(next);
          // If the backend returned defaults (e.g. it restarted and hasn't probed
          // Nextcloud yet), retry after a short delay so the sidebar doesn't stay
          // grey forever.
          if (next.source === "default" && !next.talk) {
            retryTimer = setTimeout(fetchCaps, 3000);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setCapabilities(defaultCapabilities);
          // Retry on network error (backend might be restarting)
          retryTimer = setTimeout(fetchCaps, 3000);
        });
    };

    fetchCaps();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [session]);

  useEffect(() => {
    if (isLoading) return;

    if (!session && location !== "/login") {
      setLocation("/login");
    }
  }, [isLoading, location, session, setLocation]);

  if (isLoading) {
    return <FullScreenLoader />;
  }

  return (
    <Switch>
      <Route path="/login">{() => <Login />}</Route>
      <Route>{() => (session ? <AppShell capabilities={capabilities} /> : <FullScreenLoader />)}</Route>
    </Switch>
  );
}

export default function App() {
  useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <AppRoutes />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
