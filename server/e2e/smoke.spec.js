/**
 * Browser smoke tests.
 *
 * The API suite cannot reach the client, and several of the defects fixed in
 * this project were purely client-side: a pagination button that silently did
 * nothing, leaked blob URLs, an unescaped field, an inert Kanban board. These
 * cover the flows a user actually walks through, not every branch.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = process.env.APP_PASSWORD || 'e2e-test-password';

async function unlock(page) {
  await page.goto('/');
  await page.getByLabel(/password/i).or(page.locator('#loginPasswordInput')).first().fill(PASSWORD);
  await page.locator('#btnLoginSubmit').click();
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 10_000 });
}

/** The wizard opens on a fresh profile; dismiss it so other flows are reachable. */
async function skipOnboarding(page) {
  const overlay = page.locator('#onboardingOverlay');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#obSkip').click();
    await expect(overlay).toBeHidden();
  }
}


/**
 * Clear the stored profile so the first-run wizard triggers again.
 * The wizard deliberately shows only once, so a test that needs it must reset
 * the state it keys off rather than assume a clean database.
 */
async function resetProfile(page) {
  await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('jobsearch_auth_session') || '{}');
    await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({ onboardingComplete: false })
    });
  });
  await page.reload();
}

test.describe('authentication', () => {
  test('the app is locked until a correct password is given', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loginOverlay')).toBeVisible();

    await page.locator('#loginPasswordInput').fill('definitely-wrong');
    await page.locator('#btnLoginSubmit').click();

    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toContainText(/incorrect/i);
    // The error must never disclose a working credential.
    await expect(page.locator('#loginError')).not.toContainText(/fallback|tip/i);
    await expect(page.locator('#loginOverlay')).toBeVisible();
  });

  test('a correct password unlocks the workspace', async ({ page }) => {
    await unlock(page);
    await expect(page.locator('.app-header')).toBeVisible();
  });

  test('locking clears the session so a reload stays locked', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    await page.locator('#btnLogout').click();
    await expect(page.locator('#loginOverlay')).toBeVisible();

    await page.reload();
    await expect(page.locator('#loginOverlay')).toBeVisible();
  });
});

test.describe('onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);
    await resetProfile(page);
  });

  test('the wizard appears on a fresh profile and can be skipped', async ({ page }) => {
    const overlay = page.locator('#onboardingOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#onboardingSubtitle')).toContainText('Step 1 of 3');

    await page.locator('#obSkip').click();
    await expect(overlay).toBeHidden();
  });

  test('pasted CV text advances to the confirmation step', async ({ page }) => {
    await expect(page.locator('#onboardingOverlay')).toBeVisible();

    await page.locator('#obRawText').fill(
      'Ada Lovelace\nStaff Software Engineer\nada@example.com\n+44 20 7946 0000\n' +
      'London, UK\n\nExperience building distributed systems in Go and TypeScript.'
    );
    await page.locator('#obParse').click();

    await expect(page.locator('#obStep2')).toBeVisible({ timeout: 20_000 });
    // Parsed values are shown for confirmation before anything is saved.
    await expect(page.locator('#obEmail')).toHaveValue('ada@example.com');
  });
});

test.describe('navigation', () => {
  test('tabs are operable by keyboard', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    // Finishing setup lands on the job board, so select a known tab first
    // rather than assuming which one is active.
    const applyTab = page.locator('.nav-tab[data-tab="apply"]');
    await applyTab.click();
    await expect(applyTab).toHaveAttribute('aria-selected', 'true');
    await expect(applyTab).toHaveAttribute('tabindex', '0');

    await applyTab.focus();
    await page.keyboard.press('ArrowRight');

    const searchTab = page.locator('.nav-tab[data-tab="search"]');
    await expect(searchTab).toHaveAttribute('aria-selected', 'true');
    await expect(searchTab).toBeFocused();
    await expect(page.locator('#tab-search')).toHaveClass(/active/);

    // Roving tabindex: only the selected tab is in the tab order.
    await expect(applyTab).toHaveAttribute('tabindex', '-1');
  });

  test('the skip link reaches the main content', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
  });
});

