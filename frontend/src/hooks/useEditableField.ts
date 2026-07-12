import { useEffect, useState } from "react";

// The "edit-in-place, save-on-blur" core shared by Debts.tsx's inline field
// editors: a local string buffer seeded from the current value, kept in
// sync via effect whenever that source value changes elsewhere (e.g. a
// refetch after another edit), and a save() that hands the raw string back
// to the caller. Parsing, dirty-checking against the real (often
// non-string) source value, and the actual mutation call are left to the
// caller's onSave — they differ enough per field (numeric vs. plain string,
// nullable vs. not) that folding them into this hook would just move the
// same branching one level down.
export function useEditableField(sourceValue: string, onSave: (value: string) => void) {
  const [value, setValue] = useState(sourceValue);

  useEffect(() => {
    setValue(sourceValue);
  }, [sourceValue]);

  function save() {
    onSave(value);
  }

  return { value, setValue, save };
}
