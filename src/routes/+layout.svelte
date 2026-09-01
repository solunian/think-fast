<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import { AppState, provideAppState } from '$lib/app-state.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';

	let { children } = $props();
	const app = provideAppState(new AppState());
	let practiceRoute = $derived(page.url.pathname.startsWith('/practice/'));

	onMount(() => {
		void app.initialize();
	});

	$effect(() => {
		const theme = app.settings?.theme ?? 'system';
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const applyTheme = () => {
			document.documentElement.classList.toggle(
				'dark',
				theme === 'dark' || (theme === 'system' && media.matches)
			);
		};
		applyTheme();
		media.addEventListener('change', applyTheme);
		return () => media.removeEventListener('change', applyTheme);
	});

	$effect(() => {
		if (!app.hasUnexportedChanges) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});
</script>

<svelte:head>
	<title>Think Fast — Local practice</title>
	<meta
		name="description"
		content="Focused mental arithmetic and visual pattern practice, saved privately in your browser."
	/>
</svelte:head>

<div class="min-h-screen">
	{#if app.status === 'ready' && !practiceRoute}
		<AppHeader {app} />
	{/if}

	{#if app.notice}
		<div
			class="fixed right-4 top-4 z-50 max-w-sm rounded-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold shadow-lg"
			role="status"
		>
			{app.notice}
		</div>
	{/if}

	{#if app.status === 'ready' && practiceRoute && app.hasUnexportedChanges}
		<div
			class="fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-sm border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs shadow-md"
			data-testid="practice-backup-indicator"
		>
			<span class="font-semibold text-[var(--warning)]">Backup recommended</span>
			<button
				class="font-bold text-[var(--accent)] underline underline-offset-4"
				onclick={() => void app.exportBackup()}>Export</button
			>
		</div>
	{/if}

	{@render children()}
</div>
