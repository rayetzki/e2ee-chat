export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function exportPublicKey(publicKey: CryptoKey) {
  const raw = await window.crypto.subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPublicKey(publicKeyBase64: string) {
  return await window.crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(publicKeyBase64),
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

export async function exportPrivateKey(privateKey: CryptoKey) {
  const raw = await window.crypto.subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToBase64(raw);
}

export async function deriveSharedKey(remotePublicKey: CryptoKey, privateKey: CryptoKey, info?: Uint8Array | string, salt?: Uint8Array | string | ArrayBuffer) {
  const sharedBits = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePublicKey },
    privateKey,
    256
  );

  const hkdfKey = await window.crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const infoBuf = typeof info === 'string' ? new TextEncoder().encode(info) : (info ?? new Uint8Array());

  const infoBuffer = infoBuf instanceof Uint8Array
    ? (infoBuf.buffer.slice(infoBuf.byteOffset, infoBuf.byteOffset + infoBuf.byteLength) as ArrayBuffer)
    : (infoBuf as ArrayBuffer);

  // Prepare salt: prefer provided salt, otherwise derive a non-empty salt from `info` or a default string
  let saltBuffer: ArrayBuffer;

  if (salt) {
    const saltBuf = typeof salt === 'string' ? new TextEncoder().encode(salt) : (salt instanceof Uint8Array ? salt : new Uint8Array(salt));
    saltBuffer = saltBuf.buffer.slice(saltBuf.byteOffset, saltBuf.byteOffset + saltBuf.byteLength) as ArrayBuffer;
  } else if (infoBuffer && infoBuffer.byteLength > 0) {
    saltBuffer = await window.crypto.subtle.digest('SHA-256', infoBuffer);
  } else {
    const defaultSalt = new TextEncoder().encode('e2ee-chat-default-salt');
    saltBuffer = await window.crypto.subtle.digest('SHA-256', defaultSalt);
  }

  const aesKey = await window.crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuffer, info: infoBuffer },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

export async function encryptText(sharedKey: CryptoKey, plainText: string) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

export async function decryptText(sharedKey: CryptoKey, ciphertextBase64: string, ivBase64: string) {
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);
  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export async function hashText(value: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(value);

  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}
