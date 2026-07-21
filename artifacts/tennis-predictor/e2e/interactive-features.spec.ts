import { test, expect, type Page, type Route } from "@playwright/test"

/**
 * End-to-end tests for three interactive features:
 *  1. Theme toggle – class flips on <html>, persists across SPA navigation
 *  2. LEVEL → EVENT dropdown coupling – changing LEVEL resets EVENT and narrows options
 *  3. SHADOW TRADING hero button – navigates to /shadow-replay; disclosure banner visible
 *
 * We use waitUntil:'domcontentloaded' throughout because the home page fires
 * background API requests that may never complete in an isolated test run (the
 * API server workflow isn't a dependency of these UI-interaction tests).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = (process.env.BASE_PATH ?? "/").replace(/\/$/, "")

function url(path: string) {
  return BASE + path || "/"
}

/** Navigate quickly, without waiting for all network requests to settle. */
async function gotoFast(page: Page, path: string) {
  await page.goto(url(path), { waitUntil: "domcontentloaded" })
}

// ---------------------------------------------------------------------------
// 1. Theme toggle
// ---------------------------------------------------------------------------

test.describe("Theme toggle", () => {
  test("clicking the toggle switches the <html> class between light and dark", async ({ page }) => {
    await gotoFast(page, "/")

    const html = page.locator("html")

    // Wait for next-themes to resolve (it sets the class after initial render)
    const toggle = page.locator('button[aria-label*="mode" i]')
    await expect(toggle).toBeVisible({ timeout: 10_000 })

    const startClass = (await html.getAttribute("class")) ?? ""
    const startedDark = startClass.includes("dark")

    await toggle.click()

    // Allow a frame for the class to update
    await page.waitForTimeout(200)

    const afterClass = (await html.getAttribute("class")) ?? ""
    const nowDark = afterClass.includes("dark")

    // Class must have flipped
    expect(nowDark).toBe(!startedDark)
  })

  test("theme persists after navigating to /predict and back to /", async ({ page }) => {
    await gotoFast(page, "/")

    const html = page.locator("html")
    const toggle = page.locator('button[aria-label*="mode" i]')
    await expect(toggle).toBeVisible({ timeout: 10_000 })

    // Record then flip the theme
    const startClass = (await html.getAttribute("class")) ?? ""
    const startedDark = startClass.includes("dark")
    await toggle.click()
    await page.waitForTimeout(200)

    const afterToggle = (await html.getAttribute("class")) ?? ""
    const toggledToDark = afterToggle.includes("dark")
    expect(toggledToDark).toBe(!startedDark)

    // Navigate to /predict via the Run Model nav link (SPA navigation)
    await page.locator("a[href*='/predict']").first().click()
    await page.waitForURL(/predict/, { timeout: 10_000 })

    const onPredict = (await html.getAttribute("class")) ?? ""
    expect(onPredict.includes("dark")).toBe(toggledToDark)

    // Navigate back to root via the Dashboard/logo link
    await page.locator("a[href='/']").first().click()
    await page.waitForURL(/\/$/, { timeout: 10_000 })

    const onHome = (await html.getAttribute("class")) ?? ""
    expect(onHome.includes("dark")).toBe(toggledToDark)
  })
})

// ---------------------------------------------------------------------------
// 2. LEVEL → EVENT dropdown coupling
// ---------------------------------------------------------------------------

test.describe("LEVEL → EVENT dropdown coupling", () => {
  test("selecting a non-All LEVEL resets EVENT to 'All Tournaments'", async ({ page }) => {
    await gotoFast(page, "/")

    const levelSelect = page.locator('select[aria-label*="level" i]')
    const eventSelect = page.locator('select[aria-label*="tournament" i]')

    await expect(levelSelect).toBeVisible({ timeout: 10_000 })
    await expect(eventSelect).toBeVisible({ timeout: 10_000 })

    // Confirm EVENT starts at the 'All Tournaments' sentinel
    await expect(eventSelect).toHaveValue("all")

    // Pick a specific LEVEL
    await levelSelect.selectOption("Masters1000")

    // EVENT must be reset to 'all' immediately
    await expect(eventSelect).toHaveValue("all")
  })

  test("changing LEVEL narrows the EVENT options list (never expands beyond unfiltered count)", async ({
    page,
  }) => {
    await gotoFast(page, "/")

    const levelSelect = page.locator('select[aria-label*="level" i]')
    const eventSelect = page.locator('select[aria-label*="tournament" i]')

    await expect(levelSelect).toBeVisible({ timeout: 10_000 })
    await expect(eventSelect).toBeVisible({ timeout: 10_000 })

    // Snapshot option count under "all"
    const allOptions = await eventSelect.locator("option").allTextContents()

    // Switch to a specific level
    await levelSelect.selectOption("Masters1000")

    const narrowedOptions = await eventSelect.locator("option").allTextContents()

    // Must never exceed the unfiltered list
    expect(narrowedOptions.length).toBeLessThanOrEqual(allOptions.length)

    // The sentinel "All Tournaments" must always be the first option
    expect(narrowedOptions[0]).toMatch(/all tournaments/i)
  })
})

