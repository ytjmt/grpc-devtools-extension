import "../../extension/src/panel/styles.css";
import { afterEach } from "vite-plus/test";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // Panel layout (e.g. the call list width) persists here.
  localStorage.clear();
  // renderPanel mounts into its own container; vitest-browser-react unmounts but leaves it.
  document.querySelectorAll("body > #root").forEach((el) => el.remove());
});
