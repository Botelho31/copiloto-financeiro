import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { LockGlyph } from "../components/LockControl";
import type { VaultStatus } from "../hooks/useVault";
import { apiFetch } from "./api";

type Credential = { password: string } | { recoveryCode: string };
type Direction = "lock" | "unlock";

interface OverlayState {
  direction: Direction;
  fromRect: DOMRect;
  unlocked: boolean;
}

interface Target {
  x: number;
  y: number;
  size: number;
}

interface VaultTransitionContextValue {
  runLock: (originEl: SVGSVGElement) => Promise<void>;
  runUnlock: (originEl: SVGSVGElement, credential: Credential) => Promise<void>;
}

const VaultTransitionContext = createContext<VaultTransitionContextValue | null>(null);

// The overlay's own icon is always rendered at this native size; the CSS
// transform (translate+scale) below is what makes it start out matching the
// small header icon's real size/position, or the large unlock-screen one's.
const ICON_SIZE = 64;
const SCRIM_FADE_MS = 240;
const MOVE_MS = 520;
// Long enough for the glyph's own shackle (320ms) + color (200ms)
// transitions to fully settle while the icon sits still.
const STATE_MS = 360;
const REVEAL_MS = 260;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The real icon sizes this overlay is standing in for — LockControl's
// default `size` (18) and VaultUnlock's explicit `size={40}` — used only as
// a fallback guess (see measureIcon below) if the real element can't be
// found for some reason.
const HEADER_ICON_SIZE = 18;
const AUTH_ICON_SIZE = 40;

function unlockTarget(): Target {
  return { x: window.innerWidth - 41, y: 33, size: HEADER_ICON_SIZE };
}

function authCardFallback(): Target {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 - 110, size: AUTH_ICON_SIZE };
}

// The real destination element, read straight out of the DOM once it's
// mounted — exact, rather than a guess at the auth-card's layout (which
// drifted wrong the moment its content changed, e.g. the heading above the
// icon being removed shifted the icon's resting position). Only usable once
// the real screen has actually been swapped in underneath the scrim.
function measureIcon(selector: string): Target | null {
  const el = document.querySelector<SVGSVGElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
}

