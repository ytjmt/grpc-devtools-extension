import { useEffect, useRef } from "react";
import type { ProtoSource } from "../core/protoSource";
import { t } from "../i18n";
import type { TypeLinker } from "./Declarations";

/** Reconstructed .proto text; type names link to their definitions, and `highlight` marks (and scrolls to) a type. */
export function ProtoView({
  source,
  highlight,
  link,
}: {
  source: ProtoSource;
  highlight?: { start: number; end: number };
  link: TypeLinker;
}) {
  const first = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Scroll only the detail pane, keeping the line below its sticky header.
    const line = first.current;
    const scroller = line?.closest(".type-detail");
    if (!line || !scroller) return;
    const head = scroller.querySelector(".type-detail-head")?.getBoundingClientRect().height ?? 0;
    scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - head - 8;
  }, [highlight?.start, source]);
  return (
    <pre className="proto-source" aria-label={t("browse.protoSource")}>
      <code>
        {source.lines.map((line, i) => {
          const marked = highlight && i >= highlight.start && i < highlight.end;
          return (
            <span
              key={i}
              ref={i === highlight?.start ? first : undefined}
              className={`proto-line ${marked ? "highlight" : ""}`}
            >
              {line.length === 0
                ? " "
                : line.map((token, j) =>
                    token.ref ? (
                      <a
                        key={j}
                        href="#"
                        className="type-link"
                        onClick={(e) => {
                          e.preventDefault();
                          link(token.ref!)();
                        }}
                      >
                        {token.text}
                      </a>
                    ) : token.kind ? (
                      <span key={j} className={`tok-${token.kind}`}>
                        {token.text}
                      </span>
                    ) : (
                      token.text
                    ),
                  )}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
