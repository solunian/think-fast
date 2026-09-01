type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export function playFeedbackTone(enabled: boolean, correct: boolean): void {
	if (!enabled) return;
	const AudioContextConstructor =
		window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
	if (!AudioContextConstructor) return;

	try {
		const context = new AudioContextConstructor();
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = 'sine';
		oscillator.frequency.value = correct ? 660 : 220;
		gain.gain.setValueAtTime(0.0001, context.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start();
		oscillator.stop(context.currentTime + 0.1);
		oscillator.addEventListener('ended', () => void context.close(), { once: true });
	} catch {
		// Audio feedback is optional and must never interrupt practice.
	}
}
