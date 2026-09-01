import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	retries: 0,
	use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'bun run build && bun run preview --host 127.0.0.1',
		port: 4173,
		reuseExistingServer: true,
		timeout: 120_000
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
