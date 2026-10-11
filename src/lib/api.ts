const TOKEN_KEY = "offbeat.session";

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode): session lasts until reload */
  }
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the OFFBEAT server. Check your connection and try again.", 0, "network");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, res.status, e?.code, e?.fields);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
};
