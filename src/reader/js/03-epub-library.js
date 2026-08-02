    /* ── EPUB Validation Utilities ── */
    function validateEpubFile(file) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.epub')) {
        return { valid: false, error: 'The file "' + file.name + '" is not an EPUB. Please select a file with .epub extension.' };
      }
      if (file.type && file.type !== '' && file.type !== 'application/epub+zip') {
        return { valid: false, error: 'The file "' + file.name + '" is not a valid EPUB (detected type: ' + file.type + ').' };
      }
      return { valid: true };
    }

    async function validateEpubStructure(arrayBuffer) {
      try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const mimetypeFile = zip.file('mimetype');
        if (!mimetypeFile) {
          return { valid: false, error: 'Malformed EPUB: "mimetype" file missing.' };
        }
        const mimetypeContent = await mimetypeFile.async('string');
        if (mimetypeContent.trim() !== 'application/epub+zip') {
          return { valid: false, error: 'Malformed EPUB: invalid mimetype.' };
        }
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
          return { valid: false, error: 'Malformed EPUB: META-INF/container.xml missing.' };
        }
        const containerXml = await containerFile.async('string');
        const parser = new DOMParser();
        const doc = parser.parseFromString(containerXml, 'application/xml');
        /* getElementsByTagName is namespace-unaware and safer than querySelector for XML */
        const rootfile = doc.getElementsByTagName('rootfile')[0];
        if (!rootfile) {
          return { valid: false, error: 'Malformed EPUB: container.xml does not contain <rootfile>.' };
        }
        const opfPath = rootfile.getAttribute('full-path');
        if (!opfPath) {
          return { valid: false, error: 'Malformed EPUB: OPF path not specified in container.xml.' };
        }
        const opfFile = zip.file(opfPath);
        if (!opfFile) {
          return { valid: false, error: 'Malformed EPUB: OPF file "' + opfPath + '" not found.' };
        }
        /* Return zip object to avoid re-parsing in detectDrm */
        return { valid: true, zip: zip };
      } catch (e) {
        if (e.message && (e.message.includes('not a valid zip') || e.message.includes('corrupt') || e.message.includes('invalid'))) {
          return { valid: false, error: 'The file is not a valid ZIP archive. It may be corrupted or not an EPUB.' };
        }
        return { valid: false, error: 'Cannot read EPUB structure. The file may be damaged.' };
      }
    }

    async function detectDrm(zipOrBuffer) {
      try {
        /* Accept either a JSZip instance (from validateEpubStructure) or an ArrayBuffer */
        const zip = (zipOrBuffer && zipOrBuffer.files) ? zipOrBuffer : await JSZip.loadAsync(zipOrBuffer);
        const encryptionFile = zip.file('META-INF/encryption.xml');
        if (encryptionFile) {
          return { hasDrm: true, message: 'This EPUB is protected by DRM and cannot be read.\n\nDRM-protected files require Adobe Digital Editions or authorized software.' };
        }
        return { hasDrm: false };
      } catch (e) {
        return { hasDrm: false };
      }
    }

    async function saveBookToDB(file) {
      /* 1. Validate file type (extension + MIME) */
      const fileCheck = validateEpubFile(file);
      if (!fileCheck.valid) throw new Error(fileCheck.error);

      const arrayBuffer = await file.arrayBuffer();

      /* 2. Validate EPUB structure (ZIP, mimetype, container.xml, OPF) — returns zip for reuse */
      const structCheck = await validateEpubStructure(arrayBuffer);
      if (!structCheck.valid) throw new Error(structCheck.error);

      /* 3. Detect DRM (reuses parsed ZIP from structCheck) */
      const drmCheck = await detectDrm(structCheck.zip);
      if (drmCheck.hasDrm) throw new Error(drmCheck.message);

      /* 4. Open DB only after all validations pass */
      const db = await openDB();

      // Temporary load to get metadata
      const book = ePub(arrayBuffer);
      await book.ready;
      const metadata = await book.loaded.metadata;

      let coverUrl = '';
      try {
        coverUrl = await book.coverUrl(); // Returns a blob URL
      } catch (e) {
        console.warn('No cover found', e);
      }

      // Convert blob URL to base64 for storage (since blob URLs expire)
      let coverBase64 = null;
      if (coverUrl) {
        try {
          const response = await fetch(coverUrl);
          const blob = await response.blob();
          coverBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('Could not convert cover to base64');
        }
      }

      const bookRecord = {
        id: Date.now().toString(),
        title: metadata.title || file.name.replace('.epub', ''),
        author: metadata.creator || 'Unknown Author',
        data: arrayBuffer,
        cover: coverBase64,
        addedAt: Date.now()
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(bookRecord);

        request.onsuccess = () => resolve(bookRecord);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function getAllBooks() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteBook(id) {
      const db = await openDB();
      // Delete the book record (savedState is embedded, so it's removed too)
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
      // If this was the currently open book, reset tracking
      if (currentBookId === id) {
        currentBookId = null;
      }
      updateStorageBar();
    }

