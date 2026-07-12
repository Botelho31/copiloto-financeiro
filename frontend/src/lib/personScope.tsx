import { createContext, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY = "budget-tracker:activeUserId";

interface PersonScopeContextValue {
  // null = Household (every person combined) — today's behavior.
  activeUserId: number | null;
  setActiveUserId: (id: number | null) => void;
}

const PersonScopeContext = createContext<PersonScopeContextValue | null>(null);

function readInitial(): number | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const id = raw ? Number(raw) : NaN;
  return Number.isFinite(id) ? id : null;
}

export function PersonScopeProvider({ children }: { children: ReactNode }) {
  const [activeUserId, setActiveUserIdState] = useState<number | null>(readInitial);

  function setActiveUserId(id: number | null) {
    setActiveUserIdState(id);
    if (id == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(id));
  }

  return (
    <PersonScopeContext.Provider value={{ activeUserId, setActiveUserId }}>
      {children}
    </PersonScopeContext.Provider>
  );
}

// Standard context+hook pairing (provider and its accessor hook belong
// together); splitting into two files just for HMR friendliness isn't worth it.
// eslint-disable-next-line react-refresh/only-export-components
export function usePersonScope(): PersonScopeContextValue {
  const ctx = useContext(PersonScopeContext);
  if (!ctx) throw new Error("usePersonScope must be used within PersonScopeProvider");
  return ctx;
}
