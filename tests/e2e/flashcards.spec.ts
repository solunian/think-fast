import { test, expect } from '@playwright/test';
test('create, edit, study and reload preserves card coverage', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.getByRole('link', { name: 'Flashcards', exact: true }).click();
	await page.getByRole('button', { name: '+ Create deck', exact: true }).click();
	await page.getByLabel('Name', { exact: true }).fill('Biology');
	await page.getByRole('button', { name: 'Create deck', exact: true }).click();
	await expect(page).toHaveURL(/\/flashcards\/[^/?]+$/);
	const deckUrl = new URL(page.url()).pathname;
	await page.getByLabel('Front', { exact: true }).first().fill('Cell powerhouse?');
	await page.getByLabel('Back', { exact: true }).first().fill('Mitochondrion');
	await page.getByRole('button', { name: 'Save and add another' }).click();
	await expect(
		page.getByRole('region', { name: 'Deck overview' }).getByText('0 / 1')
	).toBeVisible();
	await expect(page.getByText('Deck studio')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit details' }).click();
	await page.getByLabel('Deck name', { exact: true }).fill('Biology notes');
	await page
		.getByLabel('Description (optional)', { exact: true })
		.fill('Cells and their functions');
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Biology notes', exact: true })).toBeVisible();
	await expect(page.getByText('Cells and their functions', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Deck name', { exact: true })).toHaveCount(0);
	await page.getByLabel('Back', { exact: true }).last().fill('Mitochondrion — makes ATP');
	await page.getByRole('button', { name: 'Save card', exact: true }).click();
	await page.getByRole('link', { name: 'Flashcards', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
	await page.getByRole('link', { name: /Biology/ }).click();
	await expect(page.getByLabel('Back', { exact: true }).last()).toHaveValue(
		'Mitochondrion — makes ATP'
	);
	const filters = page.getByRole('group', { name: 'Cards to study' });
	await filters.getByRole('checkbox', { name: /^New/ }).uncheck();
	await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeDisabled();
	await filters.getByRole('checkbox', { name: /^New/ }).check();
	await page.getByRole('button', { name: 'Study', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${deckUrl}/study\\?`));
	await page.goBack();
	await expect(page.getByRole('region', { name: 'Deck overview' })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole('button', { name: 'Reveal answer', exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Reveal answer', exact: true })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 667 });
	const stage = page.locator('.practice-stage');
	const bounds = await stage.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
	await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
	await page.keyboard.press('Space');
	await expect(page.getByText('Cell powerhouse?', { exact: true })).toBeVisible();
	await page.keyboard.press('Space');
	await expect(page.getByText('Mitochondrion — makes ATP', { exact: true })).toBeVisible();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
	await page.keyboard.press('ArrowLeft');
	await expect(page.getByText('Cell powerhouse?', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Next card' }).click();
	await expect(page.getByText('1 cards · Studied 1/1 (100%)')).toBeVisible();
	page.on('dialog', (d) => d.accept());
	await page.getByRole('link', { name: 'End practice', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${deckUrl}\\?`));
	await page.reload();
	await expect(
		page.getByRole('region', { name: 'Deck overview' }).getByText('1 / 1')
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Biology notes', exact: true })).toBeVisible();
});
test('CSV preview allows cancellation without changing library', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.goto('/flashcards');
	await page.getByRole('button', { name: '+ Create deck', exact: true }).click();
	await page.getByRole('button', { name: 'Import a deck', exact: true }).click();
	await page.getByLabel('Import file').setInputFiles({
		name: 'sample.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('front,back\n"hello, 世界","line 1\nline 2"')
	});
	await expect(page.getByText('1 valid cards', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(
		page.getByText('Your next learning habit starts here', { exact: false })
	).toBeVisible();
});

test('FSRS includes matching cards even before their next scheduled review', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.getByRole('link', { name: 'Flashcards', exact: true }).click();
	await page.getByRole('button', { name: '+ Create deck', exact: true }).click();
	await page.getByLabel('Name', { exact: true }).fill('Early review');
	await page.getByRole('button', { name: 'Create deck', exact: true }).click();
	await page.getByLabel('Front', { exact: true }).first().fill('Question');
	await page.getByLabel('Back', { exact: true }).first().fill('Answer');
	await page.getByRole('button', { name: 'Save and add another' }).click();
	await page.getByRole('combobox', { name: 'Study mode', exact: true }).selectOption('scheduled');
	await page.getByRole('button', { name: 'Study', exact: true }).click();
	await page
		.locator('.practice-controls')
		.getByRole('button', { name: 'Reveal answer', exact: true })
		.click();
	await page.getByRole('button', { name: /Easy.*I knew it right away/ }).click();
	await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
	await page.getByRole('link', { name: 'End practice', exact: true }).click();
	await expect(
		page.getByText('Review all matching cards. Your ratings update their schedules.', {
			exact: true
		})
	).toBeVisible();
	await page.getByRole('button', { name: 'Study', exact: true }).click();
	await expect(page.getByText('1 remaining', { exact: true })).toBeVisible();
	await expect(
		page.locator('.practice-controls').getByRole('button', { name: 'Reveal answer', exact: true })
	).toBeVisible();
});

test('missing deck routes provide a way back to the library', async ({ page }) => {
	await page.goto('/flashcards/missing-deck');
	await expect(page.getByRole('alert')).toContainText('Deck not found on this device.');
	await page.getByRole('link', { name: '← All decks', exact: true }).click();
	await expect(page).toHaveURL('/flashcards');
	await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
	await page.goto('/flashcards/missing-deck/study');
	await expect(page.getByRole('alert')).toContainText('Deck not found on this device.');
});
