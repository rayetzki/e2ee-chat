<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";
  import {
    MessageStatus,
    type EncryptedMessagePayload,
    type NetworkPayload,
    type GetPublicKeyPayload,
    type TypingPayload,
    type UpdateMessageVisibilityStatusPayload,
  } from "../../../types";
  import { encryptText } from "$lib/crypto";
  import { cleanup as cleanupKeyStorage } from "$lib/key-storage";
  import { goto, invalidate } from "$app/navigation";
  import { cleanupChatMessages } from "$lib/message-storage";
  import { KeyPairManager } from "./keypair.state.svelte";
  import { MessageManager } from "./messages.state.svelte";
  import {
    ConnectionManager,
    MAX_HANDSHAKE_ATTEMPTS,
  } from "./сonnection.state.svelte";

  const { data }: PageProps = $props();

  let newMessage = $state("");
  let messageListWrapper: HTMLDivElement | null = null;
  let typingUserName = $state("");
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  const TYPING_INACTIVITY_MS = 3000;

  const keyPairManager = new KeyPairManager();
  const messageManager = new MessageManager();
  const connectionManager = new ConnectionManager(keyPairManager);

  const isMessageSendingDisabled = $derived(
    !keyPairManager.messageKey ||
    !connectionManager.isConnected ||
    connectionManager.isFailedConnection ||
    data.connectionCount < 2,
  );

  $effect(() => {
    if (!messageListWrapper || !connectionManager.socket) return;

    const messageIdsToUpdate = messageManager.checkMessagesVisibility(
      messageListWrapper,
      data.sessionId,
    );

    if (messageIdsToUpdate.length > 0) {
      const payload: UpdateMessageVisibilityStatusPayload = {
        type: "update-messages-visibility",
        ids: messageIdsToUpdate,
        chatId: data.chatId,
        status: MessageStatus.Read,
      };

      connectionManager.socket.send(JSON.stringify(payload));
    }
  });

  function scrollToBottom() {
    if (!messageListWrapper) return;

    messageListWrapper.scrollTo({
      top: messageListWrapper.scrollHeight,
      behavior: "smooth",
    });
  }

  async function handleMessageKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  }

  function clearTypingTimer() {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  }

  function sendTypingIndicator(isTyping: boolean) {
    if (
      !connectionManager.socket ||
      connectionManager.socket.readyState !== WebSocket.OPEN ||
      data.connectionCount < 2
    ) {
      return;
    }

    connectionManager.socket.send(
      JSON.stringify({
        type: "typing",
        senderId: data.sessionId,
        senderName: data.fromConnection.user_name,
        chatId: data.chatId,
        isTyping,
        timestamp: Date.now(),
      }),
    );
  }

  function resetTypingTimer() {
    clearTypingTimer();
    typingTimeout = setTimeout(() => {
      sendTypingIndicator(false);
      typingUserName = "";
      typingTimeout = null;
    }, TYPING_INACTIVITY_MS);
  }

  function handleTextareaInput() {
    if (!connectionManager.socket || connectionManager.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!newMessage.trim()) {
      sendTypingIndicator(false);
      clearTypingTimer();
      return;
    }

    sendTypingIndicator(true);
    resetTypingTimer();
  }

  async function handleSocketMessage(event: MessageEvent) {
    const raw =
      typeof event.data === "string" ? event.data : await event.data.text();

    let payload: NetworkPayload;
    try {
      payload = JSON.parse(raw) as NetworkPayload;
    } catch (error) {
      console.warn("Received non-JSON socket message", error);
      return;
    }

    switch (payload.type) {
      case "get-public-key": {
        const req = { ...payload } satisfies GetPublicKeyPayload;
        if (req.senderId !== data.sessionId && !keyPairManager.messageKey) {
          await connectionManager.sendPublicKey(data.chatId, data.sessionId);
        }
        break;
      }

      case "send-public-key": {
        if (payload.senderId === data.sessionId) {
          return;
        }

        await connectionManager.derivePublicKeys(
          payload,
          data.sessionId,
          data.salt,
        );

        await messageManager.loadInitialMessages(data.chatId, {
          messageKey: keyPairManager.messageKey,
          transportKey: keyPairManager.transportKey,
        });

        scrollToBottom();
        break;
      }

      case "message": {
        const { type, ...message } = payload;
        await messageManager.decryptSaveMessage(
          message,
          keyPairManager.messageKey,
        );
        scrollToBottom();
        break;
      }

      case "update-messages-visibility": {
        const { ids, status } = payload;
        messageManager.batchUpdateMessageStatus(ids, status);
        break;
      }

      case "user-connected": {
        await invalidate("chat:connections");
        break;
      }

      case "typing": {
        const { senderId, isTyping, senderName } = payload as TypingPayload;
        
        if (senderId === data.sessionId) {
          break;
        }

        typingUserName = isTyping ? senderName : "";
        break;
      }

      case "user-disconnected": {
        await invalidate("chat:connections");
        if (data.connectionCount < 2) {
          connectionManager.status = "Не в мережі";
          connectionManager.isFailedConnection = true;
        }
        break;
      }

      default: {
        throw new Error("Unknown payload type", payload);
      }
    }
  }

  onMount(() => {
    void (async () => {
      await connectionManager.connect(data.chatId, data.sessionId);

      if (connectionManager.socket) {
        connectionManager.socket.onmessage = handleSocketMessage;
      }
    })();

    return () => {
      connectionManager.cleanup();
      connectionManager.socket?.close();
      connectionManager.socket = null;
    };
  });

  async function sendMessage() {
    if (!keyPairManager.messageKey || data.connectionCount < 2) return;

    if (connectionManager.isConnected) {
      const encrypted = await encryptText(
        keyPairManager.messageKey,
        newMessage,
      );

      const payload: EncryptedMessagePayload = {
        type: "message",
        id: window.crypto.randomUUID(),
        senderId: data.sessionId,
        senderName: data.fromConnection.user_name,
        chatId: data.chatId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        status: MessageStatus.Pending,
        timestamp: Date.now(),
      };

      connectionManager.socket?.send(JSON.stringify(payload));
      newMessage = "";
      sendTypingIndicator(false);
      clearTypingTimer();
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
        connectionManager.socket?.send(
          JSON.stringify({
            type: "user-disconnected",
            chatId: data.chatId,
            id: data.sessionId,
          }),
        );
        await Promise.all([
          cleanupKeyStorage(data.chatId),
          cleanupChatMessages(data.chatId),
        ]);
        await goto("/auth");
      };
    }}
  >
    <Form.Button>Вийти</Form.Button>
  </form>
