<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount } from 'svelte';
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";
  import { MessageType, type EncryptedMessagePayload, type Message, type NetworkPayload, type SendPublicKeyPayload, type GetPublicKeyPayload } from "../../../types";
  import { decryptText, deriveSharedKey, encryptText, exportPublicKey, generateKeyPair, importPublicKey } from "$lib/crypto";
  import { loadKeyPairFromStorage, saveKeyPairToStorage } from '$lib/key-storage';
  
  const { data }: PageProps = $props();

  let messages = $state<Message[]>([]);
  let newMessage = $state('');
  let socket: WebSocket | null = null;
  let sharedKey = $state<CryptoKey | null>(null);
  let localPublicKeyBase64 = $state('');
  let status = $state("Чекаю з'єднання і обміну ключами...");
  let keyPair = $state<CryptoKeyPair | null>(null);
  let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  let handshakeInterval: ReturnType<typeof setInterval> | null = null;
  let handshakeAttempts = $state(0);
  const MAX_HANDSHAKE_ATTEMPTS = 5;

  async function initHandshake() {
    const storedKeyPair = await loadKeyPairFromStorage(data.chatId);
    keyPair = storedKeyPair ?? await generateKeyPair();
    localPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
    
    if (!storedKeyPair) {
      await saveKeyPairToStorage(data.chatId, keyPair);
    }
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
    await getPublicKey();

    handshakeTimeout = setTimeout(async () => {
      if (!sharedKey) {
        await sendPublicKey();

        handshakeInterval = setInterval(async () => {
          handshakeAttempts += 1;
          if (sharedKey || handshakeAttempts > MAX_HANDSHAKE_ATTEMPTS) {
            clearHandshakeTimers();
            return;
          }
          await getPublicKey();
        }, 2000);
      }
    }, 300);
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

    const remotePublicKey = await importPublicKey(payload.publicKey);
    sharedKey = await deriveSharedKey(remotePublicKey, keyPair.privateKey);
    status = 'Обмін ключами успішний';

    clearHandshakeTimers();
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
      // someone is requesting cached public keys for this chat - respond with our public key
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
    if (!sharedKey) {
      return;
    }

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
    }
  }
</script>

<nav class="flex w-full flex-row-reverse">
  <form method="POST" use:enhance action="?/logout" class="p-2">
    <Form.Button>Вийти</Form.Button>
  </form>
</nav>

<p class="mx-4 mb-2 text-sm text-slate-500">{status}</p>
{#if handshakeAttempts}
  <p class="mx-4 mb-2 text-xs text-slate-400">Retry attempts: {handshakeAttempts}/{MAX_HANDSHAKE_ATTEMPTS}</p>
{/if}

<ul class="flex flex-col">
  {#each messages as msg}
    {#if msg.senderId === data.fromConnection.id}
      <li class="self-end text-right px-4">
        <p>{msg.message}</p>
        <p>{msg.senderName}</p>
      </li>
    {:else}
      <li class="self-start text-left px-4">
        <p>{msg.message}</p>
        <p>{msg.senderName}</p>
      </li>
    {/if}
  {/each}
</ul>

<section class="absolute gap-2 flex-col flex bottom-0 right-0 left-0 p-2">
  <Textarea class="" bind:value={newMessage} placeholder={sharedKey ? 'Повідомлення' : "Установлюється з'єднання"} />
  <Button class="self-end" onclick={sendMessage} disabled={!sharedKey || !newMessage.trim()}>Відправити</Button>
</section>