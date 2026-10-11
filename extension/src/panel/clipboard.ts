import { useCallback, useEffect, useRef, useState } from "react";

/** navigator.clipboard is blocked in DevTools panels; copy through a temporary textarea. */
function copyText(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.append(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/** Copies text and reports `copied` for a second, for "Copied" feedback on the button. */
export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    copyText(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1000);
  }, []);
  return [copied, copy];
}
