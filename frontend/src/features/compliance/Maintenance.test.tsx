import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAppAs } from '@/test/render';

const CONFIG = {
  version: '1.0',
  min_field_confidence: 0.8,
  min_age: 18,
  pan_pattern: '^x$',
  pan_holder_type_char: 'P',
  name_match_threshold: 0.9,
  name_reject_below: 0.75,
  watchlist_match_threshold: 0.9,
  watchlist_possible_threshold: 0.8,
  address_proof_max_age_days: 90,
  medium_risk_income: 2500000,
  rekyc_years: { HIGH: 2, MEDIUM: 8, LOW: 10 },
  name_title_tokens: ['MR'],
  mandatory_documents: [],
  address_proof_types: [],
  resubmission_sla_days: 7,
  checker_sla_hours: 24,
};
const BASE = {
  'GET /api/v1/admin/rule-config': {
    body: { id: 'c1', version: '1.0', loaded_at: '2026-10-23T00:00:00Z', config: CONFIG },
  },
  'GET /api/v1/admin/watchlists/sanctions': {
    body: {
      entries: [
        {
          list_id: 'SAN0002',
          name: 'Valko Quillon',
          alias: '',
          dob: '1986-02-23',
          nationality: 'X',
          program: 'Y',
        },
      ],
    },
  },
  'GET /api/v1/admin/watchlists/pep': { body: { entries: [] } },
  'GET /api/v1/admin/rekyc-due?days=30': { body: { days: 30, customers: [] } },
};

describe('maintenance (compliance officer)', () => {
  it('activates a new configuration version with only the changed threshold, after confirmation', async () => {
    const calls = renderAppAs('COMPLIANCE_OFFICER', '/maintenance', {
      ...BASE,
      'PUT /api/v1/admin/rule-config': { status: 201, body: { id: 'c2', version: '1.1' } },
    });
    const u = userEvent.setup();
    const field = await screen.findByLabelText('Name match: pass at');
    await u.clear(field);
    await u.type(field, '0.85');
    await u.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByText('Give the new configuration a new version name.')).toBeInTheDocument();
    await u.type(screen.getByLabelText(/New version name/), '1.1');
    await u.click(screen.getByRole('button', { name: 'Review changes' }));
    await u.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'PUT /api/v1/admin/rule-config')).toBe(true),
    );
    const sent = JSON.parse(
      calls.find((c) => c.key === 'PUT /api/v1/admin/rule-config')!.init!.body as string,
    );
    expect(sent).toEqual({ ...CONFIG, version: '1.1', name_match_threshold: 0.85 });
  });

  it('adds a sanctions entry and requires the mandatory fields', async () => {
    const calls = renderAppAs('COMPLIANCE_OFFICER', '/maintenance', {
      ...BASE,
      'POST /api/v1/admin/watchlists/sanctions': { status: 201, body: { list_id: 'SAN9001' } },
    });
    const u = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Add sanctions entry' });
    await u.click(within(form).getByRole('button', { name: 'Add entry' }));
    expect(within(form).getByText(/Fill in: List id, Name/)).toBeInTheDocument();
    for (const [label, value] of [
      ['List id', 'SAN9001'],
      ['Name', 'Test Person'],
      ['Nationality', 'X'],
      ['Programme', 'Y'],
    ])
      await u.type(within(form).getByLabelText(new RegExp(`^${label}`)), value!);
    await u.click(within(form).getByRole('button', { name: 'Add entry' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /api/v1/admin/watchlists/sanctions')).toBe(true),
    );
    expect(
      JSON.parse(
        calls.find((c) => c.key === 'POST /api/v1/admin/watchlists/sanctions')!.init!
          .body as string,
      ),
    ).toEqual({ list_id: 'SAN9001', name: 'Test Person', nationality: 'X', program: 'Y' });
  });

  it('re-screens open cases on request and lists what changed', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/maintenance', {
      ...BASE,
      'POST /api/v1/admin/rescreen': {
        body: {
          rescreened: 4,
          changed: [
            {
              application_id: 'A2000004',
              status: 'IN_REVIEW',
              before: { decision: 'REVIEW', reason_codes: ['NAME_MISMATCH_MINOR'] },
              after: { decision: 'REJECT', reason_codes: ['SANCTIONS_MATCH'] },
            },
          ],
          failures: [],
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Re-screen open cases' }));
    expect(
      await screen.findByText(/4 case\(s\) re-screened, 1 with a changed result/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A2000004' })).toBeInTheDocument();
  });

  it('is not shown to a KYC officer', async () => {
    renderAppAs('KYC_OFFICER', '/maintenance', {});
    expect(await screen.findByText('This page is not for your role')).toBeInTheDocument();
  });

  it('processes received applications on request and says how they were routed', async () => {
    const calls = renderAppAs('COMPLIANCE_OFFICER', '/maintenance', {
      ...BASE,
      'POST /api/v1/admin/process-received': {
        body: {
          processed: 158,
          by_status: { AUTO_APPROVED: 72, IN_REVIEW: 54, AUTO_REJECTED: 27, PENDING_CHECKER: 5 },
          skipped: [],
        },
      },
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Process received applications' }),
    );
    expect(
      await screen.findByText(/158 processed: Auto approved 72, In review 54/),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /api/v1/admin/process-received')).toHaveLength(1);
  });
});