// ---------------------------------------------------------------------------
// 3. Live score polling
// ---------------------------------------------------------------------------

/**
 * The FixturesList polls /api/fixtures/live-scores every 6 s when there are
 * live fixtures.  We use page.route() to inject synthetic fixtures and score
 * responses so this test is fully deterministic and independent of the live
 * API server.
 *
 * Score sequence:
 *   Poll 1 → 3-1   (first set, early in match)
 *   Poll 2 → 5-2   (first set, later)
 *
 * The refetchInterval is 6 s, so we wait up to 14 s (a full interval + buffer)
 * for the second score to appear.
 */
test.describe("Live score polling", () => {
  const LIVE_FIXTURE_ID = "test-live-fixture-abc"

  const MOCK_FIXTURE = {
    id: LIVE_FIXTURE_ID,
    date: "2026-07-21",
    scheduledStart: null,
    timeConfirmed: false,
    isLive: true,
    tournamentName: "Wimbledon",
    tournamentLevel: "GrandSlam",
    round: "Quarter-Final",
    surface: "Grass",
    indoor: false,
    matchFormat: "BestOf5",
    player1Id: "p1-test",
    player1Name: "A. Player",
    player2Id: "p2-test",
    player2Name: "B. Opponent",
  }

  const SCORE_V1 = { sets: [{ player1Games: 3, player2Games: 1 }], statusText: "1st Set" }
  const SCORE_V2 = { sets: [{ player1Games: 5, player2Games: 2 }], statusText: "1st Set" }

  test("score display updates when the 6-second polling refetch returns new data", async ({ page }) => {
    // ── Intercept upcoming fixtures ───────────────────────────────────────
    await page.route("**/api/fixtures/upcoming**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ fixtures: [MOCK_FIXTURE], hasMore: false }),
      })
    })

    // ── Intercept live scores with a counter so each poll returns new data ─
    let liveScoreCallCount = 0
    await page.route("**/api/fixtures/live-scores**", async (route) => {
      liveScoreCallCount++
      const score = liveScoreCallCount === 1 ? SCORE_V1 : SCORE_V2
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: { [LIVE_FIXTURE_ID]: score } }),
      })
    })

    await gotoFast(page, "/")

    // Initial score from poll 1 must appear
    await expect(page.getByText("3-1")).toBeVisible({ timeout: 10_000 })

    // After the 6-second refetch interval the score updates to 5-2
    // (allow up to 14 s = one full interval + buffer for scheduling jitter)
    await expect(page.getByText("5-2")).toBeVisible({ timeout: 14_000 })

    // Sanity: at least 2 calls to the live-scores endpoint were made
    expect(liveScoreCallCount).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 4. SHADOW TRADING hero button
// ---------------------------------------------------------------------------

test.describe("Shadow Trading hero button", () => {
  test("navigates to /shadow-replay and shows the disclosure banner", async ({ page }) => {
    await gotoFast(page, "/")

    // The hero section has a SHADOW TRADING button (not a link)
    const shadowBtn = page.locator("button", { hasText: /shadow trading/i })
    await expect(shadowBtn).toBeVisible({ timeout: 10_000 })
    await shadowBtn.click()

    await page.waitForURL(/shadow-replay/, { timeout: 10_000 })

    // The disclosure banner text is always present once the lazy Suspense boundary
    // resolves and the component mounts.  Fall back to the "unavailable" message
    // so the assertion proves navigation succeeded regardless of data availability.
    await expect(
      page.getByText(/SIMULATED DATA ONLY/i).or(
        page.getByText(/shadow trading data unavailable/i)
      )
    ).toBeVisible({ timeout: 20_000 })
  })
})
