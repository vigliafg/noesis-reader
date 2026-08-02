/* ════════════════════════════════════════════════
   GLOBALS
════════════════════════════════════════════════ */
var _collection  = [];
var _bookName    = '';
var _chapterName = '';
var _chapterId   = '';
var _mode        = 'standalone'; // 'chapter' | 'standalone'
var _toastShown  = false;     // one-time session toast for chapter mode
var _bookId      = '';        // current book id (for IndexedDB persistence)

/* ════════════════════════════════════════════════
   IndexedDB helpers — unified with reader
   DB: EpubLibraryDB  |  Store: books  |  Key: book id
════════════════════════════════════════════════ */
var _COL_DB_NAME    = 'EpubLibraryDB';
var _COL_DB_VERSION = 1;
var _COL_STORE_NAME = 'books';

function _openColDB() {
  return new Promise(function(resolve, reject) {
    var request = indexedDB.open(_COL_DB_NAME, _COL_DB_VERSION);
    var blockedTimer = null;
    request.onupgradeneeded = function(event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains(_COL_STORE_NAME)) {
        db.createObjectStore(_COL_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = function(event) {
      if (blockedTimer) clearTimeout(blockedTimer);
      var db = event.target.result;
      db.onversionchange = function() { db.close(); console.warn('EpubLibraryDB: version changed externally, connection closed.'); };
      resolve(db);
    };
    request.onerror = function(event) {
      if (blockedTimer) clearTimeout(blockedTimer);
      var error = event.target.error;
      if (error.name === 'VersionError') {
        console.warn('EpubLibraryDB VersionError, deleting old database...');
        var deleteRequest = indexedDB.deleteDatabase(_COL_DB_NAME);
        deleteRequest.onsuccess = function() {
          var retryRequest = indexedDB.open(_COL_DB_NAME, _COL_DB_VERSION);
          retryRequest.onupgradeneeded = function(event) {
            var db = event.target.result;
            if (!db.objectStoreNames.contains(_COL_STORE_NAME)) {
              db.createObjectStore(_COL_STORE_NAME, { keyPath: 'id' });
            }
          };
          retryRequest.onsuccess = function(event) { resolve(event.target.result); };
          retryRequest.onerror = function(event) { reject(event.target.error); };
        };
        deleteRequest.onerror = function() { reject(error); };
      } else {
        reject(error);
      }
    };
  });
}

function _saveCollectionToDB() {
  if (!_bookId) return;
  _openColDB().then(function(db) {
    var tx = db.transaction(_COL_STORE_NAME, 'readonly');
    var store = tx.objectStore(_COL_STORE_NAME);
    var req = store.get(_bookId);
    req.onsuccess = function() {
      var bookData = req.result;
      if (!bookData) { db.close(); return; }
      bookData.collections = _collection.slice();
      var tx2 = db.transaction(_COL_STORE_NAME, 'readwrite');
      var store2 = tx2.objectStore(_COL_STORE_NAME);
      var putReq = store2.put(bookData);
      putReq.onsuccess = function() { db.close(); };
      putReq.onerror = function() { db.close(); console.warn('Save collection failed:', putReq.error); };
    };
    req.onerror = function() { db.close(); console.warn('Read book for collection save failed:', req.error); };
  }).catch(function(e) { console.warn('_saveCollectionToDB error:', e); });
}

function _loadCollectionFromDB(bookId) {
  if (!bookId) return Promise.resolve();
  return _openColDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(_COL_STORE_NAME, 'readonly');
      var store = tx.objectStore(_COL_STORE_NAME);
      var req = store.get(bookId);
      req.onsuccess = function() {
        var bookData = req.result;
        _collection = (bookData && bookData.collections) ? bookData.collections : [];
        _updateCounter();
        db.close();
        resolve();
      };
      req.onerror = function() { db.close(); console.warn('Load collection failed:', req.error); _collection = []; _updateCounter(); resolve(); };
    });
  }).catch(function(e) { console.warn('_loadCollectionFromDB error:', e); _collection = []; _updateCounter(); });
}

/* ════════════════════════════════════════════════
   Load reader collections from shared IndexedDB
   (bridge: opens reader's EpubLibraryDB/books)
════════════════════════════════════════════════ */
function _loadReaderCollections(bookId) {
  if (!bookId) return;
  _loadCollectionFromDB(bookId).then(function() {
    if (_collection.length > 0) {
      snToast('Loaded ' + _collection.length + ' collection items from library');
    }
  });
}


