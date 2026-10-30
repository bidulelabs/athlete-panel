import { test, expect, type Locator, type Page } from '@playwright/test';
import { markdownFixture, markdownSource } from '../fixtures/markdown';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');
const mutationRoute = '**/api/plugins/training/mutate';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}

async function preview(page: Page) {
  const data = markdownFixture();
  let writes = 0;
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) writes++;
    if (request.url().startsWith('https://example.com')) external.push(request.url());
  });
  await page.route('https://example.com/**', (route) => route.abort());
  await page.clock.setFixedTime(new Date('2030-10-29T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const response = await page.request.get('/api/workspace?from=2030-10-21&to=2030-11-17');
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  await page.route('**/api/workspace?**', (route) =>
    route.fulfill({ json: { ...envelope, state: data } }),
  );
  return { writes: () => writes, external };
}

async function formatted(content: Locator) {
  await expect(content.getByRole('heading', { name: 'Session focus', exact: true })).toBeVisible();
  await expect(content.locator('strong')).toHaveText('Steady');
  await expect(content.locator('em')).toHaveText('comfortable');
  await expect(content.locator('del')).toHaveText('Sprint');
  await expect(content.locator('table')).toBeVisible();
  await expect(content.locator('blockquote')).toContainText('Leave room to recover.');
  await expect(content.locator('input[type=checkbox]')).toHaveCount(2);
  for (const checkbox of await content.locator('input[type=checkbox]').all())
    await expect(checkbox).toBeDisabled();
  await expect(content.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(content.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(content.getByRole('link', { name: 'Unsafe', exact: true })).toHaveCount(0);
  await expect(content.locator('img, script, iframe')).toHaveCount(0);
  await expect(content).toContainText('Route map');
  await expect(content).toContainText('<img src=');
  await expect(content.locator('br')).not.toHaveCount(0);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const dialog of await page.getByRole('dialog').all())
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function footnotesAreLocal(page: Page) {
  expect(
    await page.locator('.ui-markdown').evaluateAll((blocks) => {
      const ids = blocks.flatMap((block) =>
        [...block.querySelectorAll('[id]')].map((node) => node.id),
      );
      return (
        ids.length === new Set(ids).size &&
        blocks.every((block) =>
          [...block.querySelectorAll('a[data-footnote-ref], a[data-footnote-backref]')].every(
            (link) => {
              const target = document.getElementById(link.getAttribute('href')!.slice(1));
              const label = link.getAttribute('aria-describedby');
              return (
                target &&
                block.contains(target) &&
                (!label || block.contains(document.getElementById(label)))
              );
            },
          ),
        )
      );
    }),
  ).toBe(true);
}

test('plan and workout Markdown is readable, safe and separate from excluded fields', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const observed = await preview(page);
  await page.goto('/plans');
  const plan = page.getByRole('dialog', { name: 'Autumn endurance block', exact: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const summary = page.getByRole('button', { name: 'Open Autumn endurance block', exact: true });
    await expect(summary).toContainText('Session focus Steady and comfortable.');
    await expect(summary.locator('a, input')).toHaveCount(0);
    await summary.click();
    await formatted(plan.locator('.ui-markdown'));
    const workout = plan.getByRole('button', { name: 'Open Easy endurance ride', exact: true });
    await expect(workout).not.toContainText('**');
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/markdown/plan-${info.project.name}-${theme}.png` });
    await workout.click();
    const inspector = page.getByRole('dialog', { name: 'Workout details', exact: true });
    await formatted(inspector.locator('.ui-markdown').first());
    await formatted(inspector.locator('.completion-notes'));
    await expect(inspector).toContainText('**Plain completion reason**');
    await footnotesAreLocal(page);
    await inspector.locator('.completion-notes a[data-footnote-ref]').click();
    await noOverflow(page);
    await page.screenshot({ path: `.runtime/markdown/workout-${info.project.name}-${theme}.png` });
    await inspector.getByRole('button', { name: 'Edit completion', exact: true }).click();
    const completion = page.getByRole('dialog', { name: 'Log completion', exact: true });
    await expect(
      completion.getByRole('textbox', { name: 'Completion notes', exact: true }),
    ).toHaveValue(markdownSource);
    await expect(
      completion.getByRole('textbox', { name: 'Completion reason', exact: true }),
    ).toHaveValue('**Plain completion reason**');
    await page.keyboard.press('Escape');
    await expect(
      inspector.getByRole('button', { name: 'Edit completion', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(workout).toBeFocused();
    for (const [title, plain] of [
      ['Threshold intervals', '**Plain interval note**'],
      ['Strength & stability', '**Plain exercise instruction**'],
    ]) {
      await plan.getByRole('button', { name: `Open ${title}`, exact: true }).click();
      await expect(inspector.locator('.prescription-note').first()).toHaveText(plain);
      await inspector.getByRole('button', { name: 'Close workout details', exact: true }).click();
      await expect(plan.getByRole('button', { name: `Open ${title}`, exact: true })).toBeFocused();
    }
    await page.keyboard.press('Escape');
  }
  expect(observed.writes()).toBe(0);
  expect(observed.external).toEqual([]);
});

test('calendar and settings render all context fields in both themes and at narrow widths', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const observed = await preview(page);
  for (const theme of ['dark', 'light']) {
    await page.goto('/calendar');
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.getByLabel('Go to date').fill('2030-10-21');
    for (const kind of ['note', 'event', 'injury']) {
      const card = page
        .getByRole('button', { name: `Open ${kind} Markdown ${kind}`, exact: true })
        .first();
      await expect(card).toContainText('Session focus Steady and comfortable.');
      await expect(card.locator('a, input')).toHaveCount(0);
      await card.click();
      const dialog = page.getByRole('dialog');
      for (const content of await dialog.locator('.ui-markdown').all()) await formatted(content);
      await footnotesAreLocal(page);
      await noOverflow(page);
      await page.screenshot({
        path: `.runtime/markdown/${kind}-${info.project.name}-${theme}.png`,
      });
      await page.keyboard.press('Escape');
      await expect(card).toBeFocused();
    }
    await page.goto('/settings');
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.getByRole('textbox', { name: 'Training goals', exact: true })).toHaveValue(
      '**Plain profile goal**',
    );
    for (const tab of ['Notes', 'Events', 'Injury constraints']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      for (const content of await page.locator('.context-record .ui-markdown').all())
        await formatted(content);
      await footnotesAreLocal(page);
      await noOverflow(page);
    }
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 740 });
      await noOverflow(page);
    }
    await page.screenshot({
      path: `.runtime/markdown/settings-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
  }
  expect(observed.writes()).toBe(0);
  expect(observed.external).toEqual([]);
});

async function failedSave(page: Page, dialog: Locator, button: string, field: string) {
  await page.route(mutationRoute, (route) =>
    route.fulfill({ status: 409, json: { error: 'Changed elsewhere. Refresh and review.' } }),
  );
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Changed elsewhere');
  await expect(dialog.getByRole('textbox', { name: field, exact: true })).toHaveValue(
    markdownSource,
  );
  await page.unroute(mutationRoute);
}

test('save, reload and reopen preserve Markdown source for plans, workouts and completion', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const title = `Markdown ${info.project.name} ${Date.now()}`;
  await login(page);
  await page.goto('/plans');
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create a training plan', exact: true });
  await create.getByLabel('Plan title').fill(title);
  await create.getByLabel('Start date').fill('2026-10-19');
  await create.getByRole('textbox', { name: 'Description', exact: true }).fill(markdownSource);
  await expect(create.getByRole('textbox', { name: 'Description', exact: true })).toHaveAttribute(
    'maxlength',
    '20000',
  );
  await failedSave(page, create, 'Create plan', 'Description');
  await create.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect(create).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  const plan = page.getByRole('dialog', { name: title, exact: true });
  await formatted(plan.locator('.ui-markdown'));
  await plan.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const editPlan = page.getByRole('dialog', { name: 'Edit training plan', exact: true });
  await expect(editPlan.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    markdownSource,
  );
  await page.keyboard.press('Escape');
  await plan.getByRole('button', { name: 'Add first workout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add workout', exact: true });
  await editor.getByLabel('Workout title').fill(`${title} session`);
  await editor
    .getByRole('textbox', { name: 'Workout description', exact: true })
    .fill(markdownSource);
  await failedSave(page, editor, 'Add workout', 'Workout description');
  await editor.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  await plan.getByRole('button', { name: `Open ${title} session`, exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Workout details', exact: true });
  await formatted(inspector.locator('.ui-markdown'));
  await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
  const editWorkout = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await expect(
    editWorkout.getByRole('textbox', { name: 'Workout description', exact: true }),
  ).toHaveValue(markdownSource);
  await page.keyboard.press('Escape');
  await inspector.getByRole('button', { name: 'Log workout', exact: true }).click();
  const log = page.getByRole('dialog', { name: 'Log completion', exact: true });
  await log.getByLabel('Performed date', { exact: true }).fill('2026-10-19');
  await log.getByRole('textbox', { name: 'Completion notes', exact: true }).fill(markdownSource);
  await failedSave(page, log, 'Save completion', 'Completion notes');
  await log.getByRole('button', { name: 'Save completion', exact: true }).click();
  await expect(log).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  await plan.getByRole('button', { name: `Open ${title} session`, exact: true }).click();
  await formatted(inspector.locator('.completion-notes'));
  await inspector.getByRole('button', { name: 'Edit completion', exact: true }).click();
  await expect(log.getByRole('textbox', { name: 'Completion notes', exact: true })).toHaveValue(
    markdownSource,
  );
});

test('context editors save and reopen exact source, including both injury fields', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto('/settings');
  for (const [kind, tab, field, limit] of [
    ['note', 'Notes', 'Note', '20000'],
    ['event', 'Events', 'Notes', '4000'],
    ['injury', 'Injury constraints', 'Constraint or description', '4000'],
  ]) {
    const title = `Markdown ${kind} ${info.project.name} ${Date.now()}`;
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page
      .getByRole('button', { name: `Add ${kind}`, exact: true })
      .first()
      .click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel(kind === 'injury' ? 'Body area' : 'Title', { exact: true }).fill(title);
    await editor.getByRole('textbox', { name: field, exact: true }).fill(markdownSource);
    await expect(editor.getByRole('textbox', { name: field, exact: true })).toHaveAttribute(
      'maxlength',
      limit,
    );
    if (kind === 'injury')
      await editor
        .getByRole('textbox', { name: 'Additional notes', exact: true })
        .fill(markdownSource);
    await failedSave(page, editor, `Add ${kind}`, field);
    await editor.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const record = page.locator('.context-record').filter({ hasText: title });
    for (const content of await record.locator('.ui-markdown').all()) await formatted(content);
    await record.getByRole('button', { name: `Edit ${kind}`, exact: true }).click();
    await expect(editor.getByRole('textbox', { name: field, exact: true })).toHaveValue(
      markdownSource,
    );
    if (kind === 'injury')
      await expect(
        editor.getByRole('textbox', { name: 'Additional notes', exact: true }),
      ).toHaveValue(markdownSource);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

for (const theme of ['dark', 'light']) {
  test(`deeply nested notes remain readable, editable and deletable in ${theme} theme`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    const images: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().startsWith('https://example.com')) images.push(request.url());
    });
    await page.route('https://example.com/**', (route) => route.abort());
    await page.clock.setFixedTime(new Date('2030-10-29T12:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
    await login(page);
    const date = '2030-10-29';
    for (const [kind, nested] of [
      ['quotes', '>'.repeat(4002)],
      ['lists', '- '.repeat(1900) + 'nested text'],
    ]) {
      const title = `Deep ${kind} ${theme} ${info.project.name} ${Date.now()}`;
      const source =
        nested +
        '\n<img src="https://example.com/tracker" onerror="alert(1)">\n' +
        '![image](https://example.com/image.png)\n[unsafe](javascript:alert%281%29)';
      await page.goto('/settings');
      await page.getByRole('tab', { name: 'Notes', exact: true }).click();
      await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
      const editor = page.getByRole('dialog');
      await editor.getByLabel('Title', { exact: true }).fill(title);
      await editor.getByRole('textbox', { name: 'Note', exact: true }).fill(source);
      await editor.getByLabel('Scheduled date', { exact: true }).fill(date);
      await editor.getByRole('button', { name: 'Add note', exact: true }).click();
      await expect(editor).not.toBeVisible();
      await page.reload();
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.getByRole('tab', { name: 'Notes', exact: true }).click();
      const record = page.locator('.context-record').filter({ hasText: title });
      await expect(record.locator('.ui-markdown-fallback')).toHaveText(source);
      await expect(record.locator('.ui-markdown a, .ui-markdown img')).toHaveCount(0);
      await noOverflow(page);
      await record.getByRole('button', { name: 'Edit note', exact: true }).click();
      await expect(editor.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(source);
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

      await page.goto('/calendar');
      await page.getByLabel('Go to date').fill(date);
      await page.reload();
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const card = page.getByRole('button', { name: `Open note ${title}`, exact: true });
      await expect(card).toContainText(nested.trim());
      await expect(card.locator('a, input, img')).toHaveCount(0);
      await noOverflow(page);
      await card.click();
      const detail = page.getByRole('dialog', { name: title, exact: true });
      await expect(detail.locator('.ui-markdown-fallback')).toHaveText(source);
      await noOverflow(page);
      await page.screenshot({
        path: `.runtime/markdown/deep-${kind}-${info.project.name}-${theme}.png`,
      });
      await detail.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(editor.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(source);
      await editor.getByRole('textbox', { name: 'Note', exact: true }).fill('**Recovered note**');
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(editor).not.toBeVisible();
      await card.click();
      await expect(detail.locator('.ui-markdown strong')).toHaveText('Recovered note');
      await expect(detail.locator('.ui-markdown-fallback')).toHaveCount(0);
      // Restore the problematic source and delete it directly, without a manual data repair.
      await detail.getByRole('button', { name: 'Edit', exact: true }).click();
      await editor.getByRole('textbox', { name: 'Note', exact: true }).fill(source);
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(editor).not.toBeVisible();
      await card.click();
      await expect(detail.locator('.ui-markdown-fallback')).toHaveText(source);
      await detail.getByRole('button', { name: 'Delete', exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Confirm delete', exact: true })
        .click();
      await expect(detail).not.toBeVisible();
      await expect(card).toHaveCount(0);
      await page.reload();
      await expect(card).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    expect(images).toEqual([]);
  });
}
