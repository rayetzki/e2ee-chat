import { exportPublicKey, importPublicKey } from "./crypto";

const DB_NAME = 'e2ee-keys-db';
const STORE_NAME = 'keys';
const STORAGE_PREFIX = 'e2ee-keypair-';

type StoredPrivateKey = {
  chatId: string;
  privateKey: CryptoKey;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported'));
    }

    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'chatId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveKeyPair(chatId: string, keyPair: CryptoKeyPair): Promise<void> {
  try {
    const publicKey = await exportPublicKey(keyPair.publicKey);
    window.localStorage.setItem(`${STORAGE_PREFIX}${chatId}`, JSON.stringify({ publicKey }));
  } catch (err) {
    console.warn('Failed to export public key to localStorage', err);
  }

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ chatId, privateKey: keyPair.privateKey });
    await new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
    });
  } catch (err) {
    console.warn('IndexedDB save failed, private key not persisted as non-exportable', err);
  }
}

export async function loadKeyPair(chatId: string): Promise<CryptoKeyPair | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(chatId);
    const record = await new Promise<StoredPrivateKey>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (record?.privateKey) {
      const storedPublicKey = window.localStorage.getItem(`${STORAGE_PREFIX}${chatId}`);
      let publicKey: CryptoKey | null = null;
      
      if (storedPublicKey) {
        try {
          const parsed = JSON.parse(storedPublicKey);
          publicKey = await importPublicKey(parsed.publicKey);
        } catch (err) {
          console.warn('Failed to import public key from localStorage', err);
        }
      }

      if (!publicKey) return null;

      return { publicKey, privateKey: record.privateKey };
    }
  } catch (err) {
    console.warn('IndexedDB load failed', err);
  }

  return null;
}

export async function cleanup(chatId: string): Promise<void> {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${chatId}`);
  } catch (err) {
    console.warn('Failed to remove localStorage keypair', err);
  }

  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onblocked = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to delete IndexedDB', err);
  }
}