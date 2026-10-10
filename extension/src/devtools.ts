import { CaptureStore, startCapture } from "./capture";

declare global {
  interface Window {
    __grpcDevtoolsStore?: CaptureStore;
    __attachGrpcStore?: (store: CaptureStore) => void;
    /** Set when the panel is shown before its script has registered __attachGrpcStore. */
    __pendingGrpcStore?: CaptureStore;
  }
}

const store = new CaptureStore();
window.__grpcDevtoolsStore = store;
startCapture(store);

chrome.devtools.panels.create("gRPC", "", "panel.html", (panel) => {
  panel.onShown.addListener((panelWindow) => {
    const w = panelWindow as Window;
    if (w.__attachGrpcStore) w.__attachGrpcStore(store);
    else w.__pendingGrpcStore = store;
  });
});