test.describe('profile', () => {
  test('saving persists across a reload', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    await page.locator('.nav-tab[data-tab="profile"]').click();
    await page.locator('#profName').fill('Grace Hopper');
    await page.locator('#profPrimarySkills').fill('COBOL, Compilers');
    await page.locator('#btnSaveProfile').click();

    await expect(page.locator('.toast').last()).toContainText(/saved/i);

    await page.reload();
    await page.locator('.nav-tab[data-tab="profile"]').click();
    await expect(page.locator('#profName')).toHaveValue('Grace Hopper');
  });
});

test.describe('tracker', () => {
  test('a generated application appears on the board and can change status', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    await page.locator('#targetRole').fill('Reliability Engineer');
    await page.locator('#targetCompany').fill('Contoso');
    await page.locator('#targetDescription').fill(
      'We are hiring a reliability engineer to own our incident response, ' +
      'error budgets and observability stack across a Kubernetes estate.'
    );
    await page.locator('#btnGenerateAll').click();

    // Streamed stages land as the server completes them.
    await expect(page.locator('#step-drafter')).toHaveClass(/done|active/, { timeout: 60_000 });
    await expect(page.locator('#reviewerFooter')).toBeVisible({ timeout: 60_000 });

    await page.locator('.nav-tab[data-tab="tracker"]').click();
    const card = page.locator('#col-Drafted .kanban-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Reliability Engineer');

    // The status control is the keyboard route for what drag-and-drop does.
    await card.locator('.kanban-status').selectOption('Interviewing');
    await expect(page.locator('#col-Interviewing .kanban-card')).toContainText('Reliability Engineer');
  });

  test('the filter narrows the board', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);
    await page.locator('.nav-tab[data-tab="tracker"]').click();

    await page.locator('#trackerSearch').fill('a-term-that-matches-nothing');
    await expect(page.locator('.kanban-card')).toHaveCount(0);

    await page.locator('#trackerSearch').fill('');
    await expect(page.locator('.kanban-card').first()).toBeVisible();
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test('keeps the tracker controls and stages reachable on a phone', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);
    await page.locator('.nav-tab[data-tab="tracker"]').click();

    await expect(page.locator('#trackerSearch')).toBeVisible();
    await expect(page.locator('#btnShowDueFollowUps')).toBeVisible();
    await expect(page.locator('#kanbanBoard')).toHaveCSS('overflow-x', 'auto');
    await expect(page.locator('.tracker-swipe-hint')).toBeVisible();
  });

  test('opens the in-app editor instead of browser prompts', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);
    await page.locator('.nav-tab[data-tab="tracker"]').click();

    const edit = page.locator('.kanban-edit').first();
    test.skip(await edit.count() === 0, 'requires an application created by the tracker flow');
    await edit.click();
    await expect(page.locator('#trackerEditOverlay')).toBeVisible();
    await expect(page.locator('#trackerFollowUp')).toHaveAttribute('type', 'date');
  });
});

test.describe('honest reporting', () => {
  test('audit badges say what was actually verified', async ({ page }) => {
    await unlock(page);
    await skipOnboarding(page);

    await page.locator('#targetRole').fill('Data Engineer');
    await page.locator('#targetDescription').fill(
      'Own the ingestion pipelines, warehouse modelling and data quality checks for our analytics platform.'
    );
    await page.locator('#btnGenerateAll').click();

    await expect(page.locator('#auditBadges')).toBeVisible({ timeout: 60_000 });
    // With no AI provider and no TeX engine in CI, the UI must say so rather
    // than claiming a verified, tailored document.
    await expect(page.locator('#auditBadges')).toContainText(/not verified|preview render|offline template/i);
  });
});
