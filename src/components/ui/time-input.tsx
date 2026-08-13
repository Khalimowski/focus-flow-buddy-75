import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  caretPosFor,
  isCompleteTime,
  maskTimeDraft,
  normalizeTimeDraft,
  usesMaskedTimeInput,
} from "@/lib/time";

// The caret has to be repositioned before the browser paints, but this file is
// also pulled into the prerender pass, where layout effects warn.
const useLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

type TimeInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> & {
  /** "HH:MM" (24h) or "" — same shape as a native time input's value. */
  value: string;
  onValueChange: (value: string) => void;
  /** Render a plain <input> instead of the styled Input primitive. */
  unstyled?: boolean;
};

/**
 * Time entry that is always 24-hour on the web.
 *
 * Where the browser locale already is 24h (and always on native) this is just
 * <input type="time">; where it would render AM/PM we swap in a typed HH:MM
 * field so the whole web app reads the same way. See src/lib/time.ts.
 */
const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ value, onValueChange, placeholder, unstyled, ...props }, ref) => {
    const masked = usesMaskedTimeInput();
    const Field = unstyled ? "input" : Input;
    const [draft, setDraft] = React.useState(value);
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    const attachRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      },
      [ref],
    );

    // Follow the parent when it changes the value under us (cleared after an
    // add, switched to another task), but don't clobber a draft the user is
    // still typing that already means the same time.
    React.useEffect(() => {
      setDraft((prev) => (normalizeTimeDraft(prev) === value ? prev : value));
    }, [value]);

    useLayoutEffect(() => {
      if (!masked) return;
      const el = innerRef.current;
      if (!el || el !== document.activeElement) return;
      const pos = caretPosFor(draft);
      if (pos !== null) el.setSelectionRange(pos, pos);
    }, [masked, draft]);

    if (!masked) {
      return (
        <Field
          ref={attachRef}
          type="time"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          {...props}
        />
      );
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = maskTimeDraft(e.target.value);
      setDraft(next);
      if (next === "") onValueChange("");
      else if (isCompleteTime(next)) onValueChange(next);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const normalized = normalizeTimeDraft(draft);
      setDraft(normalized);
      if (normalized !== value) onValueChange(normalized);
      props.onBlur?.(e);
    };

    return (
      <Field
        ref={attachRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        value={draft}
        onChange={handleChange}
        {...props}
        onBlur={handleBlur}
        placeholder={placeholder ?? "--:--"}
      />
    );
  },
);
TimeInput.displayName = "TimeInput";

export { TimeInput };
