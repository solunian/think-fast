<script lang="ts">
	interface Point {
		id: string;
		value: number;
		label: string;
	}
	let { points, suffix = '' }: { points: Point[]; suffix?: string } = $props();
	const width = 320;
	const height = 100;
	const padding = 8;
	let min = $derived(points.length ? Math.min(...points.map((point) => point.value)) : 0);
	let max = $derived(points.length ? Math.max(...points.map((point) => point.value)) : 0);
	let coordinates = $derived.by(() =>
		points.map((point, index) => {
			const x =
				points.length === 1
					? width / 2
					: padding + (index / (points.length - 1)) * (width - 2 * padding);
			const range = max - min || 1;
			const y = height - padding - ((point.value - min) / range) * (height - 2 * padding);
			return { ...point, x, y };
		})
	);
	let path = $derived(coordinates.map((point) => `${point.x},${point.y}`).join(' '));
</script>

{#if points.length === 0}
	<p class="text-sm text-[var(--muted)]">No trend yet.</p>
{:else}
	<div>
		<svg
			class="h-28 w-full overflow-visible"
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={`Trend from ${points[0].value}${suffix} to ${points[points.length - 1].value}${suffix}`}
		>
			<line
				x1={padding}
				x2={width - padding}
				y1={height - padding}
				y2={height - padding}
				stroke="var(--line)"
			/>
			{#if points.length > 1}<polyline
					points={path}
					fill="none"
					stroke="var(--accent)"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>{/if}
			{#each coordinates as point (point.id)}
				<circle
					cx={point.x}
					cy={point.y}
					r="4"
					fill="var(--surface)"
					stroke="var(--accent)"
					stroke-width="3"><title>{point.label}: {point.value}{suffix}</title></circle
				>
			{/each}
		</svg>
		<div class="mt-1 flex justify-between text-xs text-[var(--muted)]">
			<span>{points[0].label}</span><span>{points[points.length - 1].label}</span>
		</div>
	</div>
{/if}
