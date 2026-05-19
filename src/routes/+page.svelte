<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";

    onMount(() => {
        if (!window.sessionStorage.getItem('name')) {
            goto('/auth');
        } else {
            goto('/chat');
        }
    });
</script>