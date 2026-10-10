// Make screenshots independent of font fallback: the Playwright image's generic
// monospace is a CJK font, and which font a generic family resolves to can shift
// with what earlier tests rendered. Pin metric-stable fonts that ship in the image.
// Also freeze motion and the caret.
const style = document.createElement("style");
style.textContent = `
  html:root { --font-sans: "Liberation Sans"; --font-mono: "Liberation Mono"; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`;
document.head.append(style);
