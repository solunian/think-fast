import { CURRENT_SCHEMA_VERSION, type AppMetadata, type Settings } from './types';

export function createDefaultSettings(): Settings {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		theme: 'system',
		soundEnabled: false,
		reducedFeedbackAnimation: false,
		defaultMentalMathDurationMs: 8 * 60 * 1000,
		defaultPatternDurationMs: 2 * 60 * 1000,
		mentalMathDifficulty: 'standard',
		patternDifficulty: 'standard',
		lastSelectedExercise: 'mental-math',
		backup: { lastExportAt: null }
	};
}

export function createDefaultMetadata(now = new Date().toISOString()): AppMetadata {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		createdAt: now,
		lastModifiedAt: now,
		lastSuccessfulExportAt: null,
		hasUnexportedChanges: false
	};
}
