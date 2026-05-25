<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount } from 'svelte';
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";
  import { MessageType, type EncryptedMessagePayload, type Message, type NetworkPayload, type SendPublicKeyPayload, type GetPublicKeyPayload } from "../../../types";
  import { decryptText, deriveSharedKey, encryptText, exportPublicKey, generateKeyPair, importPublicKey, base64ToArrayBuffer } from "$lib/crypto";
  import { loadKeyPairFromStorage, saveKeyPairToStorage, cleanupClientStorage } from '$lib/key-storage';
  import { goto } from "$app/navigation";
  
  const { data }: PageProps = $props();

  let messages = $state<Message[]>([]);
  let newMessage = $state('');
  let socket = $state<WebSocket | null>(null);
  let sharedKey = $state<CryptoKey | null>(null);
  let localPublicKeyBase64 = $state('');
  let status = $state("Чекаю з'єднання і обміну ключами...");
  let keyPair = $state<CryptoKeyPair | null>(null);
  let messageListEl: HTMLDivElement | null = null;
  let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  let handshakeInterval: ReturnType<typeof setInterval> | null = null;
  let handshakeAttempts = $state(0);
  const MAX_HANDSHAKE_ATTEMPTS = 5;
  let ephemeralKeyPair: CryptoKeyPair | null = null;
  let ephemeralPublicKeyBase64 = '';
  let rekeyTimer: ReturnType<typeof setInterval> | null = null;
  const REKEY_INTERVAL_MS = 1000 * 60 * 10; // 10 minutes

  function scrollToBottom() {
    if (!messageListEl) return;
    messageListEl.scrollTo({ top: messageListEl.scrollHeight, behavior: 'smooth' });
  }

  async function handleMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  }

  async function initHandshake() {
    const storedKeyPair = await loadKeyPairFromStorage(data.chatId);
    keyPair = storedKeyPair ?? await generateKeyPair();
    localPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
    
    if (!storedKeyPair) {
      await saveKeyPairToStorage(data.chatId, keyPair);
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
      senderName: data.fromConnection.user_name,
      chatId: data.chatId,
      publicKey: localPublicKeyBase64,
      ephemeralPublicKey: ephemeralPublicKeyBase64 || undefined,
      timestamp: Date.now(),
    }

    socket.send(JSON.stringify(payload));

    if (!sharedKey) {
      status = 'Запитано публічний ключ співбесідника...';
    }
  }

  function clearHandshakeTimers() {
    if (handshakeTimeout) {
      clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
    }
    if (handshakeInterval) {
      clearInterval(handshakeInterval);
      handshakeInterval = null;
    }
    handshakeAttempts = 0;
  }

  async function startHandshakeSequence() {
    clearHandshakeTimers();
    await generateEphemeralKey();

    setTimeout(async () => {
      await getPublicKey();
    }, 2000);

    handshakeTimeout = setTimeout(async () => {
      if (!sharedKey) {
        await sendPublicKey();

        handshakeInterval = setInterval(async () => {
          handshakeAttempts += 1;
          if (sharedKey || handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS) {
            if (!sharedKey) {
              status = "Не вдалося встановити захищене з'єднання. Оновіть сторінку або спробуйте пізніше.";
            }
            clearHandshakeTimers();
            return;
          }
          await getPublicKey();
        }, 2000);
      }
    }, 300);

    if (rekeyTimer) clearInterval(rekeyTimer);
    rekeyTimer = setInterval(async () => {
      await generateEphemeralKey();
      if (socket?.readyState === WebSocket.OPEN) {
        await sendPublicKey();
      }
    }, REKEY_INTERVAL_MS);
  }

  async function sendPublicKey() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !localPublicKeyBase64) {
      return;
    }

    const payload: SendPublicKeyPayload = {
      type: 'send-public-key',
      senderId: data.sessionId,
      senderName: data.fromConnection.user_name,
      chatId: data.chatId,
      publicKey: localPublicKeyBase64,
      ephemeralPublicKey: ephemeralPublicKeyBase64 || undefined,
      timestamp: Date.now(),
    };

    socket.send(JSON.stringify(payload));
  
    if (!sharedKey) {
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

    const remoteKeyBase64 = payload.ephemeralPublicKey ?? payload.publicKey;
    const remotePublicKey = await importPublicKey(remoteKeyBase64);
    const privateKeyToUse = payload.ephemeralPublicKey ? ephemeralKeyPair?.privateKey : keyPair.privateKey;
    if (!privateKeyToUse) {
      status = 'Помилка обміну ключами';
      return;
    }

    const ids = [data.sessionId, payload.senderId].sort().join(':');
    const info = `${data.chatId}:${ids}`;
    const saltBuf = data.salt ? base64ToArrayBuffer(data.salt) : undefined;
    sharedKey = await deriveSharedKey(remotePublicKey, privateKeyToUse, info, saltBuf);
    status = 'Обмін ключами успішний';

    clearHandshakeTimers();
    scrollToBottom();
  }

  async function handleEncryptedMessage(payload: EncryptedMessagePayload) {
    if (!sharedKey) {
      console.warn('Encrypted message received before key exchange.');
      return;
    }

    const message = await decryptText(
      sharedKey,
      payload.ciphertext,
      payload.iv
    );

    messages.push({
      senderId: payload.senderId,
      senderName: payload.senderName,
      chatId: payload.chatId,
      message,
      status: MessageType.Pending,
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
      const req = payload as GetPublicKeyPayload;
      if (req.senderId !== data.sessionId && !sharedKey) {
        await sendPublicKey();
      }
      return;
    }

    if (payload.type === 'send-public-key') {
      await handleRemotePublicKey(payload);
      return;
    }

    if (payload.type === 'message') {
      await handleEncryptedMessage(payload);
      return;
    }

    console.warn('Unknown payload type', payload);
  }

  onMount(() => {
    let ws: WebSocket | null = null;

    void (async () => {
      await initHandshake();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = ws;

      ws.onopen = async () => {
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
    if (!sharedKey) return;

    if (socket?.readyState === WebSocket.OPEN) {
      const encrypted = await encryptText(sharedKey, newMessage);

      const payload: EncryptedMessagePayload = {
        type: 'message',
        senderId: data.sessionId,
        senderName: data.fromConnection.user_name,
        chatId: data.chatId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
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
        await cleanupClientStorage(data.chatId);
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
{#if handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS && !sharedKey}
  <p class="mx-4 mb-2 text-xs text-rose-400">Не вдалося завершити ключовий обмін. Перезавантажте сторінку або спробуйте пізніше.</p>
{/if}

<div class="overflow-y-auto px-4 pb-36 pt-2 min-h-[50vh]" bind:this={messageListEl}>
  <ul class="flex flex-col gap-3">
    {#each messages as msg}
    {#if msg.senderId === data.fromConnection.id}
      <li class="self-end px-4">
        <div class="inline-block rounded-3xl bg-sky-500/10 px-4 py-3 text-right text-slate-900 shadow-sm ring-1 ring-slate-200">
          <p class="whitespace-pre-wrap">{msg.message}</p>
          <p class="mt-1 text-xs text-slate-500">{msg.senderName}</p>
        </div>
      </li>
    {:else}
      <li class="self-start px-4">
        <div class="inline-block rounded-3xl bg-slate-900/90 px-4 py-3 text-left text-slate-100 shadow-sm">
          <p class="whitespace-pre-wrap">{msg.message}</p>
          <p class="mt-1 text-xs text-slate-400">{msg.senderName}</p>
        </div>
      </li>
    {/if}
  {/each}
</ul>
</div>

<section class="fixed bottom-0 right-0 left-0 p-3 border-t border-slate-700 backdrop-blur">
  <Textarea
    class="min-h-[92px]"
    bind:value={newMessage}
    placeholder={socket?.readyState === WebSocket.OPEN ? (sharedKey ? 'Повідомлення' : 'Очікування ключа...') : "Установлюється з’єднання"}
    disabled={!sharedKey || socket?.readyState !== WebSocket.OPEN}
    onkeydown={handleMessageKeydown}
  />
  <Button
    class="self-end mt-2"
    onclick={sendMessage}
    disabled={!sharedKey || !newMessage.trim() || socket?.readyState !== WebSocket.OPEN}
  >
    Відправити
  </Button>
</section>