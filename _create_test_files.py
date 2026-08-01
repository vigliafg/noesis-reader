#!/usr/bin/env python3
"""Create corrupted EPUB derivatives from test.epub for validation testing.
Each derivative triggers a specific error in validateEpubFile / validateEpubStructure / detectDrm."""

import os, shutil, zipfile, io

BASE = "test.epub"
OUT = "."

def copy_zip_remove(src, dst, *paths_to_remove):
    """Copy ZIP removing specified internal paths."""
    with zipfile.ZipFile(src, 'r') as zin:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename in paths_to_remove:
                    continue
                zout.writestr(item, zin.read(item.filename))

def copy_zip_replace(src, dst, path, new_content):
    """Copy ZIP replacing content of one file."""
    with zipfile.ZipFile(src, 'r') as zin:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == path:
                    zout.writestr(item, new_content)
                else:
                    zout.writestr(item, zin.read(item.filename))

def copy_zip_add(src, dst, path, content):
    """Copy ZIP adding a new file."""
    with zipfile.ZipFile(src, 'r') as zin:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                zout.writestr(item, zin.read(item.filename))
            zout.writestr(path, content)

def copy_zip_remove_attr(src, dst, elem_tag, attr_name):
    """Copy ZIP but modify container.xml to remove an attribute from an element."""
    with zipfile.ZipFile(src, 'r') as zin:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'META-INF/container.xml':
                    import xml.etree.ElementTree as ET
                    content = zin.read(item.filename)
                    root = ET.fromstring(content)
                    # Find the element (handle namespace)
                    ns = 'urn:oasis:names:tc:opendocument:xmlns:container'
                    for elem in root.iter('{%s}%s' % (ns, elem_tag)):
                        if attr_name in elem.attrib:
                            del elem.attrib[attr_name]
                    new_content = ET.tostring(root, encoding='utf-8', xml_declaration=True)
                    zout.writestr(item, new_content)
                else:
                    zout.writestr(item, zin.read(item.filename))

def copy_zip_remove_elem(src, dst, elem_tag):
    """Copy ZIP but modify container.xml to remove a specific element."""
    with zipfile.ZipFile(src, 'r') as zin:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'META-INF/container.xml':
                    import xml.etree.ElementTree as ET
                    content = zin.read(item.filename)
                    root = ET.fromstring(content)
                    ns = 'urn:oasis:names:tc:opendocument:xmlns:container'
                    # Find and remove the element
                    parent_map = {c: p for p in root.iter() for c in p}
                    for elem in root.iter('{%s}%s' % (ns, elem_tag)):
                        parent = parent_map.get(elem)
                        if parent is not None:
                            parent.remove(elem)
                    new_content = ET.tostring(root, encoding='utf-8', xml_declaration=True)
                    zout.writestr(item, new_content)
                else:
                    zout.writestr(item, zin.read(item.filename))

# ── Case 1: Wrong extension (triggers validateEpubFile → "non è un EPUB") ──
print("1/10: test_not_epub.pdf — wrong extension")
shutil.copy2(BASE, os.path.join(OUT, "test_not_epub.pdf"))

# ── Case 2: Corrupted ZIP binary (triggers "non è un archivio ZIP valido") ──
print("2/10: test_corrupt_zip.epub — truncated ZIP")
with open(BASE, 'rb') as f:
    data = f.read()
# Truncate to 10% — definitely corrupt
corrupt = data[:len(data) // 10]
with open(os.path.join(OUT, "test_corrupt_zip.epub"), 'wb') as f:
    f.write(corrupt)

# ── Case 3: Missing mimetype file (triggers "mimetype mancante") ──
print("3/10: test_no_mimetype.epub — missing mimetype file")
copy_zip_remove(BASE, os.path.join(OUT, "test_no_mimetype.epub"), 'mimetype')

# ── Case 4: Wrong mimetype content (triggers "mimetype non valido") ──
print("4/10: test_bad_mimetype.epub — wrong mimetype content")
copy_zip_replace(BASE, os.path.join(OUT, "test_bad_mimetype.epub"), 'mimetype', b'application/pdf')

# ── Case 5: Missing container.xml (triggers "META-INF/container.xml mancante") ──
print("5/10: test_no_container.epub — missing container.xml")
copy_zip_remove(BASE, os.path.join(OUT, "test_no_container.epub"), 'META-INF/container.xml')

# ── Case 6: No <rootfile> element (triggers "non contiene <rootfile>") ──
print("6/10: test_no_rootfile.epub — container.xml without rootfile")
copy_zip_remove_elem(BASE, os.path.join(OUT, "test_no_rootfile.epub"), 'rootfile')

# ── Case 7: rootfile without full-path attribute (triggers "percorso OPF non specificato") ──
print("7/10: test_no_fullpath.epub — rootfile without full-path")
copy_zip_remove_attr(BASE, os.path.join(OUT, "test_no_fullpath.epub"), 'rootfile', 'full-path')

# ── Case 8: OPF file not found (triggers "file OPF non trovato") ──
# We change full-path to point to a non-existent file
print("8/10: test_no_opf.epub — OPF path points to missing file")
copy_zip_replace(BASE, os.path.join(OUT, "test_no_opf.epub"), 'META-INF/container.xml',
    b'<?xml version="1.0" encoding="utf-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile media-type="application/oebps-package+xml" full-path="NONEXISTENT/content.opf"/></rootfiles></container>')

# ── Case 9: DRM detected (triggers "protetto da DRM") ──
print("9/10: test_drm.epub — has encryption.xml")
copy_zip_add(BASE, os.path.join(OUT, "test_drm.epub"), 'META-INF/encryption.xml',
    b'<?xml version="1.0" encoding="utf-8"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData/></encryption>')

# ── Case 10: Also provide the original as .epub (valid baseline) ──
print("10/10: test_valid.epub — valid EPUB (copy of test.epub)")
shutil.copy2(BASE, os.path.join(OUT, "test_valid.epub"))

# ── Report ──
print("\n✅ All 10 test files generated in", os.path.abspath(OUT))
print()
for i, (name, trigger, expected) in enumerate([
    ("test_valid.epub",           "Nessuno",             "✅ EPUB caricato correttamente"),
    ("test_not_epub.pdf",         "validateEpubFile",    "⚠️ non è un EPUB"),
    ("test_corrupt_zip.epub",     "validateEpubStructure","⚠️ non è un archivio ZIP valido"),
    ("test_no_mimetype.epub",     "validateEpubStructure","⚠️ mimetype mancante"),
    ("test_bad_mimetype.epub",    "validateEpubStructure","⚠️ mimetype non valido"),
    ("test_no_container.epub",    "validateEpubStructure","⚠️ container.xml mancante"),
    ("test_no_rootfile.epub",     "validateEpubStructure","⚠️ non contiene <rootfile>"),
    ("test_no_fullpath.epub",     "validateEpubStructure","⚠️ percorso OPF non specificato"),
    ("test_no_opf.epub",          "validateEpubStructure","⚠️ file OPF non trovato"),
    ("test_drm.epub",             "detectDrm",           "⚠️ protetto da DRM"),
], 1):
    size = os.path.getsize(os.path.join(OUT, name))
    print(f"  {i:2d}. {name:30s} → {trigger:<25s} → {expected}")
