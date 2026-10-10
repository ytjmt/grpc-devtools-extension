import { createRoot } from "react-dom/client";
import type { CaptureStore } from "../capture";
import { App } from "./App";
import { chromeSchemaBackend } from "./schemaBackend";
import "./styles.css";

if (chrome.devtools?.panels?.themeName === "dark") document.documentElement.classList.add("dark");

const root = createRoot(document.getElementById("root")!);
let attached: CaptureStore | undefined;

function attach(store: CaptureStore) {
  if (attached === store) return;
  attached = store;
  root.render(<App store={store} schemaBackend={chromeSchemaBackend} />);
}

window.__attachGrpcStore = attach;
if (window.__pendingGrpcStore) attach(window.__pendingGrpcStore);
