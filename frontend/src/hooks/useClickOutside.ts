import { useEffect, type RefObject } from "react";

// The "open a popover, close it on an outside click" behavior duplicated
// across NotificationBell, CategorySelect (via useSearchCreatePopover), and
// PersonSwitcher — pulled out once more callers needed the exact same thing.
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [active, onOutside, ref]);
}
