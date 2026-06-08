<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount } from 'svelte';
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";
  import { MessageStatus, type EncryptedMessagePayload, type Message, type NetworkPayload, type SendPublicKeyPayload, type GetPublicKeyPayload, type EncryptedMessage, type UpdateMessageVisibilityStatusPayload } from "../../../types";
  import { decryptText, deriveSharedKey, encryptText, exportPublicKey, generateKeyPair, importPublicKey, base64ToArrayBuffer } from "$lib/crypto";
  import { loadKeyPair, saveKeyPair, cleanup as cleanupKeyStorage } from '$lib/key-storage';
  import { goto } from "$app/navigation";
  import { cleanupChatMessages, loadMessages, saveMessage, updateMessageStatus } from "$lib/message-storage";
  
  const { data }: PageProps = $props();

  let messages = $state<Message[]>([]);

  let newMessage = $state('');
  let socket = $state<WebSocket | null>(null);
  let transportKey = $state<CryptoKey | null>(null);
  let messageKey = $state<CryptoKey | null>(null);
  let localPublicKeyBase64 = $state('');
  let status = $state("Чекаю з'єднання і обміну ключами...");
  let keyPair = $state<CryptoKeyPair | null>(null);
  let messageListEl: HTMLDivElement | null = null;
  let handshakeInterval: ReturnType<typeof setInterval> | null = null;
  let handshakeAttempts = $state(0);
  const MAX_HANDSHAKE_ATTEMPTS = 5;
  const HANDSHAKE_RETRY_MS = 2000;
  let ephemeralKeyPair: CryptoKeyPair | null = null;
  let ephemeralPublicKeyBase64 = '';
  let rekeyTimer: ReturnType<typeof setInterval> | null = null;
  const REKEY_INTERVAL_MS = 1000 * 60 * 10; // 10 minutes

  $effect(() => {
    if (!messageListEl || !socket) return;
 
    const messageListItems = Array.from(messageListEl.querySelectorAll('li'));
    const messageIdsToUpdate: string[] = [];
    
    for (const message of messages) {
      if (message.status !== MessageStatus.Read) {
        const messageListItem = messageListItems.find((item) => item.id === message.id);
        const { bottom } = messageListItem?.getBoundingClientRect()!;
        if (bottom <= messageListEl.clientHeight) {
          messageIdsToUpdate.push(message.id);
        }
      }
    }

    if (messageIdsToUpdate.length > 0) {
      const payload: UpdateMessageVisibilityStatusPayload = {
        type: 'update-messages-visibility',
        ids: messageIdsToUpdate,
        chatId: data.chatId,
        status: MessageStatus.Read
      };

      socket.send(JSON.stringify(payload));
    }
  });

  function scrollToBottom() {
    if (!messageListEl) return;
    messageListEl.scrollTo({ top: messageListEl.scrollHeight, behavior: 'smooth' });
  }

  function getMessageStatusText(status: MessageStatus) {
    switch (status) {
      case MessageStatus.Read:
        return 'Прочитано';
      case MessageStatus.Pending:
      default:
        return 'Не прочитано';
    }
  }

  async function handleMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  }

  async function initHandshake() {
    const storedKeyPair = await loadKeyPair(data.chatId);
    keyPair = storedKeyPair ?? await generateKeyPair();
    localPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
    
    if (!storedKeyPair) {
      await saveKeyPair(data.chatId, keyPair);
    }
  }

  async function generateEphemeralKey() {
    ephemeralKeyPair = await generateKeyPair();
    ephemeralPublicKeyBase64 = await exportPublicKey(ephemeralKeyPair.publicKey);
  }

  async function getPublicKey() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !localPublicKeyBase64) {
      return;
    }

    const payload: GetPublicKeyPayload = {
      type: 'get-public-key',
      senderId: data.sessionId,
      chatId: data.chatId,
      publicKey: localPublicKeyBase64,
      ephemeralPublicKey: ephemeralPublicKeyBase64 || undefined,
      timestamp: Date.now(),
    }

    socket.send(JSON.stringify(payload));

    if (!messageKey) {
      status = 'Запитано публічний ключ співбесідника...';
    }
  }

  function clearHandshakeTimers() {
    if (handshakeInterval) {
      clearInterval(handshakeInterval);
      handshakeInterval = null;
    }
    handshakeAttempts = 0;
  }

  async function startHandshakeSequence() {
    clearHandshakeTimers();
    await generateEphemeralKey();

    await sendPublicKey();

    handshakeInterval = setInterval(async () => {
      if (messageKey) {
        clearHandshakeTimers();
        return;
      }

      handshakeAttempts += 1;
      if (handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS) {
        status = "Не вдалося встановити захищене з'єднання. Оновіть сторінку або спробуйте пізніше.";
        clearHandshakeTimers();
        return;
      }

      await getPublicKey();
    }, HANDSHAKE_RETRY_MS);

    if (rekeyTimer) clearInterval(rekeyTimer);
    rekeyTimer = setInterval(async () => {
      await generateEphemeralKey();
      if (socket?.readyState === WebSocket.OPEN) {
        await sendPublicKey();
      }
    }, REKEY_INTERVAL_MS);
  }

  async function loadInitialMessages(): Promise<Message[]> {
    try {
      const encryptedMessages = await loadMessages(data.chatId);

      const decryptedMessagesPromises = encryptedMessages.map(
        async (message) => {
          if (!messageKey && !transportKey) return null;

          let decryptedMessage: string | null = null;

          if (messageKey) {
            try {
              decryptedMessage = await decryptText(messageKey, message.ciphertext, message.iv);
            } catch (err) {
              decryptedMessage = null;
            }
          }

          if (!decryptedMessage && transportKey) {
            try {
              decryptedMessage = await decryptText(transportKey, message.ciphertext, message.iv);
              // migrated message: re-encrypt with the persistent messageKey if available
              if (decryptedMessage && messageKey) {
                try {
                  const reEnc = await encryptText(messageKey, decryptedMessage);
                  await saveMessage({ ...message, ciphertext: reEnc.ciphertext, iv: reEnc.iv });
                } catch (e) {
                  console.warn('Failed to migrate stored message', message.id, e);
                }
              }
            } catch (err) {
              decryptedMessage = null;
            }
          }

          if (!decryptedMessage) {
            console.warn('Failed to decrypt stored message', message.id);
            return null;
          }

          return {
            id: message.id,
            senderId: message.senderId,
            senderName: message.senderName,
            chatId: message.chatId,
            message: decryptedMessage,
            status: message.status,
            timestamp: message.timestamp,
          };
        }
      );

      const decryptedMessages = await Promise.all(decryptedMessagesPromises);
      return decryptedMessages.filter((message) => message !== null);
    } catch (error) {
      console.error(`Could not load initial messages`, error);
      return [];
    }
  }

  async function sendPublicKey() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !localPublicKeyBase64) {
      return;
    }

    const payload: SendPublicKeyPayload = {
      type: 'send-public-key',
      senderId: data.sessionId,
      chatId: data.chatId,
      publicKey: localPublicKeyBase64,
      ephemeralPublicKey: ephemeralPublicKeyBase64 || undefined,
      timestamp: Date.now(),
    };

    socket.send(JSON.stringify(payload));
  
    if (!messageKey) {
      status = 'Відправлений публічний ключ. Чекаю на співбесідника...';
    }
  }

  async function handleRemotePublicKey(payload: SendPublicKeyPayload) {
    if (payload.senderId === data.sessionId) {
      return;
    }

    if (!keyPair?.privateKey) {
      status = 'Помилка обміну ключами';
      return;
    }

    // derive two keys:
    // - transportKey: using ephemeral keys when available (for handshake/transport)
    // - messageKey: persistent key derived from long-term public keys (used for encrypting/storing messages)

    // import long-term public key
    const remoteLongPublicKey = await importPublicKey(payload.publicKey);

    // derive persistent message key using long-term keys
    if (!keyPair?.privateKey) {
      status = 'Помилка обміну ключами';
      return;
    }

    const ids = [data.sessionId, payload.senderId].sort().join(':');
    const info = `${data.chatId}:${ids}`;
    const saltBuf = data.salt ? base64ToArrayBuffer(data.salt) : undefined;

    try {
      messageKey = await deriveSharedKey(remoteLongPublicKey, keyPair.privateKey, info, saltBuf);
    } catch (err) {
      console.warn('Failed to derive persistent message key', err);
      status = 'Помилка обміну ключами';
      return;
    }

    if (payload.ephemeralPublicKey) {
      const remoteEphemeral = await importPublicKey(payload.ephemeralPublicKey);
      const privateKeyToUse = ephemeralKeyPair?.privateKey ?? keyPair.privateKey;
      try {
        transportKey = await deriveSharedKey(remoteEphemeral, privateKeyToUse, info, saltBuf);
      } catch (err) {
        console.warn('Failed to derive transport key', err);
      }
    } else {
      transportKey = messageKey;
    }

    messages = await loadInitialMessages();
    status = 'Обмін ключами успішний';

    clearHandshakeTimers();
    scrollToBottom();
  }

  async function handleEncryptedMessage(payload: EncryptedMessage) {
    if (!messageKey) {
      console.warn('Encrypted message received before key exchange.');
      return;
    }

    await saveMessage(payload);

    let messageText = '';
    try {
      messageText = await decryptText(messageKey, payload.ciphertext, payload.iv);
    } catch (err) {
      console.warn('Failed to decrypt incoming message', payload.id, err);
      messageText = '[Unable to decrypt]';
    }

    messages.push({
      id: payload.id,
      senderId: payload.senderId,
      senderName: payload.senderName,
      chatId: payload.chatId,
      message: messageText,
      status: payload.status,
      timestamp: payload.timestamp,
    });

    scrollToBottom();
  }

  async function handleSocketMessage(event: MessageEvent) {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();

    let payload: NetworkPayload;
    try {
      payload = JSON.parse(raw) as NetworkPayload;
    } catch (error) {
      console.warn('Received non-JSON socket message', error);
      return;
    }

    if (payload.type === 'get-public-key') {
      const req = { ...payload } satisfies GetPublicKeyPayload;
      if (req.senderId !== data.sessionId && !messageKey) {
        await sendPublicKey();
      }
      return;
    }

    if (payload.type === 'send-public-key') {
      await handleRemotePublicKey(payload);
      return;
    }

    if (payload.type === 'message') {
      const { type, ...message } = payload;
      await handleEncryptedMessage(message);
      return;
    }

    if (payload.type === 'update-messages-visibility') {
      const { ids, status } = payload;
      for (const message of messages) {
        if (ids.includes(message.id)) {
          message.status = status;
          updateMessageStatus(message.id, status);
        }
      }
      return;
    }

    console.warn('Unknown payload type', payload);
  }

  onMount(() => {
    let ws: WebSocket | null = null;

    void (async () => {
      await initHandshake();
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const websocketUrl = `${protocol}//${window.location.host}/ws`;

      ws = new WebSocket(websocketUrl);
      
      ws.onopen = async () => {
        socket = ws;
        console.log('WebSocket connected!');
        status = "З'єднання встановлено. Обмін ключами...";
        await startHandshakeSequence();
      };

      ws.onmessage = handleSocketMessage;
      
      ws.onclose = () => {
        console.log('WebSocket disconnected.');
        status = "Не в мережі";
        clearHandshakeTimers();
      };

      ws.onerror = (event) => {
        console.error('WebSocket error', event);
        status = "Помилка з'єднання";
      };
    })();

    return () => ws?.close();
  });

  async function sendMessage() {
    if (!messageKey) return;

    if (socket?.readyState === WebSocket.OPEN) {
      const encrypted = await encryptText(messageKey, newMessage);

      const payload: EncryptedMessagePayload = {
        type: 'message',
        id: window.crypto.randomUUID(),
        senderId: data.sessionId,
        senderName: data.fromConnection.user_name,
        chatId: data.chatId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        status: MessageStatus.Pending,
        timestamp: Date.now(),
      };

      socket.send(JSON.stringify(payload));
      newMessage = '';
      scrollToBottom();
    }
  }
