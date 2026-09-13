import { api } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

export function useApplications() {
  return useAsync((signal) => api.listApplications(signal), []);
}

export function useApplication(id: string | undefined) {
  return useAsync((signal) => {
    if (!id) return Promise.reject(new Error("Missing application id"));
    return api.getApplication(id, signal);
  }, [id]);
}

export function useRecentRuns() {
  return useAsync((signal) => api.listRuns(signal), []);
}
