import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppSettings, IntegrationStatus } from "@internflow/shared";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

interface SettingsContextValue {
  settings: AppSettings | undefined;
  loading: boolean;
  error: string | undefined;
  updating: boolean;
  setDemoMode: (demoMode: boolean) => Promise<void>;
  reload: () => Promise<void>;
}

interface IntegrationsContextValue {
  integrations: IntegrationStatus[] | undefined;
  loading: boolean;
  error: string | undefined;
  reload: (silent?: boolean) => Promise<void>;
  replace: (integration: IntegrationStatus) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

/** Shared settings + integration status for the /app shell (header, pages). */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const settingsState = useAsync((signal) => api.getSettings(signal), []);
  const integrationsState = useAsync((signal) => api.listIntegrations(signal), []);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string>();

  const { setData: setSettings, reload: reloadSettings } = settingsState;
  const settingsRef = useRef(settingsState.data);
  settingsRef.current = settingsState.data;
  const { setData: setIntegrations, reload: reloadIntegrations } = integrationsState;

  const setDemoMode = useCallback(
    async (demoMode: boolean) => {
      setUpdating(true);
      setUpdateError(undefined);
      const previous = settingsRef.current;
      setSettings((s) => (s ? { ...s, demoMode } : s));
      try {
        const next = await api.updateSettings({ demoMode });
        setSettings(next);
        await reloadIntegrations(true);
      } catch (err) {
        setSettings(previous);
        setUpdateError(errorMessage(err));
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [setSettings, reloadIntegrations],
  );

  const replace = useCallback(
    (integration: IntegrationStatus) =>
      setIntegrations((list) => (list ? list.map((i) => (i.id === integration.id ? integration : i)) : list)),
    [setIntegrations],
  );

  const settingsValue = useMemo<SettingsContextValue>(
    () => ({
      settings: settingsState.data,
      loading: settingsState.loading,
      error: updateError ?? settingsState.error,
      updating,
      setDemoMode,
      reload: () => reloadSettings(true),
    }),
    [settingsState.data, settingsState.loading, settingsState.error, updateError, updating, setDemoMode, reloadSettings],
  );

  const integrationsValue = useMemo<IntegrationsContextValue>(
    () => ({
      integrations: integrationsState.data,
      loading: integrationsState.loading,
      error: integrationsState.error,
      reload: reloadIntegrations,
      replace,
    }),
    [integrationsState.data, integrationsState.loading, integrationsState.error, reloadIntegrations, replace],
  );

  return (
    <SettingsContext.Provider value={settingsValue}>
      <IntegrationsContext.Provider value={integrationsValue}>{children}</IntegrationsContext.Provider>
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <AppDataProvider>");
  return ctx;
}

export function useIntegrations(): IntegrationsContextValue {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) throw new Error("useIntegrations must be used inside <AppDataProvider>");
  return ctx;
}

export function engineLabel(llm: { provider: "anthropic" | "local"; model: string } | undefined): string {
  if (!llm) return "AI engine";
  if (llm.provider === "local") return "Local planner";
  return `Claude · ${llm.model}`;
}
