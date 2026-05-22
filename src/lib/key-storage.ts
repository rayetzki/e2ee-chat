import { exportPrivateKey, exportPublicKey, importPrivateKey, importPublicKey } from "./crypto";

const STORAGE_PREFIX = 'e2ee-keypair-';

export async function saveKeyPairToStorage(chatId: string, keyPair: CryptoKeyPair) {
  const publicKey = await exportPublicKey(keyPair.publicKey);
  const privateKey = await exportPrivateKey(keyPair.privateKey);
  localStorage.setItem(
    `${STORAGE_PREFIX}${chatId}`,
    JSON.stringify({ publicKey, privateKey })
  );
}

export async function loadKeyPairFromStorage(chatId: string) {
  const stored = localStorage.getItem(`${STORAGE_PREFIX}${chatId}`);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    const publicKey = await importPublicKey(parsed.publicKey);
    const privateKey = await importPrivateKey(parsed.privateKey);
    return { publicKey, privateKey } as CryptoKeyPair;
  } catch (error) {
    console.warn('Failed to load stored key pair', error);
    localStorage.removeItem(`${STORAGE_PREFIX}${chatId}`);
    return null;
  }
}

export function removeKeyPairFromStorage(chatId: string) {
  localStorage.removeItem(`${STORAGE_PREFIX}${chatId}`);
}
