import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const KEY_STEP = 16;

/** Pane width chosen by dragging a splitter, kept under `storageKey`; undefined until the user resizes it. */
export function usePaneWidth(storageKey: string) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  });
  const save = (w: number) => {
    try {
      localStorage.setItem(storageKey, String(w));
    } catch {
      // Storage may be unavailable; the width still applies for this session.
    }
  };
  return { width, setWidth, save };
}

/**
 * Vertical bar that resizes the pane before it (its previous sibling).
 * `min` and `restMin` must match the pane's min-width / max-width rules in styles.css.
 */
export function Splitter({
  label,
  min,
  restMin,
  onResize,
  onCommit,
}: {
  label: string;
  /** Minimum width of the resized pane. */
  min: number;
  /** Width the rest of the container keeps at least. */
  restMin: number;
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  // A ref, not state: pointer events can arrive before React re-renders.
  const drag = useRef<{ x: number; width: number; max: number; last: number }>(undefined);
  const [dragging, setDragging] = useState(false);

  const bounds = (el: HTMLElement) => {
    const pane = el.previousElementSibling as HTMLElement;
    const max = el.parentElement!.clientWidth - restMin;
    return { width: pane.getBoundingClientRect().width, max: Math.max(min, max) };
  };
  const clamp = (w: number, max: number) => Math.round(Math.min(Math.max(w, min), max));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { width, max } = bounds(e.currentTarget);
    drag.current = { x: e.clientX, width, max, last: width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // The release can go unseen (e.g. outside the DevTools window); stop once no button is held.
    if (!(e.buttons & 1)) return endDrag();
    d.last = clamp(d.width + e.clientX - d.x, d.max);
    onResize(d.last);
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = undefined;
    setDragging(false);
    if (d.last !== d.width) onCommit(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    const { width, max } = bounds(e.currentTarget);
    const w = clamp(width + step, max);
    onResize(w);
    onCommit(w);
  };

  return (
    <div
      className={`splitter ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
