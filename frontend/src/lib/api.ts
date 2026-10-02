export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// null userId (Household) leaves the path untouched — the backend treats a
// missing ?userId= the same way.
export function appendUserId(path: string, userId: number | null): string {
  if (userId == null) return path;
  return `${path}${path.includes("?") ? "&" : "?"}userId=${userId}`;
}
