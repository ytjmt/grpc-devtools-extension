/** navigator.clipboard is blocked in DevTools panels; copy through a temporary textarea. */
export function copyText(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.append(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
