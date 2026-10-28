<script lang="ts">
	import { page } from '$app/state';
	import FlashcardsPage from '#lib/flashcards/FlashcardsPage.svelte';
</script>

{#key page.url.href}
	<FlashcardsPage deckId={page.params.deck_id} searchParams={page.url.searchParams} study />
{/key}
