import {
  base64ToArrayBuffer,
  deriveSharedKey,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "$lib/crypto";
import { loadKeyPair, saveKeyPair } from "$lib/key-storage";

interface DerivePublicKeyPayload {
  sessionId: string;
  senderId: string;
  chatId: string;
  publicKey: string;
  ephemeralPublicKey?: string | undefined;
  salt?: string;
}

export class KeyPairManager {
  transportKey = $state<CryptoKey | null>(null);
  messageKey = $state<CryptoKey | null>(null);
  localPublicKey = $state("");

  keyPair = $state<CryptoKeyPair | null>(null);

  ephemeralKeyPair: CryptoKeyPair | null = null;
  ephemeralPublicKey = "";

  async createKeyPair(chatId: string) {
    const storedKeyPair = await loadKeyPair(chatId);
    this.keyPair = storedKeyPair ?? (await generateKeyPair());
    this.localPublicKey = await exportPublicKey(this.keyPair.publicKey);

    if (!storedKeyPair) {
      await saveKeyPair(chatId, this.keyPair);
    }
  }

  async generateEphemeralKey() {
    this.ephemeralKeyPair = await generateKeyPair();
    this.ephemeralPublicKey = await exportPublicKey(
      this.ephemeralKeyPair.publicKey,
    );
  }

  async derivePublicKeys(options: DerivePublicKeyPayload) {
    if (!this.keyPair) return;
    // derive two keys:
    // - transportKey: using ephemeral keys when available (for handshake/transport)
    // - messageKey: persistent key derived from long-term public keys (used for encrypting/storing messages)

    // import long-term public key
    const remoteLongPublicKey = await importPublicKey(options.publicKey);

    const ids = [options.sessionId, options.senderId].sort().join(":");
    const info = `${options.chatId}:${ids}`;
    const saltBuf = options.salt
      ? base64ToArrayBuffer(options.salt)
      : undefined;

    try {
      this.messageKey = await deriveSharedKey(
        remoteLongPublicKey,
        this.keyPair.privateKey,
        info,
        saltBuf,
      );
    } catch (err) {
      throw new Error("Failed to derive persistent message key", {
        cause: err,
      });
    }

    if (options.ephemeralPublicKey) {
      const remoteEphemeral = await importPublicKey(options.ephemeralPublicKey);
      const privateKeyToUse =
        this.ephemeralKeyPair?.privateKey ?? this.keyPair.privateKey;

      try {
        this.transportKey = await deriveSharedKey(
          remoteEphemeral,
          privateKeyToUse,
          info,
          saltBuf,
        );
      } catch (err) {
        console.warn("Failed to derive transport key", err);
      }
    } else {
      this.transportKey = this.messageKey;
    }
  }
}
