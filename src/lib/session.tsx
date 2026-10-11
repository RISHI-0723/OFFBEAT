import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken } from "./api";
import type { Viewer } from "../../server/auth";

export type { Viewer };

interface SessionValue {
  viewer: Viewer | null;
  loading: boolean;
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // The token is React state (mirrored to localStorage), so a sign-in re-renders every consumer immediately.
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const q = useQuery({
    queryKey: ["me", token],
    queryFn: () => api.get<{ viewer: Viewer | null }>("/api/me"),
    staleTime: 60_000,
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);

  const value = useMemo<SessionValue>(
    () => ({
      viewer: q.data?.viewer ?? null,
      loading: q.isLoading,
      signInWithToken: async (next) => {
        setToken(next);
        qc.removeQueries();
        const me = await api.get<{ viewer: Viewer | null }>("/api/me");
        qc.setQueryData(["me", next], me);
        setTokenState(next);
      },
      signOut: async () => {
        setToken(null);
        qc.removeQueries();
        setTokenState(null);
      },
      refresh,
    }),
    [q.data, q.isLoading, qc, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
