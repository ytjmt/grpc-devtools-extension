import "../../extension/src/panel/styles.css";
import { afterEach } from "vitest";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // renderPanel mounts into its own container; vitest-browser-react unmounts but leaves it.
  document.querySelectorAll("body > #root").forEach((el) => el.remove());
});
