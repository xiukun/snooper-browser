/**
 * RTTS Fullscreen Bridge (MAIN world)
 *
 * Patches native fullscreen APIs to notify the content script
 * before/after fullscreen transitions, allowing the subtitle
 * overlay to reposition correctly.
 *
 * Injected via manifest "world": "MAIN" so it runs in the page's
 * JavaScript context and can intercept Element.requestFullscreen.
 */
(() => {
  if ((window as any).__rttsFullscreenBridge) return;
  (window as any).__rttsFullscreenBridge = true;

  let seq = 0;

  function patch(proto: any, name: string, action: string) {
    const orig = proto && proto[name];
    if (typeof orig !== 'function' || orig.__rttsPatched) return;

    const patched = function (this: any, ...args: any[]) {
      const target = this;
      const id = String(++seq);

      // Notify ISOLATED-world content script to prepare overlay
      window.postMessage(
        { type: 'rtts:fullscreen', id, action, tag: target?.tagName || '' },
        '*',
      );

      return orig.apply(target, args);
    };

    patched.__rttsPatched = true;
    try {
      Object.defineProperty(proto, name, {
        value: patched,
        configurable: true,
        writable: true,
      });
    } catch {
      proto[name] = patched;
    }
  }

  patch(Element.prototype, 'requestFullscreen', 'enter');
  patch(Element.prototype, 'webkitRequestFullscreen', 'enter');
  patch(Document.prototype, 'exitFullscreen', 'exit');
  patch(Document.prototype, 'webkitExitFullscreen', 'exit');

  console.log('[RTTS FS Bridge] installed');
})();
