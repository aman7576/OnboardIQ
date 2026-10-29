import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAppAs } from '@/test/render';

const OCC = {
  'GET /api/v1/reference/occupations': {
    body: { occupations: [{ code: 'SALARIED_PRIVATE', description: 'Salaried (private)' }] },
  },
};

async function fillValid(over: Record<string, string> = {}) {
  const u = userEvent.setup();
  const type = async (label: string, value: string) => {
    const el = screen.getByLabelText(new RegExp(label));
    await u.clear(el);
    await u.type(el, value);
  };
  const v = {
    'Full name': 'Asha Verma',
    PAN: 'ABCPV1234D',
    'Aadhaar: last 4': '1234',
    'Mobile number': '9876543210',
    'E-mail': 'asha@example.com',
    Address: '12 MG Road',
    City: 'Pune',
    State: 'Maharashtra',
    Pincode: '411001',
    'Annual income': '600000',
    ...over,
  };
  for (const [label, value] of Object.entries(v)) await type(label, value);
  await u.type(screen.getByLabelText(/Date of birth/), '1990-05-12');
  await u.selectOptions(screen.getByLabelText(/Gender/), 'F');
  await u.selectOptions(screen.getByLabelText(/Occupation/), 'SALARIED_PRIVATE');
  await u.click(screen.getByLabelText(/I consent/));
  return u;
}

describe('new application form', () => {
  it('shows a message for every empty required field and does not call the API', async () => {
    const calls = renderAppAs('APPLICANT', '/applications/new', OCC);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to documents' }));
    expect(await screen.findByText(/fields need your attention/)).toBeInTheDocument();
    expect(screen.getAllByText('Enter your full name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Consent to KYC checks is required/).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.key === 'POST /api/v1/applications')).toBe(false);
  });

  it('refuses a full 12-digit Aadhaar number on the screen', async () => {
    const calls = renderAppAs('APPLICANT', '/applications/new', OCC);
    await screen.findByLabelText(/Full name/);
    const u = await fillValid({ 'Aadhaar: last 4': '123456789012' });
    await u.click(screen.getByRole('button', { name: 'Continue to documents' }));
    expect(await screen.findAllByText(/Do not enter the full 12-digit number/)).not.toHaveLength(0);
    expect(calls.some((c) => c.key === 'POST /api/v1/applications')).toBe(false);
  });

  it('shows the server field messages next to the fields', async () => {
    renderAppAs('APPLICANT', '/applications/new', {
      ...OCC,
      'POST /api/v1/applications': {
        status: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'Invalid',
          fields: [{ field: 'pan_number', message: 'PAN does not match the configured pattern' }],
        },
      },
    });
    await screen.findByLabelText(/Full name/);
    const u = await fillValid();
    await u.click(screen.getByRole('button', { name: 'Continue to documents' }));
    expect(
      (await screen.findAllByText('PAN does not match the configured pattern')).length,
    ).toBeGreaterThan(0);
  });

  it('sends the declared details and moves on to the upload step', async () => {
    const calls = renderAppAs('APPLICANT', '/applications/new', {
      ...OCC,
      'POST /api/v1/applications': {
        status: 201,
        body: { application_id: 'A2000099', status: 'DRAFT' },
      },
      'GET /api/v1/applications/A2000099': {
        body: {
          application_id: 'A2000099',
          status: 'SUBMITTED',
          full_name: 'Asha Verma',
          documents: [],
          reasons: [],
          timeline: [],
          application_date: '2026-10-23',
          pan_masked: 'ABCPV****D',
          occupation_code: 'SALARIED_PRIVATE',
          created_at: '2026-10-23T00:00:00Z',
          resubmission_deadline: null,
        },
      },
    });
    await screen.findByLabelText(/Full name/);
    const u = await fillValid();
    await u.click(screen.getByRole('button', { name: 'Continue to documents' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /api/v1/applications')).toBe(true),
    );
    const body = JSON.parse(
      calls.find((c) => c.key === 'POST /api/v1/applications')!.init!.body as string,
    );
    expect(body).toMatchObject({
      pan_number: 'ABCPV1234D',
      aadhaar_last4: '1234',
      annual_income: 600000,
      consent_kyc: true,
      gender: 'F',
    });
    expect(JSON.stringify(body)).not.toMatch(/\d{12}/);
  });
});
