<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount, onDestroy } from 'svelte';
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";
  import { MessageType, type Message } from "../../../types";

  const { data }: PageProps = $props();

  let messages = $state<Message[]>([]);
  let newMessage = $state('');
  let socket: WebSocket | null = null;

  onMount(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    socket.onopen = () => {
      console.log('WebSocket connected!');
    };

    socket.onmessage = async (event: MessageEvent<Blob>) => {
      const data = JSON.parse(await event.data.text());
      messages.push(data);
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected.');
    };

    return () => socket?.close();
  });

  onDestroy(() => {
    if (socket) {
      socket.close();
    }
  });

  function sendMessage() {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        message: newMessage,
        senderId: data.sessionId,
        senderName: data.fromConnection.user_name,
        timestamp: Date.now(),
        chatId: data.chatId,
        status: MessageType.Pending,
      }));
      newMessage = '';
    }
  }
</script>


<nav class="flex w-full flex-row-reverse">
  <form method="POST" use:enhance action="?/logout" class="p-2">
    <Form.Button>Вийти</Form.Button>
  </form>
</nav>


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
  <Textarea class="" bind:value={newMessage} />
  <Button class="self-end" onclick={sendMessage}>Send Message</Button>
</section>