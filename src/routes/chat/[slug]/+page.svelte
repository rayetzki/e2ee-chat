<script lang="ts">
  import * as Form from "$lib/components/ui/form";
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";
  import { onMount, onDestroy } from 'svelte';
  import { Button } from "$lib/components/ui/button";
  import Textarea from "$lib/components/ui/textarea/textarea.svelte";

  const { data }: PageProps = $props();

  let messages: string[] = $state([]);
  let newMessage = $state('');
  let socket: WebSocket | null = null;

  onMount(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    socket.onopen = () => {
      console.log('WebSocket connected!');
      socket?.send('Hello from the client!');
    };

    socket.onmessage = async (event: MessageEvent<Blob>) => {
      const message = await event.data.text();
      messages.push(message);
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
      socket.send(newMessage);
      newMessage = '';
    }
  }
</script>

<p>Chat: {data.connection?.name}</p>

<form method="POST" use:enhance action="?/logout">
  <Form.Button>Logout</Form.Button>
</form>

<Textarea bind:value={newMessage} />

<Button onclick={sendMessage}>Send Message</Button>

<h2>Messages</h2>
<ul>
  {#each messages as msg}
    <li>{msg}</li>
  {/each}
</ul>