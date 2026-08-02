/* ════════════════════════════════════════════════
   UTILITY DOWNLOAD (documento)
════════════════════════════════════════════════ */
function download(filename, data, type) {
  type = type || 'text/plain;charset=utf-8';
  var blob = data instanceof Blob ? data : new Blob([data], { type: type });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function getContent() {
  return $('#editor').summernote('code');
}

/* ════════════════════════════════════════════════
   EXPORT DOCUMENTO
════════════════════════════════════════════════ */

function exportTXT() {
  var filename = _promptCustom('text', '.txt');
  if (!filename) return;
  var temp = document.createElement('div');
  temp.innerHTML = getContent();
  var ps = temp.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  var text = '';
  ps.forEach(function(p, i) { if (i > 0) text += '\n'; text += p.innerText; });
  if (!text) text = temp.innerText;
  download(filename, text);
}

function exportMD() {
  var filename = _promptCustom('markdown', '.md');
  if (!filename) return;
  download(filename, new TurndownService().turndown(getContent()));
}

function exportMDZip() {
  var filename = _promptCustom('mdzip', '.zip');
  if (!filename) return;
  var mdName = filename.replace('.zip', '.md');
  var zip = new JSZip();
  var imgs = zip.folder('images');
  var markdown = new TurndownService().turndown(getContent());
  var idx = 1;
  markdown = markdown.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g,
    function(m, alt, ext, b64) {
      var name = 'img_' + String(idx++).padStart(3,'0') + '.' + ext;
      imgs.file(name, b64, { base64: true });
      return '![' + alt + '](images/' + name + ')';
    });
  zip.file(mdName, markdown);
  zip.generateAsync({ type:'blob' }).then(function(blob) { download(filename, blob); });
}

function exportDocJSON() {
  var filename = _promptCustom('jsondoc', '.json');
  if (!filename) return;
  download(filename, JSON.stringify({ html: getContent() }, null, 2));
}

function exportPDF() {
  var pc = document.getElementById('print-container');
  pc.innerHTML = getContent();
  pc.querySelectorAll('table').forEach(function(t) {
    t.removeAttribute('width');
    t.style.cssText += 'width:100%;table-layout:fixed;border-collapse:collapse;word-break:break-word;max-width:100%;';
  });
  pc.querySelectorAll('td,th').forEach(function(c) {
    c.removeAttribute('width'); c.style.width = ''; c.style.maxWidth = '';
    c.style.wordBreak = 'break-word'; c.style.overflowWrap = 'break-word'; c.style.padding = '4px';
  });
  pc.querySelectorAll('img').forEach(function(img) {
    img.removeAttribute('width'); img.removeAttribute('height');
    img.style.maxWidth = '100%'; img.style.height = 'auto';
  });
  window.print();
  setTimeout(function() { pc.innerHTML = ''; }, 1000);
}

function exportDOCX() {
  var filename = _promptCustom('docx', '.docx');
  if (!filename) return;
  download(filename, window.htmlDocx.asBlob(getContent()));
}

