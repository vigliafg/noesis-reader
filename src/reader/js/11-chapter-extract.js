    async function navigateToHref(href) {
      if (!href || !rendition || !book) return;

      let target = href.trim();
      try {
        target = decodeURIComponent(target);
      } catch (e) { }

      // In scroll mode: destroy and recreate the rendition to prevent
      // backward-scroll issues when loading adjacent chapters.
      if (scrollMode) {
        // Step 1: Find the target spine item
        let targetSpineItem = null;
        let targetSpineIndex = -1;
        let targetAnchor = '';

        if (target.startsWith("epubcfi")) {
          try {
            const cfiParts = target.match(/epubcfi\(\/6\/(\d+)/);
            if (cfiParts && cfiParts[1]) {
              targetSpineIndex = (parseInt(cfiParts[1]) / 2) - 1;
              targetSpineItem = book.spine.get(targetSpineIndex);
            }
          } catch (e) {
            console.warn("Could not parse CFI:", e);
          }
        } else {
          const [pathPart, anchor] = target.split('#');
          targetAnchor = anchor || '';
          const fileName = pathPart.split('/').pop();

          let index = 0;
          book.spine.each((spineItem) => {
            if (!targetSpineItem && spineItem.href) {
              if (spineItem.href.endsWith(fileName) || spineItem.href === target || spineItem.href === pathPart) {
                targetSpineItem = spineItem;
                targetSpineIndex = index;
              }
            }
            index++;
          });
        }

        // Step 2: Destroy current rendition
        if (rendition) {
          rendition.destroy();
        }

        const viewer = document.getElementById('viewer');
        viewer.innerHTML = '';

        // Step 3: Create new rendition (using 'default' manager to prevent
        // auto-load of adjacent chapters) and register standard hooks
        rendition = book.renderTo('viewer', {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled',
          manager: 'default'
        });
        _registerRenditionHooks();

        // Step 4: Display the target chapter, preserving fragment anchors
        try {
          const displayTarget = targetSpineItem
            ? (targetAnchor ? targetSpineItem.href + '#' + targetAnchor : targetSpineItem.href)
            : target;
          await rendition.display(displayTarget);
        } catch (e) {
          console.error("Display failed:", e);
          await rendition.display();
        }
        return;
      }

      // For paginated mode, use normal display
      if (target.startsWith("epubcfi")) {
        try {
          await rendition.display(target);
        } catch (e) { console.error("CFI failed", e); }
        return;
      }

      try {
        await rendition.display(target);
      } catch (error1) {
        console.warn("Direct display failed, trying smart resolution...", error1);

        try {
          const [pathPart, anchor] = target.split('#');
          const fileName = pathPart.split('/').pop();

          let item = null;
          book.spine.each((spineItem) => {
            if (!item && spineItem.href && spineItem.href.endsWith(fileName)) {
              item = spineItem;
            }
          });

          if (item) {
            console.log("Found corresponding spine item:", item.href);
            const finalTarget = anchor ? `${item.href}#${anchor}` : item.href;
            await rendition.display(finalTarget);
          } else {
            if (anchor) {
              await rendition.display(anchor);
            } else {
              throw new Error("Section not found in spine");
            }
          }
        } catch (error2) {
          console.error("All navigation attempts failed:", error2);
          setStatus("Error: Could not open section. " + error2.message);
        }
      }
    }

    // Collect all TOC entries recursively starting from a root entry (includes root + all descendants)
    function collectAllSubchapters(tocEntry) {
      const result = [tocEntry];
      if (tocEntry.subitems && tocEntry.subitems.length > 0) {
        for (const subitem of tocEntry.subitems) {
          result.push(...collectAllSubchapters(subitem));
        }
      }
      return result;
    }


    // ── Unified tree extraction helper ──────────────────────────
    async function _extractTree(location) {
      if (!location || !location.start) throw new Error("Cannot determine current position");
      const nav = await book.loaded.navigation;
      const tocEntry = findTocEntry(nav.toc, location.start.href);
      if (!tocEntry) throw new Error("Cannot identify chapter in TOC");
      const allEntries = collectAllSubchapters(tocEntry);
      if (!allEntries.length) throw new Error("No subchapters found");
      const overallTitle = tocEntry.label || "Chapter";
      return { entries: allEntries, title: overallTitle };
    }
    // Extract multiple sections and combine into a single HTML document
    async function findAndLoadImage(srcPath, sectionPath) {
      const zip = book.archive.zip;
      const archiveFiles = zip ? Object.keys(zip.files) : [];
      const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);
      let imgPath = sectionDir + srcPath;

      const parts = imgPath.split('/');
      const resolved = [];
      for (const part of parts) {
        if (part === '..') {
          resolved.pop();
        } else if (part !== '.' && part !== '') {
          resolved.push(part);
        }
      }
      imgPath = resolved.join('/');

      const pathsToTry = [
        imgPath,
        imgPath.replace(/^\//, ''),
        '/' + imgPath,
        srcPath,
        srcPath.replace(/^\.\.\//, ''),
      ];

      const filename = srcPath.split('/').pop();
      const matchingFiles = archiveFiles.filter(f => f.endsWith('/' + filename) || f === filename);
      pathsToTry.push(...matchingFiles);

      for (const tryPath of pathsToTry) {
        if (!tryPath) continue;
        const normalizedPath = tryPath.replace(/^\//, '');

        // Try JSZip first (embedded version)
        if (zip) {
          const zipFile = zip.files[normalizedPath];
          if (zipFile && !zipFile.dir) {
            try {
              const arrayBuffer = await zipFile.async('arraybuffer');
              return { data: arrayBuffer, path: normalizedPath };
            } catch (e) {
              console.warn('Error reading file:', normalizedPath, e);
            }
          }
        }

        // Fallback: use book.archive.request() (CDN version only)
        if (!zip) {
          try {
            var archivePath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
            var imgData = await book.archive.request(archivePath);
            if (imgData) {
              var arrayBuffer = imgData instanceof ArrayBuffer ? imgData : new TextEncoder().encode(imgData).buffer;
              return { data: arrayBuffer, path: normalizedPath };
            }
          } catch (e) {
            // CDN request failed, continue trying other paths
          }
        }
      }
      return null;
    }

    async function extractMultipleSections(tocEntries, overallTitle) {
      if (!book) {
        alert('Please load an EPUB first');
        return;
      }

      setStatus('Extracting sections...');

      let combinedHTML = '';
      let allStyles = '';
      const processedHrefs = new Set();

      // Process each TOC entry
      for (const tocEntry of tocEntries) {
        if (!tocEntry.href) continue;

        const baseHref = tocEntry.href.split('#')[0];
        if (processedHrefs.has(baseHref)) continue;
        processedHrefs.add(baseHref);

        try {
          const spineItem = book.spine.get(tocEntry.href);
          if (!spineItem) continue;

          const section = book.spine.get(spineItem.href);
          await section.load(book.load.bind(book));

          const doc = section.document;
          if (!doc || !doc.body) continue;

          const clonedDoc = doc.cloneNode(true);

          // Process images
          const imgElements = clonedDoc.querySelectorAll('img');
          for (const imgEl of imgElements) {
            const src = imgEl.getAttribute('src');
            if (!src || src.startsWith('data:')) {
              continue;
            }

            try {
              let imgData, mimeType;

              if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
                const response = await fetch(src);
                const blob = await response.blob();
                imgData = await blob.arrayBuffer();
                mimeType = blob.type || 'image/jpeg';
              } else {
                const result = await findAndLoadImage(src, spineItem.href);
                if (!result || !result.data) continue;
                imgData = result.data;
                mimeType = 'image/jpeg';
                const view = new Uint8Array(imgData);

                if (view.length >= 4) {
                  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
                    mimeType = 'image/png';
                  } else if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
                    mimeType = 'image/gif';
                  } else if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
                    mimeType = 'image/jpeg';
                  } else if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) {
                    mimeType = 'image/webp';
                  } else if (view[0] === 0x3C) {
                    const textStart = new TextDecoder().decode(view.slice(0, 100));
                    if (textStart.includes('<svg') || textStart.includes('<?xml')) {
                      mimeType = 'image/svg+xml';
                    }
                  }
                }
              }

                const bytes = new Uint8Array(imgData);
                const chunkSize = 0x8000;
                let binary = '';
                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, i + chunkSize);
                  binary += String.fromCharCode.apply(null, chunk);
                }
                const base64 = btoa(binary);
                const dataUrl = `data:${mimeType};base64,${base64}`;
                imgEl.setAttribute('src', dataUrl);
            } catch (e) {
              console.warn('Error loading image:', src, e);
            }
          }

          // Extract styles (only once from first section)
          if (allStyles === '') {
            const styleElements = doc.querySelectorAll('style');
            for (const styleEl of styleElements) {
              if (styleEl.textContent) {
                allStyles += '/* Inline style */\n' + styleEl.textContent + '\n\n';
              }
            }

            const linkElements = doc.querySelectorAll('link[rel="stylesheet"]');
            for (const link of linkElements) {
              try {
                const href = link.getAttribute('href');
                if (href) {
                  const sectionPath = spineItem.href;
                  const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);
                  let cssPath = sectionDir + href;
                  const parts = cssPath.split('/');
                  const resolved = [];
                  for (const part of parts) {
                    if (part === '..') {
                      resolved.pop();
                    } else if (part !== '.' && part !== '') {
                      resolved.push(part);
                    }
                  }
                  cssPath = resolved.join('/');
                  const archivePath = cssPath.startsWith('/') ? cssPath : '/' + cssPath;
                  const cssData = await book.archive.request(archivePath);
                  if (cssData) {
                    let cssText;
                    if (typeof cssData === 'string') {
                      cssText = cssData;
                    } else {
                      cssText = new TextDecoder('utf-8').decode(cssData);
                    }
                    allStyles += `/* Stylesheet: ${href} */\n` + cssText + '\n\n';
                  }
                }
              } catch (e) {
                console.warn('Error loading stylesheet:', link.getAttribute('href'), e);
              }
            }

            const computedStyles = `
              body {
                font-family: ${window.getComputedStyle(doc.body).fontFamily};
                font-size: 16px;
                line-height: 1.6;
              }
            `;
            allStyles += computedStyles;
          }

          // Add section separator with title
          combinedHTML += `<div class="section-divider"><h2>${tocEntry.label}</h2></div>\n`;
          combinedHTML += clonedDoc.body.innerHTML + '\n\n';

        } catch (e) {
          console.warn('Error extracting section:', tocEntry.label, e);
        }
      }

      if (!combinedHTML) {
        alert('No content extracted');
        return;
      }

      // Generate final HTML (reusing template from extractCurrentChapter)
      const _msChapterId = 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const _msFirstSnapId = 'snap_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const _msFirstSnapNow = new Date().toISOString();
      const _msFirstSnapTs = _msFirstSnapNow.substring(0,4)+_msFirstSnapNow.substring(5,7)+_msFirstSnapNow.substring(8,10)
                           + '-' + _msFirstSnapNow.substring(11,13)+_msFirstSnapNow.substring(14,16)+_msFirstSnapNow.substring(17,19);
      const _msFirstSnapshot = {
        snapshotId: _msFirstSnapId,
        createdAt: _msFirstSnapNow,
        bookName: currentBookTitle || 'Unknown Book',
        chapterName: overallTitle || 'Unknown Chapter',
        description: 'origin-' + _msFirstSnapTs,
        isOrigin: true,
        content: combinedHTML
      };
      const _msChapterRecord = {
        chapterId: _msChapterId,
        bookName: currentBookTitle || 'Unknown Book',
        chapterName: overallTitle || 'Unknown Chapter',
        createdAt: new Date().toISOString(),
        snapshots: [_msFirstSnapshot]
      };
      try { await saveExtractedChapterToDB(_msChapterRecord); } catch(e) { console.warn('noesisDB save failed:', e); }

      // ── Salva nel formato selezionato ──
      const _ts2 = _buildExtractionTimestamp();
      _dispatchExtractDownload(currentBookTitle || '', overallTitle || '', _msChapterId, combinedHTML, _ts2, allStyles);

      setStatus('✅ Sections extracted! Check new tab');
    }

    function findTocEntry(items, targetHref) {
      for (const item of items) {
        if (item.href && targetHref.includes(item.href.split('#')[0])) {
          return item;
        }
        if (item.subitems) {
          const found = findTocEntry(item.subitems, targetHref);
          if (found) return found;
        }
      }
      return null;
    }

    async function extractCurrentChapter() {
      if (!book || !rendition) {
        alert('Please load an EPUB first');
        return;
      }

      setStatus('Extracting chapter...');

      try {
        const location = rendition.currentLocation();
        if (!location || !location.start) {
          alert('Cannot determine current chapter');
          return;
        }

        const currentHref = location.start.href;
        let currentSpineItem = book.spine.get(currentHref);

        if (!currentSpineItem) {
          const spineIndex = location.start.index;
          currentSpineItem = book.spine.get(spineIndex);
        }

        if (!currentSpineItem) {
          alert('Cannot find current chapter in book structure');
          return;
        }

        const nav = await book.loaded.navigation;
        let chapterTitle = 'Chapter';

        const tocEntry = findTocEntry(nav.toc, currentSpineItem.href);
        if (tocEntry) {
          chapterTitle = tocEntry.label;
        }

        setStatus('Loading chapter content...');

        // Load the section
        const section = book.spine.get(currentSpineItem.href);
        await section.load(book.load.bind(book));

        const doc = section.document;
        if (!doc || !doc.body) {
          alert('Cannot extract chapter content');
          return;
        }

        setStatus('Processing images...');

        // Clone the document to modify it
        const clonedDoc = doc.cloneNode(true);

        // Extract and convert ALL images to base64 using DOM manipulation
        const imgElements = clonedDoc.querySelectorAll('img');

        for (const imgEl of imgElements) {
          const src = imgEl.getAttribute('src');

          // Skip if already base64 or external URL
          if (!src || src.startsWith('data:')) {
            continue;
          }

          try {
            let imgData, mimeType;

            if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
              const response = await fetch(src);
              const blob = await response.blob();
              imgData = await blob.arrayBuffer();
              mimeType = blob.type || 'image/jpeg';
            } else {
              const result = await findAndLoadImage(src, currentSpineItem.href);
              if (!result || !result.data) continue;
              imgData = result.data;
              mimeType = 'image/jpeg'; // default
              const view = new Uint8Array(imgData);

              if (view.length >= 4) {
                if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
                  mimeType = 'image/png';
                }
                else if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
                  mimeType = 'image/gif';
                }
                else if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
                  mimeType = 'image/jpeg';
                }
                else if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) {
                  mimeType = 'image/webp';
                }
                else if (view[0] === 0x3C) {
                  const textStart = new TextDecoder().decode(view.slice(0, 100));
                  if (textStart.includes('<svg') || textStart.includes('<?xml')) {
                    mimeType = 'image/svg+xml';
                  }
                }
              }
            }

            // Convert ArrayBuffer to base64 in chunks
            const bytes = new Uint8Array(imgData);
            const chunkSize = 0x8000; // 32KB chunks
            let binary = '';
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, chunk);
            }
            const base64 = btoa(binary);

            const dataUrl = `data:${mimeType};base64,${base64}`;
            imgEl.setAttribute('src', dataUrl);
          } catch (e) {
            console.warn('Error loading image:', src, e);
          }
        }

        // Get HTML content from the modified document
        let htmlContent = clonedDoc.body.innerHTML;

        setStatus('Processing styles...');

        // Extract ALL CSS styles
        let allStyles = '';

        // 1. Inline styles from <style> tags
        const styleElements = doc.querySelectorAll('style');
        for (const styleEl of styleElements) {
          if (styleEl.textContent) {
            allStyles += '/* Inline style */\n' + styleEl.textContent + '\n\n';
          }
        }

        // 2. Linked stylesheets
        const linkElements = doc.querySelectorAll('link[rel="stylesheet"]');
        for (const link of linkElements) {
          try {
            const href = link.getAttribute('href');
            if (href) {
              // Manually resolve the path relative to the current section
              const sectionPath = currentSpineItem.href;
              const sectionDir = sectionPath.substring(0, sectionPath.lastIndexOf('/') + 1);

              // Combine paths and normalize
              let cssPath = sectionDir + href;
              const parts = cssPath.split('/');
              const resolved = [];
              for (const part of parts) {
                if (part === '..') {
                  resolved.pop();
                } else if (part !== '.' && part !== '') {
                  resolved.push(part);
                }
              }
              cssPath = resolved.join('/');

              const archivePath = cssPath.startsWith('/') ? cssPath : '/' + cssPath;
              const cssData = await book.archive.request(archivePath);
              if (cssData) {
                let cssText;
                if (typeof cssData === 'string') {
                  cssText = cssData;
                } else {
                  cssText = new TextDecoder('utf-8').decode(cssData);
                }
                allStyles += `/* Stylesheet: ${href} */\n` + cssText + '\n\n';
              }
            }
          } catch (e) {
            console.warn('Error loading stylesheet:', link.getAttribute('href'), e);
          }
        }

        // 3. Get computed styles from the rendered content
        const computedStyles = `
      /* Additional computed styles */
      body {
        font-family: ${window.getComputedStyle(doc.body).fontFamily};
        font-size: 16px;
        line-height: 1.6;
      }
    `;

        allStyles += computedStyles;

        // Create standalone HTML document

        // Save chapterRecord to noesisDB (Snapshot system)
        const _chapterId = 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const _firstSnapId = 'snap_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const _firstSnapNow = new Date().toISOString();
        const _firstSnapTs = _firstSnapNow.substring(0,4)+_firstSnapNow.substring(5,7)+_firstSnapNow.substring(8,10)
                           + '-' + _firstSnapNow.substring(11,13)+_firstSnapNow.substring(14,16)+_firstSnapNow.substring(17,19);
        const _firstSnapshot = {
          snapshotId: _firstSnapId,
          createdAt: _firstSnapNow,
          bookName: currentBookTitle || 'Unknown Book',
          chapterName: chapterTitle || 'Unknown Chapter',
          description: 'origin-' + _firstSnapTs,
          isOrigin: true,
          content: htmlContent
        };
        const _chapterRecord = {
          chapterId: _chapterId,
          bookName: currentBookTitle || 'Unknown Book',
          chapterName: chapterTitle || 'Unknown Chapter',
          createdAt: new Date().toISOString(),
          snapshots: [_firstSnapshot]
        };
        try {
          await saveExtractedChapterToDB(_chapterRecord);
        } catch (e) {
          console.warn('Could not save chapterRecord to noesisDB:', e);
        }

        // ── Salva nel formato selezionato ──
        const _ts = _buildExtractionTimestamp();
        _dispatchExtractDownload(currentBookTitle || '', chapterTitle || '', _chapterId, htmlContent, _ts, allStyles);

        setStatus('✅ Chapter extracted! Check new tab');

      } catch (error) {
        console.error('Error extracting chapter:', error);
        alert('Error extracting chapter: ' + error.message);
        setStatus('Error extracting chapter');
      }
    }