</nav>

<div class="flex flex-row justify-between align-center px-4 my-3">
  <div>
    <p class="mb-2 text-sm text-slate-500">{connectionManager.status}</p>
    {#if connectionManager.handshakeAttempts}
      <p class="mb-2 text-xs text-slate-400">
        Retry attempts: {connectionManager.handshakeAttempts}/{MAX_HANDSHAKE_ATTEMPTS}
      </p>
    {/if}
    {#if connectionManager.handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS && !keyPairManager.messageKey}
      <p class="mx-4 mb-2 text-xs text-rose-400">
        Не вдалося завершити ключовий обмін. Перезавантажте сторінку або
        спробуйте пізніше.
      </p>
    {/if}
  </div>
  <p class="text-sm text-slate-500">Онлайн: {data.connectionCount}</p>
</div>

<div
  class="overflow-y-auto px-4 pb-36 pt-2 min-h-[50vh]"
  bind:this={messageListWrapper}
>
  <ul
    class="flex flex-col gap-3"
    aria-atomic="false"
    aria-live="polite"
    aria-label="Chat messages"
    role="log"
    aria-relevant="additions text"
  >
    {#each messageManager.messages as msg}
      <li
        id={msg.id}
        class={[
          msg.senderId === data.fromConnection.id ? "self-end" : "self-start",
          "px-4",
        ]}
      >
        <div
          class={[
            "inline-block rounded-3xl shadow-sm p-3 min-w-[100px] text-right",
            msg.senderId === data.fromConnection.id
              ? "text-slate-900 ring-1 ring-slate-200 bg-sky-500/10"
              : "text-slate-100 bg-slate-900/90",
          ]}
        >
          <p class="whitespace-pre-wrap">{msg.message}</p>
          <div class="mt-1 space-y-1">
            <p class="text-xs text-slate-500">{msg.senderName}</p>
          </div>
        </div>
      </li>
    {/each}
  </ul>
  {#if typingUserName.length > 0}
    <p class="my-4 text-sm text-slate-600">
      {typingUserName} зараз пише...
    </p>
  {/if}
</div>

<section class="fixed bottom-0 right-0 left-0 px-3 pb-3 backdrop-blur">
  <Textarea
    class="min-h-[92px]"
    bind:value={newMessage}
    placeholder={connectionManager.isFailedConnection
      ? "З'єднання не встановлено"
      : !keyPairManager.messageKey
        ? "Очікування ключа..."
        : !connectionManager.isConnected
          ? "Установлюється з'єднання..."
          : "Повідомлення..."}
    disabled={isMessageSendingDisabled}
    oninput={handleTextareaInput}
    onkeydown={handleMessageKeydown}
  />
  <Button
    class="self-end mt-2"
    onclick={sendMessage}
    disabled={isMessageSendingDisabled}
  >
    Відправити
  </Button>
</section>
