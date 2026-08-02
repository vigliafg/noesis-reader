/* ════════════════════════════════════════════════
   IDB BRIDGE — delega operazioni IDB al parent/opener
   (contesto blob: blocca IndexedDB diretto)
════════════════════════════════════════════════ */
var _idbCallbacks = {};
var _idbCallbackId = 0;

function _idbPost(op, payload) {
  return new Promise(function(resolve, reject) {
    var target = window.opener || window.parent;
    if (!target || target === window) { reject(new Error('No opener/parent')); return; }
    var id = ++_idbCallbackId;
    _idbCallbacks[id] = { resolve: resolve, reject: reject };
    target.postMessage({ __noesisIDB: true, id: id, op: op, payload: payload }, '*');
    setTimeout(function() {
      if (_idbCallbacks[id]) { delete _idbCallbacks[id]; reject(new Error('IDB timeout')); }
    }, 8000);
  });
}

window.addEventListener('message', function(e) {
  var d = e.data;
  if (!d || !d.__noesisIDBResponse) return;
  var cb = _idbCallbacks[d.id];
  if (!cb) return;
  delete _idbCallbacks[d.id];
  if (d.error) cb.reject(new Error(d.error));
  else cb.resolve(d.result);
});

