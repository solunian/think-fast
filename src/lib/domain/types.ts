export const APP_VERSION = '1.0.0';
export const CURRENT_SCHEMA_VERSION = 2;

export type Theme = 'light' | 'dark' | 'system';
export type Difficulty = 'easy' | 'standard' | 'hard';
export type ExerciseType = 'mental-math' | 'arrow-patterns';
export type CompletionReason = 'timer-expired' | 'target-reached' | 'user-ended' | 'interrupted';
export type MentalMathCategory =
	| 'addition'
	| 'subtraction'
	| 'multiplication'
	| 'division'
	| 'percentages'
	| 'fractions'
	| 'mixed';

export interface BackupMetadata {
	lastExportAt: string | null;
}

export interface Settings {
	schemaVersion: number;
	theme: Theme;
	soundEnabled: boolean;
	reducedFeedbackAnimation: boolean;
	defaultMentalMathDurationMs: number;
	defaultPatternDurationMs: number;
	mentalMathDifficulty: Difficulty;
	patternDifficulty: Difficulty;
	lastSelectedExercise: ExerciseType;
	backup: BackupMetadata;
}

export interface SessionRecord {
	id: string;
	exerciseType: ExerciseType;
	category: string;
	startedAt: string;
	endedAt: string;
	activeDurationMs: number;
	configuredDurationMs: number;
	attemptedCount: number;
	correctCount: number;
	incorrectCount: number;
	skippedCount: number;
	averageResponseMs: number;
	medianResponseMs: number;
	completionReason: CompletionReason;
	difficulty: Difficulty;
	configuration: Record<string, unknown>;
}

export type AttemptValue = string | number | boolean | null;

export interface AttemptRecord {
	id: string;
	sessionId: string;
	exerciseType: ExerciseType;
	problemCategory: string;
	prompt: string;
	submittedAnswer: AttemptValue;
	expectedAnswer: AttemptValue;
	correct: boolean;
	responseTimeMs: number;
	difficulty: Difficulty;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

export interface AppMetadata {
	schemaVersion: number;
	createdAt: string;
	lastModifiedAt: string;
	lastSuccessfulExportAt: string | null;
	hasUnexportedChanges: boolean;
}

export interface AppSnapshot {
	settings: Settings;
	sessions: SessionRecord[];
	attempts: AttemptRecord[];
	metadata: AppMetadata;
}

export interface ThinkFastBackup {
	format: 'think-fast-backup';
	version: 1;
	exportedAt: string;
	appVersion: string;
	settings: Settings;
	sessions: SessionRecord[];
	attempts: AttemptRecord[];
	metadata: AppMetadata;
}

export interface BackupPreview {
	exportedAt: string;
	sessionCount: number;
	attemptCount: number;
	dateRange: { start: string; end: string } | null;
}

export interface MathQuestion {
	category: MentalMathCategory;
	prompt: string;
	expectedAnswer: number;
	signature: string;
	metadata: Record<string, unknown>;
}

export type ArrowDirection = 'up' | 'right' | 'down' | 'left';

export interface PatternTrial {
	left: ArrowDirection[];
	right: ArrowDirection[];
	size: 2 | 3 | 4;
	isSame: boolean;
	mismatchIndices: number[];
	signature: string;
}
