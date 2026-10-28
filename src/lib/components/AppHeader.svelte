<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { AppState } from '#lib/app-state.svelte.js';

	let { app }: { app: AppState } = $props();
	let exporting = $state(false);

	async function exportBackup() {
		exporting = true;
		try {
			await app.exportBackup();
		} finally {
			exporting = false;
		}
	}
</script>

<header class="border-b border-[var(--line)] bg-[var(--surface)]">
	<div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
		<a
			href={resolve('/')}
			class="flex items-baseline gap-2 no-underline"
			aria-label="Think Fast dashboard"
		>
			<span class="text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">Think Fast</span>
			<span class="hidden text-xs font-medium tracking-normal text-[var(--muted)] sm:inline"
				>Local training</span
			>
		</a>

		<nav aria-label="Primary" class="flex items-center gap-1 text-sm font-semibold">
			<a
				href={resolve('/')}
				aria-current={page.url.pathname === '/' ? 'page' : undefined}
				class="rounded-sm px-3 py-2 text-[var(--muted)] no-underline hover:bg-[var(--surface-muted)] aria-[current=page]:text-[var(--ink)]"
				>Dashboard</a
			>
			<a href={resolve('/flashcards')} class="rounded-sm px-3 py-2 no-underline">Flashcards</a>
			<a
				href={resolve('history')}
				aria-current={page.url.pathname === '/history' ? 'page' : undefined}
				class="hidden rounded-sm px-3 py-2 text-[var(--muted)] no-underline hover:bg-[var(--surface-muted)] aria-[current=page]:text-[var(--ink)] sm:block"
				>History</a
			>
			<a
				href={resolve('settings')}
				aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
				class="rounded-sm px-3 py-2 text-[var(--muted)] no-underline hover:bg-[var(--surface-muted)] aria-[current=page]:text-[var(--ink)]"
				>Settings</a
			>
		</nav>
	</div>

	{#if app.hasUnexportedChanges}
		<div class="border-t border-[var(--line)] bg-[var(--warning-soft)] text-[var(--warning)]">
			<div
				class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs font-semibold sm:px-6"
			>
				<span><span aria-hidden="true">●</span> Backup recommended</span>
				<button class="underline underline-offset-4" onclick={exportBackup} disabled={exporting}>
					{exporting ? 'Preparing…' : 'Export backup'}
				</button>
			</div>
		</div>
	{/if}
</header>
