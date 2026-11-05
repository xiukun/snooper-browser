(() => {
  // src/ext/fullscreen-bridge.ts
  (() => {
    if (window.__rttsFullscreenBridge) return;
    window.__rttsFullscreenBridge = true;
    let seq = 0;
    function patch(proto, name, action) {
      const orig = proto && proto[name];
      if (typeof orig !== "function" || orig.__rttsPatched) return;
      const patched = function(...args) {
        const target = this;
        const id = String(++seq);
        window.postMessage(
          { type: "rtts:fullscreen", id, action, tag: target?.tagName || "" },
          "*"
        );
        return orig.apply(target, args);
      };
      patched.__rttsPatched = true;
      try {
        Object.defineProperty(proto, name, {
          value: patched,
          configurable: true,
          writable: true
        });
      } catch {
        proto[name] = patched;
      }
    }
    patch(Element.prototype, "requestFullscreen", "enter");
    patch(Element.prototype, "webkitRequestFullscreen", "enter");
    patch(Document.prototype, "exitFullscreen", "exit");
    patch(Document.prototype, "webkitExitFullscreen", "exit");
    console.log("[RTTS FS Bridge] installed");
  })();
})();
