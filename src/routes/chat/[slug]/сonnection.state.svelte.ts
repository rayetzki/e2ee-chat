import type { GetPublicKeyPayload, SendPublicKeyPayload } from "../../../types";
import type { KeyPairManager } from "./keypair.state.svelte";

export const MAX_HANDSHAKE_ATTEMPTS = 5;
const HANDSHAKE_RETRY_MS = 2000;
const REKEY_INTERVAL_MS = 1000 * 60 * 10; // 10 minutes

export class ConnectionManager {
  socket = $state<WebSocket | null>(null);
  status = $state("Чекаю з'єднання і обміну ключами...");
  handshakeInterval: ReturnType<typeof setInterval> | null = null;
  handshakeAttempts = $state(0);
  rekeyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly keyPairManager: KeyPairManager) {}

  async connect(chatId: string, sessionId: string) {
    await this.keyPairManager.createKeyPair(chatId);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const websocketUrl = `${protocol}//${window.location.host}/ws`;

    this.socket = new WebSocket(websocketUrl);

    this.socket.onopen = async () => {
      console.log("WebSocket connected!");
      await this.start(chatId, sessionId);
    };

    this.socket.onclose = () => {
      console.log("WebSocket disconnected.");
      this.status = "Не в мережі";
      this.clearHandshakeTimers();
    };

    this.socket.onerror = (event) => {
      console.error("WebSocket error", event);
      this.status = "Помилка з'єднання";
    };
  }

  getPublicKey(chatId: string, sessionId: string) {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.keyPairManager.localPublicKey
    ) {
      return;
    }

    const payload: GetPublicKeyPayload = {
      type: "get-public-key",
      senderId: sessionId,
      chatId: chatId,
      publicKey: this.keyPairManager.localPublicKey,
      ephemeralPublicKey: this.keyPairManager.ephemeralPublicKey || undefined,
      timestamp: Date.now(),
    };

    this.socket.send(JSON.stringify(payload));

    if (!this.keyPairManager.messageKey) {
      this.status = "Запитано публічний ключ співбесідника...";
    }
  }

  async sendPublicKey(chatId: string, sessionId: string) {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.keyPairManager.localPublicKey
    ) {
      return;
    }

    const payload: SendPublicKeyPayload = {
      type: "send-public-key",
      senderId: sessionId,
      chatId: chatId,
      publicKey: this.keyPairManager.localPublicKey,
      ephemeralPublicKey: this.keyPairManager.ephemeralPublicKey || undefined,
      timestamp: Date.now(),
    };

    this.socket.send(JSON.stringify(payload));

    if (!this.keyPairManager.messageKey) {
      this.status = "Відправлений публічний ключ. Чекаю на співбесідника...";
    }
  }

  clearHandshakeTimers() {
    if (this.handshakeInterval) {
      clearInterval(this.handshakeInterval);
      this.handshakeInterval = null;
    }
    this.handshakeAttempts = 0;
  }

  async start(chatId: string, sessionId: string) {
    this.status = "З'єднання встановлено. Обмін ключами...";
    this.clearHandshakeTimers();

    await this.keyPairManager.generateEphemeralKey();
    await this.sendPublicKey(chatId, sessionId);

    this.handshakeInterval = setInterval(async () => {
      if (this.keyPairManager.messageKey) {
        this.clearHandshakeTimers();
        return;
      }

      this.handshakeAttempts += 1;
      if (this.handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS) {
        this.status =
          "Не вдалося встановити захищене з'єднання. Оновіть сторінку або спробуйте пізніше.";
        this.clearHandshakeTimers();
        return;
      }

      this.getPublicKey(chatId, sessionId);
    }, HANDSHAKE_RETRY_MS);

    if (this.rekeyTimer) clearInterval(this.rekeyTimer);
    this.rekeyTimer = setInterval(async () => {
      await this.keyPairManager.generateEphemeralKey();
      if (this.socket?.readyState === WebSocket.OPEN) {
        await this.sendPublicKey(chatId, sessionId);
      }
    }, REKEY_INTERVAL_MS);
  }

  async derivePublicKeys(
    payload: SendPublicKeyPayload,
    sessionId: string,
    salt?: string,
  ) {
    if (!this.keyPairManager.keyPair?.privateKey) {
      this.status = "Помилка обміну ключами";
      return;
    }

    try {
      await this.keyPairManager.derivePublicKeys({
        senderId: payload.senderId,
        sessionId,
        ephemeralPublicKey: payload.ephemeralPublicKey,
        chatId: payload.chatId,
        publicKey: payload.publicKey,
        ...(salt && { salt }),
      });
    } catch (err) {
      console.error(err);
      this.status = "Помилка обміну ключами";
      return;
    }

    this.status = "Обмін ключами успішний";
    this.clearHandshakeTimers();
  }
}
