import { test, expect } from '@playwright/test';
test('create, edit, study and reload preserves card coverage', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.getByRole('link', { name: 'Flashcards' }).click();
	await page.getByRole('button', { name: '+ Create deck', exact: true }).click();
	await page.getByLabel('Name', { exact: true }).fill('Biology');
	await page.getByRole('button', { name: 'Create deck', exact: true }).click();
	await page.getByLabel('Front', { exact: true }).first().fill('Cell powerhouse?');
	await page.getByLabel('Back', { exact: true }).first().fill('Mitochondrion');
	await page.getByRole('button', { name: 'Save and add another' }).click();
	await expect(page.getByText('1 cards · Studied 0/1 (0%)')).toBeVisible();
	await page.getByLabel('Back', { exact: true }).last().fill('Mitochondrion — makes ATP');
	await page.getByRole('button', { name: 'Save card', exact: true }).click();
	await page.getByRole('link', { name: 'Flashcards', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
	await page.getByRole('button', { name: /Biology/ }).click();
	await expect(page.getByLabel('Back', { exact: true }).last()).toHaveValue(
		'Mitochondrion — makes ATP'
	);
	await page.getByRole('button', { name: 'Study', exact: true }).click();
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
	await page.reload();
	await page.getByRole('button', { name: /Biology/ }).click();
	await expect(page.getByText('1 cards · Studied 1/1 (100%)')).toBeVisible();
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
