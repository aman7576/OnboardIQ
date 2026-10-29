import { expect, test, type Page } from '@playwright/test';

// Fixed test password of the throw-away e2e database (see backend/src/cli/e2e-server.ts).
const PASSWORD = 'E2e-Test-Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

const text = (lines: string[]) => ({
  name: '',
  mimeType: 'text/plain',
  buffer: Buffer.from(lines.join('\n')),
});

test('a new applicant fills the form, uploads three documents and submits', async ({ page }) => {
  await signIn(page, 'applicant2@onboardiq.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'New application' })
    .click();

  // Validation messages appear and a full Aadhaar number is refused before anything is sent.
  await page.getByRole('button', { name: 'Continue to documents' }).click();
  await expect(page.getByText(/fields need your attention/)).toBeVisible();
  await page.getByLabel(/Aadhaar: last 4/).fill('123456789012');
  await page.getByLabel(/Aadhaar: last 4/).blur();
  await expect(page.getByText(/Do not enter the full 12-digit number/).first()).toBeVisible();

  await page.getByLabel(/Full name/).fill('Neha Kapoor');
  await page.getByLabel(/Date of birth/).fill('1992-03-14');
  await page.getByLabel(/Gender/).selectOption('F');
  await page.getByLabel(/^PAN/).fill('ABCPK4321D');
  await page.getByLabel(/Aadhaar: last 4/).fill('4321');
  await page.getByLabel(/Mobile number/).fill('9812345678');
  await page.getByLabel(/E-mail/).fill('neha@example.com');
  await page.getByLabel(/Address/).fill('12 Park Street');
  await page.getByLabel(/City/).fill('Kolkata');
  await page.getByLabel(/^State/).fill('West Bengal');
  await page.getByLabel(/Pincode/).fill('700016');
  await page.getByLabel(/Occupation/).selectOption({ index: 1 });
  await page.getByLabel(/Annual income/).fill('800000');
  await page.getByLabel(/I consent/).check();
  await page.getByRole('button', { name: 'Continue to documents' }).click();

  await expect(page.getByRole('heading', { name: 'Upload your documents' })).toBeVisible();
  const files = ['pan.txt', 'aadhaar.txt', 'electricity-bill.txt'].map((name) => ({
    ...text([`Sample ${name}`, 'Neha Kapoor']),
    name,
  }));
  await page.locator('#files').setInputFiles(files);
  await expect(
    page.getByRole('list', { name: 'Files to upload' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Upload 3 files' }).click();
  await expect(
    page.getByRole('list', { name: 'Uploaded documents' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Submit application' }).click();

  // The rules route a case with unreadable documents to a person; the applicant sees only a plain status.
  await expect(page.getByText('In review').first()).toBeVisible();
  await expect(page.getByText(/sanction|watchlist|PEP/i)).toHaveCount(0);
});

test('applicant → officer correction with a reason → different checker approves → applicant sees approval', async ({
  page,
}) => {
  // 1. Applicant submits the prepared sample case A2000009 (its PAN scan is unreadable).
  await signIn(page, 'applicant1@onboardiq.test');
  await page
    .getByRole('link', { name: /A2000009/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Upload documents and submit' }).click();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();
  await signOut(page);

  // 2. Officer: the low-confidence PAN is highlighted; a correction needs a reason.
  await signIn(page, 'officer1@onboardiq.test');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await page
    .getByRole('link', { name: /A2000009/ })
    .first()
    .click();
  await expect(page.getByText(/below 0\.80/).first()).toBeVisible();
  await page.getByRole('button', { name: /Correct Pan number of D3000025/i }).click();
  await page.getByLabel(/Corrected value/).fill('ZZTPS9012Y');
  await page.getByRole('button', { name: 'Add correction' }).click();
  await expect(page.getByText('A reason is required for every correction.')).toBeVisible();
  await page
    .getByLabel(/Reason for the correction/)
    .fill('PAN is clearly legible on the original scan');
  await page.getByRole('button', { name: 'Add correction' }).click();
  await page.getByRole('button', { name: /Submit 1 correction/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  // The officer (maker) cannot reach the checker's pages.
  await page.goto('/checker');
  await expect(page.getByText('This page is not for your role')).toBeVisible();
  await signOut(page);

  // 3. A different person (checker) approves.
  await signIn(page, 'checker1@onboardiq.test');
  await page.goto('/checker');
  await page
    .getByRole('link', { name: /A2000009/ })
    .first()
    .click();
  await expect(page.getByText('Awaiting checker').first()).toBeVisible();
  await page
    .getByRole('radio', { name: /Approve/ })
    .first()
    .check();
  await page.getByLabel('Comment').fill('Documents and corrected PAN verified.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Checker queue' })).toBeVisible();

  // The audit trail shows who did what.
  await page.goto('/audit?application=A2000009');
  await expect(page.getByText('Anita Rao').first()).toBeVisible();
  await signOut(page);

  // 4. The applicant sees the outcome in plain words.
  await signIn(page, 'applicant1@onboardiq.test');
  await page
    .getByRole('link', { name: /A2000009/ })
    .first()
    .click();
  await expect(page.getByText('Your account is open')).toBeVisible();
});

test('a visitor registers as an applicant; a compliance officer changes a watchlist and re-screens', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel(/Your name/).fill('Arjun Mehta');
  await page.getByLabel(/E-mail/).fill(`arjun.${Date.now()}@example.com`);
  await page.getByLabel(/^Password/).fill('Long-enough-pass1');
  await page.getByLabel(/Repeat the password/).fill('Long-enough-pass1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();
  // A new applicant cannot open staff pages.
  await page.goto('/maintenance');
  await expect(page.getByText('This page is not for your role')).toBeVisible();
  await signOut(page);

  await signIn(page, 'checker1@onboardiq.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Maintenance' })
    .click();
  const form = page.getByRole('form', { name: 'Add sanctions entry' });
  await form.getByLabel(/^List id/).fill('SAN9901');
  await form.getByLabel(/^Name/).fill('Test Listed Person');
  await form.getByLabel(/^Nationality/).fill('Testland');
  await form.getByLabel(/^Programme/).fill('E2E');
  await form.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText(/Entry added/)).toBeVisible();
  await page.getByLabel('Search entries').fill('SAN9901');
  await expect(page.getByRole('cell', { name: 'SAN9901', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Re-screen open cases' }).click();
  await expect(page.getByText(/case\(s\) re-screened/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove SAN9901' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('cell', { name: 'SAN9901', exact: true })).toHaveCount(0);
});
