<script lang="ts">
	import type { ArrowDirection } from '$lib/domain/types';

	interface Props {
		directions: ArrowDirection[];
		size: 2 | 3 | 4;
		label: string;
		compact?: boolean;
	}

	let { directions, size, label, compact = false }: Props = $props();
	const symbols: Record<ArrowDirection, string> = { up: '↑', right: '→', down: '↓', left: '←' };
	let spoken = $derived(directions.join(', '));
</script>

<div
	class={[
		'grid rounded-md border border-[var(--line)] bg-[var(--surface)]',
		compact ? 'gap-1 p-1.5' : 'gap-2 p-3 sm:gap-3 sm:p-4'
	]}
	style:grid-template-columns={`repeat(${size}, minmax(0, 1fr))`}
	role="img"
	aria-label={`${label}: ${spoken}`}
>
	{#each directions as direction, index (`${index}-${direction}`)}
		<span
			class={[
				'mono flex aspect-square items-center justify-center rounded-sm border border-[var(--line)] bg-[var(--surface-muted)] font-black leading-none',
				compact ? 'text-base' : 'text-3xl sm:text-4xl'
			]}
			aria-hidden="true">{symbols[direction]}</span
		>
	{/each}
</div>
