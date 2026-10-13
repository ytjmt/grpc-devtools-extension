import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../i18n";

/** Matches the min-width / max-width rules on `.main.with-detail .list` in styles.css. */
export const LIST_MIN_WIDTH = 140;
export const DETAIL_MIN_WIDTH = 240;
const STORAGE_KEY = "grpc-devtools.callListWidth";
const KEY_STEP = 16;

/** Call list width chosen by dragging the splitter; undefined until the user resizes it. */
export function useListWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(STORAGE_KEY));
      return v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  });
  const save = (w: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      // Storage may be unavailable; the width still applies for this session.
    }
  };
  return { width, setWidth, save };
}

/** Vertical bar between the call list (previous sibling) and the detail pane. */
export function Splitter({ onResize, onCommit }: { onResize: (w: number) => void; onCommit: (w: number) => void }) {
  // A ref, not state: pointer events can arrive before React re-renders.
  const drag = useRef<{ x: number; width: number; max: number; last: number }>(undefined);
  const [dragging, setDragging] = useState(false);

  const bounds = (el: HTMLElement) => {
    const list = el.previousElementSibling as HTMLElement;
    const max = el.parentElement!.clientWidth - DETAIL_MIN_WIDTH;
    return { width: list.getBoundingClientRect().width, max: Math.max(LIST_MIN_WIDTH, max) };
  };
  const clamp = (w: number, max: number) => Math.round(Math.min(Math.max(w, LIST_MIN_WIDTH), max));

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
      aria-label={t("list.resize")}
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