export function VaultTransitionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // A synchronous guard against a second runLock/runUnlock starting while
  // one is already mid-sequence — e.g. a double Enter-key submit, or any
  // other near-simultaneous double-invocation. All the overlay/target/etc.
  // state below is shared (one transition at a time, by design), so two
  // concurrent sequences would interleave their setState calls and corrupt
  // each other — one sequence's "start closed" write landing after the
  // other's "now open" write, which looks like the icon randomly re-locking
  // mid-unlock. A ref (not React state) because this must be checked and
  // set synchronously, before any await, immune to render timing.
  const runningRef = useRef(false);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [scrimVisible, setScrimVisible] = useState(false);
  const [moved, setMoved] = useState(false);
  const [revealing, setRevealing] = useState(false);

  // Applied mid-animation, hidden behind the (near-)opaque scrim — never
  // while the real screen underneath is visible, so the swap itself is
  // never seen, only the travelling icon and the darkening/lightening page.
  function applyVaultStatus(unlocked: boolean) {
    qc.setQueryData<VaultStatus>(["vault-status"], (prev) => ({
      hasVault: prev?.hasVault ?? true,
      unlocked,
    }));
    if (!unlocked) {
      // Every other cached query was read while unlocked — none of it is
      // valid to keep showing once locked. Excludes vault-status itself:
      // removing and recreating that one (instead of updating it in place,
      // above) leaves its already-mounted observer (App.tsx) never
      // noticing the replacement — confirmed by hand.
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "vault-status" });
    }
  }

  function resetOverlay() {
    setOverlay(null);
    setTarget(null);
    setScrimVisible(false);
    setMoved(false);
    setRevealing(false);
  }

  // Locking: travels the whole way across the screen first, staying
  // unlocked/green the entire trip, and only locks (shackle shuts, color
  // fades to grey) once it's arrived and come to rest at full size —
  // "locking" reads as something that happens *at* the vault, not en route.
  //
  // Unlike unlockTarget (a fixed formula that happens to match the topbar's
  // own fixed CSS closely enough), the auth-card's icon position isn't
  // guessed — the scrim fades in first, the real screen swap happens hidden
  // behind it, and only then do we read the real icon's position straight
  // out of the DOM and start the move. A guessed formula here drifted wrong
  // as soon as the auth-card's own content changed (e.g. its heading).
  async function runLock(originEl: SVGSVGElement): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const rect = originEl.getBoundingClientRect();
      await apiFetch("/api/vault/lock", { method: "POST" });
      if (prefersReducedMotion()) {
        applyVaultStatus(false);
        return;
      }

      setOverlay({ direction: "lock", fromRect: rect, unlocked: true });
      setTarget(authCardFallback());
      await nextFrame();
      await nextFrame();

      setScrimVisible(true);
      await wait(SCRIM_FADE_MS);
      applyVaultStatus(false); // mounts the real auth-card, hidden behind the by-now near-opaque scrim
      await nextFrame();
      await nextFrame();
      setTarget(measureIcon(".auth-card .lock-glyph") ?? authCardFallback());
      await nextFrame();

      setMoved(true);
      await wait(MOVE_MS);

      setOverlay((s) => (s ? { ...s, unlocked: false } : s));
      await wait(STATE_MS);

      setRevealing(true);
      await wait(REVEAL_MS);
      resetOverlay();
    } finally {
      runningRef.current = false;
    }
  }

  // Unlocking: turns green and swings open right where it already is first,
  // then — already unlocked — shrinks and travels to the header's resting
  // spot. The reverse order from locking: the state change happens at the
  // origin, not the destination.
  async function runUnlock(originEl: SVGSVGElement, credential: Credential): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const rect = originEl.getBoundingClientRect();
      // Thrown on a wrong password/recovery code — propagates straight out
      // of this function before any of the below runs, so a typo never
      // triggers the overlay at all; the caller (VaultUnlock) shows the
      // error inline.
      await apiFetch("/api/vault/unlock", { method: "POST", body: JSON.stringify(credential) });
      if (prefersReducedMotion()) {
        applyVaultStatus(true);
        return;
      }

      setOverlay({ direction: "unlock", fromRect: rect, unlocked: false });
      setTarget(unlockTarget());
      await nextFrame();
      await nextFrame();

      setScrimVisible(true);
      setOverlay((s) => (s ? { ...s, unlocked: true } : s));
      await wait(STATE_MS);
      applyVaultStatus(true); // the scrim's been opaque well before STATE_MS is up

      setMoved(true);
      await wait(MOVE_MS);

      setRevealing(true);
      await wait(REVEAL_MS);
      resetOverlay();
    } finally {
      runningRef.current = false;
    }
  }

  const style = overlay
    ? ({
        "--start-x": `${overlay.fromRect.left + overlay.fromRect.width / 2 - ICON_SIZE / 2}px`,
        "--start-y": `${overlay.fromRect.top + overlay.fromRect.height / 2 - ICON_SIZE / 2}px`,
        "--start-scale": `${overlay.fromRect.width / ICON_SIZE}`,
        "--end-x": `${(target?.x ?? 0) - ICON_SIZE / 2}px`,
        "--end-y": `${(target?.y ?? 0) - ICON_SIZE / 2}px`,
        "--end-scale": `${(target?.size ?? ICON_SIZE) / ICON_SIZE}`,
      } as CSSProperties)
    : undefined;

  return (
    <VaultTransitionContext.Provider value={{ runLock, runUnlock }}>
      {children}
      {overlay && (
        <div
          className={`vault-transition-scrim${scrimVisible ? " is-visible" : ""}${revealing ? " is-revealing" : ""}`}
        >
          <div
            className={`vault-transition-icon-wrap${moved ? " is-moved" : ""}${revealing ? " is-revealing" : ""}`}
            style={style}
          >
            <LockGlyph unlocked={overlay.unlocked} size={ICON_SIZE} />
          </div>
        </div>
      )}
    </VaultTransitionContext.Provider>
  );
}

// Standard context+hook pairing (provider and its accessor hook belong
// together); splitting into two files just for HMR friendliness isn't worth it.
// eslint-disable-next-line react-refresh/only-export-components
export function useVaultTransition(): VaultTransitionContextValue {
  const ctx = useContext(VaultTransitionContext);
  if (!ctx) throw new Error("useVaultTransition must be used within VaultTransitionProvider");
  return ctx;
}
