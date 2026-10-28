import { test, expect } from '@playwright/test';
test('create, edit, study and reload preserves card coverage', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.getByRole('link', { name: 'Flashcards' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Biology');
	await page.getByRole('button', { name: 'Create deck', exact: true }).click();
	await page.getByLabel('Front', { exact: true }).fill('Cell powerhouse?');
	await page.getByLabel('Back', { exact: true }).fill('Mitochondrion');
	await page.getByRole('button', { name: 'Save and add another' }).click();
	await expect(page.getByText('1 cards · Studied 0/1 (0%)')).toBeVisible();
	await page.getByRole('button', { name: 'Study', exact: true }).click();
	await page.getByRole('button', { name: 'Reveal answer' }).click();
	await expect(page.getByText('Mitochondrion', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Next card' }).click();
	await expect(page.getByText('1 cards · Studied 1/1 (100%)')).toBeVisible();
	page.on('dialog', (d) => d.accept());
	await page.reload();
	await page.getByRole('button', { name: 'Biology' }).click();
	await expect(page.getByText('1 cards · Studied 1/1 (100%)')).toBeVisible();
});
test('CSV preview allows cancellation without changing library', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('start-fresh').click();
	await page.goto('/flashcards');
	await page.getByLabel('Import file').setInputFiles({
		name: 'sample.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('front,back\n"hello, 世界","line 1\nline 2"')
	});
	await expect(page.getByText('1 valid cards', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByText('No decks found.', { exact: false })).toBeVisible();
});
