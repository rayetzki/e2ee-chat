import type { EncryptedMessage } from "../types";
import type { MessageStatus } from "../types";

const DB_NAME = 'e2ee-messages-db';
const STORE_NAME = 'messages';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported'));
    }

    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        try {
          db.deleteObjectStore(STORE_NAME);
        } catch (e) {}
      }

      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('byChatId', 'chatId', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMessage(message: EncryptedMessage): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(message);
    await new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
    });
  } catch (err) {
    console.warn('IndexedDB failed to save message', err);
  }
}

export async function updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    const message = await new Promise<EncryptedMessage | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!message) return;

    store.put({ ...message, status });

    await new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
    });
  } catch (err) {
    console.warn('IndexedDB failed to update message status', err);
  }
}

export async function loadMessages(chatId: string): Promise<EncryptedMessage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    let req: IDBRequest;
    try {
      const index = store.index('byChatId');
      req = index.getAll(chatId);
    } catch (e) {
      req = store.getAll();
    }

    const messages = await new Promise<EncryptedMessage[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!Array.isArray(messages)) return [];
    return Array.isArray(messages) ? messages.filter((m) => m.chatId === chatId) : [];
  } catch (err) {
    console.warn('IndexedDB load failed', err);
  }

  return [];
}

export async function cleanupChatMessages(chatId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    try {
      const index = store.index('byChatId');
      const reqKeys = index.getAllKeys(chatId);
      const keys = await new Promise<any[]>((resolve, reject) => {
        reqKeys.onsuccess = () => resolve(reqKeys.result);
        reqKeys.onerror = () => reject(reqKeys.error);
      });

      await Promise.all(keys.map((k) => new Promise((res, rej) => {
        const r = store.delete(k);
        r.onsuccess = () => res(true);
        r.onerror = () => rej(r.error);
      })));
    } catch (e) {
      const allReq = store.getAll();
      const all = await new Promise<any[]>((resolve, reject) => {
        allReq.onsuccess = () => resolve(allReq.result);
        allReq.onerror = () => reject(allReq.error);
      });

      const toDelete = all.filter((m) => m.chatId === chatId).map((m) => m.id);
      await Promise.all(toDelete.map((id) => new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res(true);
        r.onerror = () => rej(r.error);
      })));
    }
  } catch (error) {
    console.error(`Failed to delete chat messages`, error);
  }
}