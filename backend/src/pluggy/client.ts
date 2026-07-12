const BASE_URL = "https://api.pluggy.ai";

export interface PluggyAccount {
  id: string;
  itemId: string;
  type: string;
  subtype: string | null;
  name: string;
  balance: number;
  currencyCode: string;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  type: "DEBIT" | "CREDIT";
  status: "PENDING" | "POSTED";
  currencyCode: string;
}

export interface PluggyInvestment {
  id: string;
  itemId: string;
  name: string;
  type: string;
  subtype: string | null;
  // Current redeemable value — distinct from `amount` (gross, pre-tax) and
  // `amountOriginal` (what was initially invested).
  balance: number;
  currencyCode: string;
  status: "ACTIVE" | "TOTAL_WITHDRAWAL" | "PENDING";
}

interface AuthResponse {
  apiKey: string;
}

interface CursorPaginatedResponse<T> {
  results: T[];
  next: string | null;
}

// Each person has their own Pluggy client id/secret, so the resolved API key
// is cached per clientId rather than in a single module-level scalar —
// otherwise concurrent syncs for two different people would thrash/leak each
// other's cached key.
export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

const apiKeyCache = new Map<string, { apiKey: string; expiresAt: number }>();

function decodeJwtExpiryMs(token: string): number {
  const payload = token.split(".")[1];
  if (!payload) return 0;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function getApiKey(credentials: PluggyCredentials): Promise<string> {
  const now = Date.now();
  const cached = apiKeyCache.get(credentials.clientId);
  if (cached && now < cached.expiresAt) {
    return cached.apiKey;
  }

  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      nonExpiring: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Pluggy auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as AuthResponse;
  const expiry = decodeJwtExpiryMs(data.apiKey);
  // Refresh 5 minutes before actual expiry (falls back to ~100min if the JWT can't be decoded)
  const expiresAt = expiry > 0 ? expiry - 5 * 60 * 1000 : now + 100 * 60 * 1000;
  apiKeyCache.set(credentials.clientId, { apiKey: data.apiKey, expiresAt });
  return data.apiKey;
}

// Takes a path that already includes its query string (used directly for
// following Pluggy's pre-encoded `next` pagination fragment as-is).
async function pluggyGet<T>(pathWithQuery: string, credentials: PluggyCredentials): Promise<T> {
  const apiKey = await getApiKey(credentials);
  const res = await fetch(`${BASE_URL}${pathWithQuery}`, { headers: { "X-API-KEY": apiKey } });
  if (!res.ok) {
    throw new Error(`Pluggy request failed: ${pathWithQuery} -> ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function pluggyFetch<T>(
  path: string,
  credentials: PluggyCredentials,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return pluggyGet<T>(url.pathname + url.search, credentials);
}

export async function fetchAccounts(
  itemId: string,
  credentials: PluggyCredentials
): Promise<PluggyAccount[]> {
  const data = await pluggyFetch<PluggyAccount[] | { results: PluggyAccount[] }>(
    "/accounts",
    credentials,
    { itemId }
  );
  return Array.isArray(data) ? data : data.results;
}

interface PagePaginatedResponse<T> {
  total: number;
  totalPages: number;
  page: number;
  results: T[];
}

// Investments (fixed income, stocks, funds...) are a separate Pluggy product
// from Accounts — a BANK item can have investment holdings that never show
// up in /accounts at all.
export async function fetchInvestments(
  itemId: string,
  credentials: PluggyCredentials
): Promise<PluggyInvestment[]> {
  const all: PluggyInvestment[] = [];
  let page = 1;
  while (true) {
    const data = await pluggyFetch<PagePaginatedResponse<PluggyInvestment>>(
      "/investments",
      credentials,
      { itemId, page, pageSize: 100 }
    );
    all.push(...data.results);
    if (page >= data.totalPages) break;
    page += 1;
  }
  return all;
}

export async function fetchTransactions(
  accountId: string,
  credentials: PluggyCredentials
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  // Pluggy's `next` is a full, pre-encoded query-string fragment (e.g.
  // "?accountId=...&after=..."), not a bare cursor token — follow it as-is
  // rather than re-encoding it into an `after` param ourselves.
  let pathWithQuery: string | null = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;

  while (pathWithQuery) {
    const data: CursorPaginatedResponse<PluggyTransaction> = await pluggyGet(
      pathWithQuery,
      credentials
    );
    all.push(...data.results);
    pathWithQuery = data.next ? `/v2/transactions${data.next}` : null;
  }

  return all;
}
