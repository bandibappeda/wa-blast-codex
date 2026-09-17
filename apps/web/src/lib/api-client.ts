export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload
      ? payload.error ?? "request_failed"
      : "request_failed";
    throw new ApiError(response.status, code);
  }
  return payload as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown, csrfToken?: string): Promise<T> {
    return request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(csrfToken ? { headers: { "X-CSRF-Token": csrfToken } } : {}),
    });
  },
  patch<T>(path: string, body: unknown, csrfToken?: string): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      ...(csrfToken ? { headers: { "X-CSRF-Token": csrfToken } } : {}),
    });
  },
  upload<T>(path: string, body: FormData, csrfToken?: string): Promise<T> {
    return request<T>(path, { method: "POST", body, ...(csrfToken ? { headers: { "X-CSRF-Token": csrfToken } } : {}) });
  },
};
