/**
 * Image viewer page (ext/image-viewer.html + image-viewer.js).
 *
 * The content script renders generated images inside an iframe pointed at
 * this extension page instead of an <img> in the host page's DOM. A page's
 * CSP `img-src` can forbid both data: URLs and third-party CDNs, which made
 * "the image generated fine but the panel shows nothing" a recurring
 * failure; an extension-origin document is governed by the extension's own
 * CSP and always renders.
 *
 * Contract: the iframe receives exactly one postMessage from the content
 * script: { type: 'rtts-image-viewer:show', src, id }. Any other type is
 * ignored. The src may be a data: URL or a remote URL - this document is
 * extension-origin, so both load. On load or error the viewer replies with
 * { type: 'rtts-image-viewer:ready' | 'rtts-image-viewer:error', id } so
 * the panel can show real dimensions or the fallback link.
 */

var viewerImg = document.getElementById('viewer-img')

var currentId = ''

window.addEventListener('message', function (event) {
  var data = event.data
  if (!data || data.type !== 'rtts-image-viewer:show' || typeof data.src !== 'string') return
  currentId = typeof data.id === 'string' ? data.id : ''
  viewerImg.removeAttribute('src')
  viewerImg.src = data.src
})

function reply(type) {
  // Parent is our own content script frame; no sensitive data crosses here.
  window.parent.postMessage({ type: type, id: currentId, width: viewerImg.naturalWidth, height: viewerImg.naturalHeight }, '*')
}

viewerImg.addEventListener('load', function () { reply('rtts-image-viewer:ready') })
viewerImg.addEventListener('error', function () { reply('rtts-image-viewer:error') })
