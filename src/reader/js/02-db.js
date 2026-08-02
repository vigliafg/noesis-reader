    // --- INDEXEDDB & LIBRARY LOGIC ---

    // --- NOESIS DB (extractedChapters + snapshots) ---
    const NOESIS_DB_NAME = 'noesisDB';
    const NOESIS_DB_VERSION = 1;
    const NOESIS_STORE = 'extractedChapters';

    function openNoesisDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(NOESIS_DB_NAME, NOESIS_DB_VERSION);
        var blockedTimer = null;
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(NOESIS_STORE)) {
            const store = db.createObjectStore(NOESIS_STORE, { keyPath: 'chapterId' });
            store.createIndex('bookName', 'bookName', { unique: false });
            store.createIndex('chapterName', 'chapterName', { unique: false });
          }
        };
        request.onsuccess = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const db = event.target.result;
          db.onversionchange = () => { db.close(); console.warn('NoesisDB: version changed externally, connection closed.'); };
          resolve(db);
        };
        request.onerror = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const error = event.target.error;
          if (error.name === 'VersionError') {
            console.warn('NoesisDB VersionError, deleting old database...');
            const deleteRequest = indexedDB.deleteDatabase(NOESIS_DB_NAME);
            deleteRequest.onsuccess = () => {
              const retryRequest = indexedDB.open(NOESIS_DB_NAME, NOESIS_DB_VERSION);
              retryRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(NOESIS_STORE)) {
                  const store = db.createObjectStore(NOESIS_STORE, { keyPath: 'chapterId' });
                  store.createIndex('bookName', 'bookName', { unique: false });
                  store.createIndex('chapterName', 'chapterName', { unique: false });
                }
              };
              retryRequest.onsuccess = (event) => {
                const db = event.target.result;
                db.onversionchange = () => { db.close(); };
                resolve(db);
              };
              retryRequest.onerror = (event) => reject(event.target.error);
              retryRequest.onblocked = () => {
                blockedTimer = setTimeout(() => {
                  reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
                }, 5000);
              };
            };
            deleteRequest.onerror = () => reject(error);
          } else {
            reject(error);
          }
        };
        request.onblocked = () => {
          console.warn('NoesisDB: upgrade blocked by another connection, waiting...');
          blockedTimer = setTimeout(() => {
            reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
          }, 5000);
        };
      });
    }

    async function saveExtractedChapterToDB(chapterRecord) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readwrite');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.put(chapterRecord);
        request.onsuccess = () => resolve(chapterRecord);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteExtractedChapterFromDB(chapterId) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readwrite');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.delete(chapterId);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }

    async function deleteSnapshotFromDB(chapterId, snapshotId) {
      const record = await getExtractedChapterFromDB(chapterId);
      if (!record) return;
      record.snapshots = (record.snapshots || []).filter(s => s.snapshotId !== snapshotId);
      await saveExtractedChapterToDB(record);
    }

    async function getExtractedChapterFromDB(chapterId) {
      const db = await openNoesisDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(NOESIS_STORE, 'readonly');
        const store = tx.objectStore(NOESIS_STORE);
        const request = store.get(chapterId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (e) => reject(e);
          tx.onabort = () => { console.warn('Transaction aborted:', tx.error); reject(tx.error || new Error('Transaction was aborted')); };
      });
    }
    // --- END NOESIS DB ---

    const DB_NAME = 'EpubLibraryDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'books';

    // Init DB
    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        var blockedTimer = null;

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const db = event.target.result;
          db.onversionchange = () => { db.close(); console.warn('EpubLibraryDB: version changed externally, connection closed.'); };
          resolve(db);
        };

        request.onerror = (event) => {
          if (blockedTimer) clearTimeout(blockedTimer);
          const error = event.target.error;
          // Handle version error by deleting and recreating the database
          if (error.name === 'VersionError') {
            console.warn('EpubLibraryDB VersionError, deleting old database...');
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
            deleteRequest.onsuccess = () => {
              console.log('Old database deleted, retrying...');
              // Retry opening after deletion
              const retryRequest = indexedDB.open(DB_NAME, DB_VERSION);
              retryRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                  db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
              };
              retryRequest.onsuccess = (event) => {
                const db = event.target.result;
                db.onversionchange = () => { db.close(); };
                resolve(db);
              };
              retryRequest.onerror = (event) => reject(event.target.error);
              retryRequest.onblocked = () => {
                blockedTimer = setTimeout(() => {
                  reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
                }, 5000);
              };
            };
            deleteRequest.onerror = () => reject(error);
          } else {
            reject(error);
          }
        };

        request.onblocked = () => {
          console.warn('EpubLibraryDB: upgrade blocked by another connection, waiting...');
          blockedTimer = setTimeout(() => {
            reject(new Error('Database upgrade blocked by another connection. Close other tabs using the app and reload.'));
          }, 5000);
        };
      });
    }

