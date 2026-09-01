export type Clock = () => number;

export class ActiveTimer {
	private startedAt: number | null = null;
	private accumulatedMs = 0;
	private running = false;

	constructor(
		public readonly durationMs: number,
		private readonly now: Clock = () => performance.now()
	) {}

	start(): void {
		if (this.running || this.startedAt !== null) return;
		this.startedAt = this.now();
		this.running = true;
	}

	pause(): void {
		if (!this.running || this.startedAt === null) return;
		this.accumulatedMs += Math.max(0, this.now() - this.startedAt);
		this.startedAt = null;
		this.running = false;
	}

	resume(): void {
		if (this.running || this.accumulatedMs >= this.durationMs) return;
		this.startedAt = this.now();
		this.running = true;
	}

	stop(): number {
		this.pause();
		return this.elapsedMs();
	}

	elapsedMs(): number {
		const current = this.running && this.startedAt !== null ? this.now() - this.startedAt : 0;
		return Math.min(this.durationMs, Math.max(0, Math.round(this.accumulatedMs + current)));
	}

	remainingMs(): number {
		return Math.max(0, this.durationMs - this.elapsedMs());
	}

	isExpired(): boolean {
		return this.remainingMs() === 0;
	}

	isRunning(): boolean {
		return this.running;
	}
}

export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
