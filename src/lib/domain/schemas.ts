import { flashBackupSchema } from '../flashcards/backup';
import z from 'zod';
import { CURRENT_SCHEMA_VERSION } from './types';

export const difficultySchema = z.enum(['easy', 'standard', 'hard']);
export const exerciseTypeSchema = z.enum(['mental-math', 'arrow-patterns']);
export const isoDateSchema = z.iso.datetime({ offset: true });

export const settingsSchema = z.object({
	schemaVersion: z.number().int().min(1).max(CURRENT_SCHEMA_VERSION),
	theme: z.enum(['light', 'dark', 'system']),
	soundEnabled: z.boolean(),
	reducedFeedbackAnimation: z.boolean(),
	defaultMentalMathDurationMs: z
		.number()
		.int()
		.min(10_000)
		.max(60 * 60 * 1000),
	defaultPatternDurationMs: z
		.number()
		.int()
		.min(10_000)
		.max(60 * 60 * 1000),
	mentalMathDifficulty: difficultySchema,
	patternDifficulty: difficultySchema,
	lastSelectedExercise: exerciseTypeSchema,
	backup: z.object({ lastExportAt: isoDateSchema.nullable() })
});

export const sessionSchema = z.object({
	id: z.string().min(1),
	exerciseType: exerciseTypeSchema,
	category: z.string().min(1),
	startedAt: isoDateSchema,
	endedAt: isoDateSchema,
	activeDurationMs: z.number().int().nonnegative(),
	configuredDurationMs: z.number().int().positive(),
	attemptedCount: z.number().int().nonnegative(),
	correctCount: z.number().int().nonnegative(),
	incorrectCount: z.number().int().nonnegative(),
	skippedCount: z.number().int().nonnegative(),
	averageResponseMs: z.number().nonnegative(),
	medianResponseMs: z.number().nonnegative(),
	completionReason: z.enum(['timer-expired', 'target-reached', 'user-ended', 'interrupted']),
	difficulty: difficultySchema,
	configuration: z.record(z.string(), z.unknown())
});

const attemptValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const attemptSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().min(1),
	exerciseType: exerciseTypeSchema,
	problemCategory: z.string().min(1),
	prompt: z.string().min(1),
	submittedAnswer: attemptValueSchema,
	expectedAnswer: attemptValueSchema,
	correct: z.boolean(),
	responseTimeMs: z.number().int().nonnegative(),
	difficulty: difficultySchema,
	timestamp: isoDateSchema,
	metadata: z.record(z.string(), z.unknown()).optional()
});

export const metadataSchema = z.object({
	schemaVersion: z.number().int().min(1).max(CURRENT_SCHEMA_VERSION),
	createdAt: isoDateSchema,
	lastModifiedAt: isoDateSchema,
	lastSuccessfulExportAt: isoDateSchema.nullable(),
	hasUnexportedChanges: z.boolean()
});

export const backupSchema = z.object({
	format: z.literal('think-fast-backup'),
	flashcards: flashBackupSchema.optional(),
	version: z.literal(1),
	exportedAt: isoDateSchema,
	appVersion: z.string().min(1),
	settings: settingsSchema,
	sessions: z.array(sessionSchema),
	attempts: z.array(attemptSchema),
	metadata: metadataSchema
});
