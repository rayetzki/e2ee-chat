
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
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey']
  );
}

export async function exportPublicKey(publicKey: CryptoKey) {
  const raw = await crypto.subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPublicKey(publicKeyBase64: string) {
  return crypto.subtle.importKey(
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
  const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToBase64(raw);
}

export async function importPrivateKey(privateKeyBase64: string) {
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(privateKeyBase64),
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey']
  );
}

export async function deriveSharedKey(remotePublicKey: CryptoKey, privateKey: CryptoKey) {
  return crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: remotePublicKey,
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(sharedKey: CryptoKey, plainText: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const ciphertext = await crypto.subtle.encrypt(
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
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
