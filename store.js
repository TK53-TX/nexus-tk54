const DB_NAME = 'nexus-studio';
let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('objects', { keyPath: 'id' });
      db.createObjectStore('attachments', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error('Close other NEXUS-TK54 tabs and try again.')); };
  });
  return opening;
}
async function transaction(store, mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Local save interrupted.'));
    tx.onerror = () => reject(tx.error);
  });
}
export const listObjects = () => transaction('objects', 'readonly', store => store.getAll());
export const saveObject = object => transaction('objects', 'readwrite', store => store.put(object));
export const removeObject = id => transaction('objects', 'readwrite', store => store.delete(id));
// Binary attachments have their own store, ready for the Constellation milestone.
export const saveAttachment = attachment => transaction('attachments', 'readwrite', store => store.put(attachment));
export const listAttachments = () => transaction('attachments', 'readonly', store => store.getAll());
export const readMeta = key => transaction('meta', 'readonly', store => store.get(key));
export const writeMeta = async (key, value) => { await transaction('meta', 'readwrite', store => store.put({key, value, updatedAt:Date.now()})); window.dispatchEvent(new Event('nexus:local-change')); };
export const listMeta = () => transaction('meta', 'readonly', store => store.getAll());
export const saveMeta = record => transaction('meta', 'readwrite', store => store.put(record));
export async function saveBundle(objects, attachments = []) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['objects', 'attachments'], 'readwrite');
    objects.forEach(object => tx.objectStore('objects').put(object));
    attachments.forEach(attachment => tx.objectStore('attachments').put(attachment));
    tx.oncomplete = () => { window.dispatchEvent(new Event('nexus:local-change')); resolve(); };
    tx.onabort = () => reject(tx.error || new Error('Save interrupted.'));
    tx.onerror = () => reject(tx.error);
  });
}
