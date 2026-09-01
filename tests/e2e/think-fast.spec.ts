import { expect, test, type Page } from '@playwright/test';

const timestamp = '2026-08-31T18:30:00.000Z';

function backupFixture() {
	return {
		format: 'think-fast-backup',
		version: 1,
		exportedAt: timestamp,
		appVersion: '1.0.0',
		settings: {
			schemaVersion: 2,
			theme: 'system',
			soundEnabled: false,
			reducedFeedbackAnimation: false,
			defaultMentalMathDurationMs: 480000,
			defaultPatternDurationMs: 120000,
			mentalMathDifficulty: 'standard',
			patternDifficulty: 'standard',
			lastSelectedExercise: 'mental-math',
			backup: { lastExportAt: null }
		},
		sessions: [
			{
				id: 'restored-session',
				exerciseType: 'mental-math',
				category: 'mixed',
				startedAt: timestamp,
				endedAt: '2026-08-31T18:31:00.000Z',
				activeDurationMs: 60000,
				configuredDurationMs: 60000,
				attemptedCount: 1,
				correctCount: 1,
				incorrectCount: 0,
				skippedCount: 0,
				averageResponseMs: 800,
				medianResponseMs: 800,
				completionReason: 'timer-expired',
				difficulty: 'standard',
				configuration: {}
			}
		],
		attempts: [
			{
				id: 'restored-attempt',
				sessionId: 'restored-session',
				exerciseType: 'mental-math',
				problemCategory: 'addition',
				prompt: '20 + 22',
				submittedAnswer: 42,
				expectedAnswer: 42,
				correct: true,
				responseTimeMs: 800,
				difficulty: 'standard',
				timestamp: timestamp
			}
		],
		metadata: {
			schemaVersion: 2,
			createdAt: timestamp,
			lastModifiedAt: timestamp,
			lastSuccessfulExportAt: null,
			hasUnexportedChanges: false
		}
	};
}

async function startFresh(page: Page) {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await expect(
		page.getByRole('heading', { name: /Build speed without losing precision/ })
	).toBeVisible();
}

async function countStore(page: Page, storeName: string): Promise<number> {
	return page.evaluate(async (name) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('think-fast');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		if (!database.objectStoreNames.contains(name)) {
			database.close();
			return 0;
		}
		const count = await new Promise<number>((resolve, reject) => {
			const request = database.transaction(name).objectStore(name).count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		database.close();
		return count;
	}, storeName);
}

test('first visit offers import or start fresh', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Import progress file' })).toBeVisible();
	await expect(page.getByTestId('start-fresh')).toBeVisible();
});

test('start fresh reaches the dashboard', async ({ page }) => {
	await startFresh(page);
	await expect(page.getByText('Fresh local workspace created.')).toBeVisible();
});

test('submitting a mental-math answer creates local progress', async ({ page }) => {
	await startFresh(page);
	await page.goto('/practice/math');
	await page.getByTestId('start-math').click();
	const answer = page.getByTestId('math-answer');
	await expect(answer).toBeVisible({ timeout: 6000 });
	await answer.fill('0');
	await answer.press('Enter');
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
});

test('reloading restores progress automatically', async ({ page }) => {
	await startFresh(page);
	await page.goto('/practice/math');
	await page.getByTestId('start-math').click();
	const answer = page.getByTestId('math-answer');
	await expect(answer).toBeVisible({ timeout: 6000 });
	await answer.fill('0');
	await answer.press('Enter');
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
	page.once('dialog', (dialog) => dialog.accept());
	await page.reload();
	await expect(page.getByText('Local progress loaded.')).toBeVisible();
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
});

test('export creates a valid JSON download', async ({ page }) => {
	await startFresh(page);
	await page.goto('/settings');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export backup', exact: true }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^think-fast-backup-.*\.json$/);
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	expect(parsed).toMatchObject({ format: 'think-fast-backup', version: 1 });
});

test('import preview restores a valid backup', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('backup-file-input').setInputFiles({
		name: 'backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(backupFixture()))
	});
	await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible();
	await page.getByRole('button', { name: 'Merge with local data' }).click();
	await expect(page.getByText('Backup merged with local progress.')).toBeVisible();
	await expect(page.getByText('Mental Math').last()).toBeVisible();
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
});

test('invalid import leaves existing data unchanged', async ({ page }) => {
	await startFresh(page);
	await page.goto('/settings');
	await page.getByTestId('backup-file-input').setInputFiles({
		name: 'wrong.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{"unrelated":true}')
	});
	await expect(page.getByRole('alert')).toContainText('not a Think Fast backup');
	expect(await countStore(page, 'settings')).toBe(1);
	expect(await countStore(page, 'sessions')).toBe(0);
});

test('mental-math supports keyboard submission', async ({ page }) => {
	await startFresh(page);
	await page.goto('/practice/math');
	await page.getByTestId('start-math').click();
	await expect(page.getByTestId('math-answer')).toBeFocused({ timeout: 6000 });
	await page.keyboard.type('1');
	await page.keyboard.press('Enter');
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
});

test('arrow patterns support D and S keyboard controls', async ({ page }) => {
	await startFresh(page);
	await page.goto('/practice/patterns');
	await page.getByTestId('start-patterns').click();
	await expect(page.getByRole('heading', { name: 'Same or different?' })).toBeVisible({
		timeout: 6000
	});
	await page.keyboard.press('d');
	await expect.poll(() => countStore(page, 'attempts')).toBe(1);
	await page.keyboard.press('s');
	await expect.poll(() => countStore(page, 'attempts')).toBe(2);
});

test('stale backup state enables the native leave warning', async ({ page }) => {
	await startFresh(page);
	await page.goto('/practice/math');
	await page.getByTestId('start-math').click();
	await expect(page.getByTestId('practice-backup-indicator')).toBeVisible();
	const dialogPromise = page.waitForEvent('dialog');
	const reloadPromise = page.reload().catch((error: Error) => {
		if (!error.message.includes('ERR_ABORTED')) throw error;
		return null;
	});
	const dialog = await dialogPromise;
	expect(dialog.type()).toBe('beforeunload');
	await dialog.accept();
	await reloadPromise;
});

test('reset requires confirmation and removes local data', async ({ page }) => {
	await startFresh(page);
	await page.goto('/settings');
	await page.getByTestId('open-reset').click();
	await expect(page.getByTestId('confirm-reset')).toBeDisabled();
	await page.getByLabel(/I understand that all Think Fast data/).check();
	await page.getByTestId('confirm-reset').click();
	await expect(page.getByTestId('start-fresh')).toBeVisible();
	expect(await countStore(page, 'settings')).toBe(0);
});
