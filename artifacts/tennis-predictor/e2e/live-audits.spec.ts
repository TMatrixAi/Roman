import { expect, test } from '@playwright/test';

const BASE = (process.env.BASE_PATH ?? '/').replace(/\/$/, '');

function url(path: string) {
  return BASE + path || '/';
}

async function gotoFast(path: string, page: import('@playwright/test').Page) {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' });
}

function launchAuditSummary(overrides?: Record<string, unknown>) {
  return {
    overallStatus: 'Ready With Warnings',
    passCount: 8,
    warningCount: 2,
    failCount: 1,
    criticalCount: 1,
    highCount: 1,
    findings: [
      {
        category: 'backend',
        checkName: 'Backend startup',
        status: 'Pass',
        severity: 'Low',
        evidence: 'API process reachable',
        expectedResult: 'Healthy',
        actualResult: 'Healthy',
        recommendedAction: 'None',
        relatedService: 'api',
        timestamp: new Date().toISOString(),
      },
      {
        category: 'database',
        checkName: 'Database connectivity',
        status: 'Warning',
        severity: 'Medium',
        evidence: 'High latency',
        expectedResult: 'Latency < 250ms',
        actualResult: 'Latency 410ms',
        recommendedAction: 'Investigate query plan',
        relatedService: 'postgres',
        timestamp: new Date().toISOString(),
      },
      {
        category: 'frontend',
        checkName: 'Frontend availability',
        status: 'Unknown',
        severity: 'Unknown',
        evidence: 'Not reported',
        expectedResult: 'Healthy',
        actualResult: 'Unknown',
        recommendedAction: 'Review telemetry',
        relatedService: 'web-app',
        timestamp: new Date().toISOString(),
      },
    ],
    history: [
      {
        id: 'audit-1',
        completedAt: new Date().toISOString(),
        overallStatus: 'Ready',
        passCount: 12,
        warningCount: 0,
        failCount: 0,
        criticalCount: 0,
        highCount: 0,
        reportPath: '/tmp/report-1.json',
      },
    ],
    ...overrides,
  };
}

test.describe('Live Audits admin/developer UX', () => {
  test('normal users do not see Live Audits navigation and unauthorized route shows restricted state', async ({ page }) => {
    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false }),
      });
    });

    await gotoFast('/', page);
    await expect(page.getByRole('link', { name: /live audits/i })).toHaveCount(0);

    await gotoFast('/launch-audit', page);
    await expect(page.getByText(/access restricted/i)).toBeVisible({ timeout: 10_000 });
  });

  test('developer sees Live Audits under admin/developer and can access route', async ({ page }) => {
    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'developer' }),
      });
    });

    await page.route('**/api/launch-audit/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(launchAuditSummary()),
      });
    });

    await gotoFast('/launch-audit', page);
    await expect(page.getByRole('heading', { name: /live audits/i })).toBeVisible();
    await expect(page.getByText(/developer \/ admin/i)).toBeVisible();
  });

  test('refresh and run full launch audit use real endpoints and show running state', async ({ page }) => {
    let summaryCalls = 0;

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'admin' }),
      });
    });

    await page.route('**/api/launch-audit/summary', async (route) => {
      summaryCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          launchAuditSummary({
            overallStatus: summaryCalls === 1 ? 'Ready With Warnings' : 'Ready',
          }),
        ),
      });
    });

    await page.route('**/api/launch-audit/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(launchAuditSummary({ status: 'running', overallStatus: 'Running' })),
      });
    });

    await gotoFast('/launch-audit', page);

    const refreshButton = page.getByRole('button', { name: /^refresh$/i });
    await refreshButton.click();
    expect(summaryCalls).toBeGreaterThanOrEqual(2);

    const runButton = page.getByRole('button', { name: /run full launch audit/i });
    await runButton.click();
    await expect(page.getByText(/launch audit started/i)).toBeVisible({ timeout: 10_000 });
  });

  test('unknown status remains Unknown and secret fields are not rendered', async ({ page }) => {
    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'owner' }),
      });
    });

    await page.route('**/api/launch-audit/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          launchAuditSummary({
            overallStatus: 'Audit Incomplete',
            findings: [
              {
                category: 'provider',
                checkName: 'Provider key validation',
                status: 'Unknown',
                severity: 'Unknown',
                evidence: 'Credential validation unavailable',
                expectedResult: 'Present',
                actualResult: 'Unknown',
                recommendedAction: 'Check env vars',
                relatedService: 'provider-api',
                timestamp: new Date().toISOString(),
                apiKey: 'SHOULD_NOT_APPEAR',
                authorizationHeader: 'Bearer secret',
              },
            ],
          }),
        ),
      });
    });

    await gotoFast('/launch-audit', page);
    await expect(page.getByText(/unknown/i).first()).toBeVisible();
    await expect(page.getByText('SHOULD_NOT_APPEAR')).toHaveCount(0);
    await expect(page.getByText(/Bearer secret/i)).toHaveCount(0);
  });

  test('owner-only destructive controls are hidden for developer and visible for owner', async ({ page }) => {
    await page.route('**/api/launch-audit/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(launchAuditSummary()),
      });
    });

    await page.route('**/api/live-audits/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not configured' }),
      });
    });

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'developer' }),
      });
    });

    await gotoFast('/launch-audit', page);
    await page.getByRole('tab', { name: /rollback & recovery/i }).click();
    await expect(page.getByRole('button', { name: /roll back to previous stable version/i })).toHaveCount(0);

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'owner' }),
      });
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /rollback & recovery/i }).click();
    await expect(page.getByRole('button', { name: /roll back to previous stable version/i })).toBeVisible();
  });

  test('mobile layout keeps section navigation visible and avoids horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'admin' }),
      });
    });

    await page.route('**/api/launch-audit/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(launchAuditSummary()),
      });
    });

    await gotoFast('/launch-audit', page);
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test('api failure states show clear user-safe error', async ({ page }) => {
    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'admin' }),
      });
    });

    await page.route('**/api/launch-audit/summary', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Launch audit failed' }),
      });
    });

    await gotoFast('/launch-audit', page);
    await expect(page.getByText(/overview load failed/i)).toBeVisible();
  });
});