</script>

<nav class="flex w-full flex-row-reverse">
  <form
    action="?/logout"
    class="p-2"
    method="POST"
    use:enhance={() => {
      return async () => {
        await Promise.all([
          cleanupKeyStorage(data.chatId),
          cleanupChatMessages(data.chatId)
        ]);
        await goto('/auth');
      }
    }}
  >
    <Form.Button>Вийти</Form.Button>
  </form>
</nav>

<p class="mx-4 mb-2 text-sm text-slate-500">{status}</p>
{#if handshakeAttempts}
  <p class="mx-4 mb-2 text-xs text-slate-400">Retry attempts: {handshakeAttempts}/{MAX_HANDSHAKE_ATTEMPTS}</p>
{/if}
{#if handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS && !messageKey}
  <p class="mx-4 mb-2 text-xs text-rose-400">Не вдалося завершити ключовий обмін. Перезавантажте сторінку або спробуйте пізніше.</p>
{/if}

<div class="overflow-y-auto px-4 pb-36 pt-2 min-h-[50vh]" bind:this={messageListEl}>
  <ul class="flex flex-col gap-3">
    {#each messages as msg}
      <li id={msg.id} class={[msg.senderId === data.fromConnection.id ? "self-end" : "self-start", "px-4"]}>
        <div class={[
          "inline-block rounded-3xl shadow-sm p-3 min-w-[100px] text-right",
          msg.senderId === data.fromConnection.id
            ? "text-slate-900 ring-1 ring-slate-200 bg-sky-500/10"
            : "text-slate-100 bg-slate-900/90"
          ]
        }>
          <p class="whitespace-pre-wrap">{msg.message}</p>
          <div class="mt-1 space-y-1">
            <p class="text-xs text-slate-500">{msg.senderName}</p>
            <p class={[
              "text-[8px] uppercase tracking-wide",
              msg.senderId === data.fromConnection.id ? "text-slate-400" : "text-slate-500"
            ]}>
              {getMessageStatusText(msg.status)}
            </p>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</div>

<section class="fixed bottom-0 right-0 left-0 px-3 pb-3 backdrop-blur">
  <Textarea
    class="min-h-[92px]"
    bind:value={newMessage}
    placeholder={socket?.readyState === WebSocket.OPEN ? (messageKey ? 'Повідомлення' : 'Очікування ключа...') : "Установлюється з’єднання"}
    disabled={!messageKey || socket?.readyState !== WebSocket.OPEN}
    onkeydown={handleMessageKeydown}
  />
  <Button
    class="self-end mt-2"
    onclick={sendMessage}
    disabled={!messageKey || !newMessage.trim() || socket?.readyState !== WebSocket.OPEN}
  >
    Відправити
  </Button>
</section>