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
    type UpdateMessageVisibilityStatusPayload,
  } from "../../../types";
  import { encryptText } from "$lib/crypto";
  import { cleanup as cleanupKeyStorage } from "$lib/key-storage";
  import { goto } from "$app/navigation";
  import { cleanupChatMessages } from "$lib/message-storage";
  import { KeyPairManager } from "./keypair.state.svelte";
  import { MessageManager } from "./messages.state.svelte";
  import {
    ConnectionManager,
    MAX_HANDSHAKE_ATTEMPTS,
  } from "./сonnection.state.svelte";

  const { data }: PageProps = $props();

  let newMessage = $state("");
  let messageListEl: HTMLDivElement | null = null;

  const keyPairManager = new KeyPairManager();
  const messageManager = new MessageManager();
  const connectionManager = new ConnectionManager(keyPairManager);

  $effect(() => {
    if (!messageListEl || !connectionManager.socket) return;

    const messageListItems = Array.from(messageListEl.querySelectorAll("li"));
    const messageIdsToUpdate: string[] = [];

    for (const message of messageManager.messages) {
      if (
        message.senderId !== data.sessionId &&
        message.status !== MessageStatus.Read
      ) {
        const messageListItem = messageListItems.find(
          (item) => item.id === message.id,
        );

        const { bottom } = messageListItem?.getBoundingClientRect()!;

        if (bottom <= messageListEl.clientHeight) {
          messageIdsToUpdate.push(message.id);
        }
      }
    }

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
    if (!messageListEl) return;

    messageListEl.scrollTo({
      top: messageListEl.scrollHeight,
      behavior: "smooth",
    });
  }

  async function handleMessageKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
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

    return () => connectionManager.socket?.close();
  });

  async function sendMessage() {
    if (!keyPairManager.messageKey) return;

    if (connectionManager.socket?.readyState === WebSocket.OPEN) {
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

      connectionManager.socket.send(JSON.stringify(payload));
      newMessage = "";
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
          cleanupChatMessages(data.chatId),
        ]);
        await goto("/auth");
      };
    }}
  >
    <Form.Button>Вийти</Form.Button>
  </form>
</nav>

<p class="mx-4 mb-2 text-sm text-slate-500">{connectionManager.status}</p>
{#if connectionManager.handshakeAttempts}
  <p class="mx-4 mb-2 text-xs text-slate-400">
    Retry attempts: {connectionManager.handshakeAttempts}/{MAX_HANDSHAKE_ATTEMPTS}
  </p>
{/if}
{#if connectionManager.handshakeAttempts >= MAX_HANDSHAKE_ATTEMPTS && !keyPairManager.messageKey}
  <p class="mx-4 mb-2 text-xs text-rose-400">
    Не вдалося завершити ключовий обмін. Перезавантажте сторінку або спробуйте
    пізніше.
  </p>
{/if}

<div
  class="overflow-y-auto px-4 pb-36 pt-2 min-h-[50vh]"
  bind:this={messageListEl}
>
  <ul class="flex flex-col gap-3">
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
            <p
              class={[
                "text-[8px] uppercase tracking-wide",
                msg.senderId === data.fromConnection.id
                  ? "text-slate-400"
                  : "text-slate-500",
              ]}
            >
              {msg.status === MessageStatus.Pending
                ? "Не прочитано"
                : "Прочитано"}
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
    placeholder={connectionManager.socket?.readyState === WebSocket.OPEN
      ? keyPairManager.messageKey
        ? "Повідомлення"
        : "Очікування ключа..."
      : "Установлюється з’єднання"}
    disabled={!keyPairManager.messageKey ||
      connectionManager.socket?.readyState !== WebSocket.OPEN}
    onkeydown={handleMessageKeydown}
  />
  <Button
    class="self-end mt-2"
    onclick={sendMessage}
    disabled={!keyPairManager.messageKey ||
      !newMessage.trim() ||
      connectionManager.socket?.readyState !== WebSocket.OPEN}
  >
    Відправити
  </Button>
</section>
