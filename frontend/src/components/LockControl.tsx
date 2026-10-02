import { forwardRef, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultTransition } from "../lib/vaultTransition";

// The shackle and body are separate SVG parts so the shackle alone can swing
// open on a hinge — the body stays put, like a real latch. transform-origin
// sits at the shackle's own bottom-left anchor (in the 24x24 viewBox), not
// the icon's center, so the rotation reads as "lifting open" rather than
// "spinning in place". Forwards its ref (and takes a size) so both
// LockControl's small header icon and VaultUnlock's large one can hand their
// real DOM position to lib/vaultTransition.tsx as the start/end point of the
// full-page travelling-icon animation.
export const LockGlyph = forwardRef<SVGSVGElement, { unlocked: boolean; size?: number }>(
  function LockGlyph({ unlocked, size = 18 }, ref) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`lock-glyph${unlocked ? " is-unlocked" : ""}`}
        aria-hidden="true"
      >
        <path
          className="lock-glyph__shackle"
          d="M7 10V7a5 5 0 0 1 10 0v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          className="lock-glyph__body"
          x="5"
          y="10"
          width="14"
          height="10"
          rx="2"
          fill="currentColor"
        />
        <circle className="lock-glyph__keyhole" cx="12" cy="15" r="1.3" fill="var(--ink)" />
      </svg>
    );
  }
);

export function LockControl() {
  const { t } = useTranslation("common");
  const { runLock } = useVaultTransition();
  const iconRef = useRef<SVGSVGElement>(null);
  // This control only ever exists in the tree once the app is unlocked —
  // App.tsx swaps it in right as that happens — so every mount of it IS the
  // moment of unlocking. One gold glint, then settle.
  const [justUnlocked, setJustUnlocked] = useState(true);
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setJustUnlocked(false), 700);
    return () => clearTimeout(timeout);
  }, []);

  function handleClick() {
    if (locking || !iconRef.current) return;
    setLocking(true);
    // Fire and forget — runLock owns the whole sequence (API call, the
    // full-page travelling-icon animation, swapping the vault-status cache
    // mid-animation) and this component unmounts once the real screen swaps
    // underneath it, so there's nothing left to reset `locking` for.
    void runLock(iconRef.current);
  }

  return (
    <button
      type="button"
      className={`secondary icon lock-control${justUnlocked ? " lock-control--glint" : ""}`}
      onClick={handleClick}
      disabled={locking}
      title={t("vault.lockNow")}
    >
      <LockGlyph ref={iconRef} unlocked={!locking} />
    </button>
  );
}
