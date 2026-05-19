<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
  	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<Tooltip.Provider>
	{@render children()}
</Tooltip.Provider>
