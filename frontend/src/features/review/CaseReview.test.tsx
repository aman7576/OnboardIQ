import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { StaffApplication } from '@/api/types';
import { renderAppAs } from '@/test/render';

const CASE: StaffApplication = {
  application_id: 'A2000009',
  application_date: '2026-10-01',
  status: 'IN_REVIEW',
  full_name: 'Ravi Kumar',
  pan_masked: 'ABCPK****F',
  occupation_code: 'SALARIED_PRIVATE',
  created_at: '2026-10-01T00:00:00Z',
  resubmission_deadline: null,
  dob: '1990-01-01',
  gender: 'M',
  aadhaar_masked: 'XXXX XXXX 1234',
  aadhaar_last4: '1234',
  mobile: '9876543210',
  email: 'r@example.com',
  address: '1 Road',
  city: 'Pune',
  state: 'MH',
  pincode: '411001',
  annual_income: 500000,
  submission_round: 1,
  pan_number: 'ABCPK1234F',
  version: 3,
  rekyc_due_date: null,
  thresholds: { min_field_confidence: 0.8 },
  timeline: [
    { status: 'SUBMITTED', at: '2026-10-01T00:00:00Z' },
    { status: 'IN_REVIEW', at: '2026-10-01T01:00:00Z', actor_role: 'SYSTEM' },
  ],
  documents: [
    {
      doc_id: 'D1',
      file_name: 'pan.txt',
      declared_doc_type: 'PAN_CARD',
      size_bytes: 100,
      extracted_fields: [
        { field_name: 'pan_number', value: 'ABCPK12', confidence: 0.55, source: 'EXTRACTOR' },
        { field_name: 'name', value: 'Ravi Kumar', confidence: 0.95, source: 'EXTRACTOR' },
      ],
    },
  ],
  evaluation: {
    decision: 'REVIEW',
    reason_codes: ['LOW_EXTRACTION_CONFIDENCE'],
    name_match_score: 1,
    risk_category: 'LOW',
    rekyc_due_date: null,
    triggered_at: '2026-10-01T00:30:00Z',
    screening: [
      {
        list_type: 'SANCTIONS',
        entry_id: 'S1',
        matched_name: 'Ravi K',
        similarity: 0.7,
        result: 'POSSIBLE',
      },
    ],
    trace: [
      { rule: 'R3', code: 'LOW_EXTRACTION_CONFIDENCE', outcome: 'REVIEW', status: 'TRIGGERED' },
      {
        rule: 'R6',
        code: 'PAN_MISMATCH',
        outcome: 'REJECT',
        status: 'SKIPPED',
        skippedBecause: 'pan_number below the minimum confidence',
      },
    ],
  },
  recommendations: [],
  checker_decisions: [],
};
const routes = (c: StaffApplication = CASE) => ({
  'GET /api/v1/applications/A2000009': { body: c },
});

describe('case review (officer)', () => {
  it('shows extracted values with confidence, highlights the low one, and shows rule results and watchlist matches to staff', async () => {
    renderAppAs('KYC_OFFICER', '/cases/A2000009', routes());
    expect(
      await screen.findByRole('heading', { name: /A2000009 · Ravi Kumar/ }),
    ).toBeInTheDocument();
    const docs = within(screen.getByRole('region', { name: 'Documents' }));
    expect(docs.getAllByText(/below 0\.80/)).toHaveLength(1);
    expect(docs.getByText('0.55')).toBeInTheDocument();
    expect(
      screen.getAllByText(/LOW_EXTRACTION_CONFIDENCE|Low extraction confidence/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/pan_number below the minimum confidence/)).toBeInTheDocument();
    expect(screen.getAllByText(/Ravi K/).length).toBeGreaterThan(0);
  });

  it('requires a reason for every correction and sends it with the new value', async () => {
    const calls = renderAppAs('KYC_OFFICER', '/cases/A2000009', {
      ...routes(),
      'POST /api/v1/applications/A2000009/corrections': {
        body: { status: 'PENDING_CHECKER', decision: 'APPROVE' },
      },
      'GET /api/v1/review/queue': { body: { queue: 'review', applications: [] } },
    });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Correct Pan number of D1/i }));
    await u.type(screen.getByLabelText(/Corrected value/), 'ABCPK1234F');
    await u.click(screen.getByRole('button', { name: 'Add correction' }));
    expect(
      await screen.findByText('A reason is required for every correction.'),
    ).toBeInTheDocument();
    await u.type(screen.getByLabelText(/Reason for the correction/), 'Clear on the scan');
    await u.click(screen.getByRole('button', { name: 'Add correction' }));
    await u.click(await screen.findByRole('button', { name: /Submit 1 correction/ }));
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /api/v1/applications/A2000009/corrections')).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        calls.find((c) => c.key.startsWith('POST') && c.key.endsWith('corrections'))!.init!
          .body as string,
      ),
    ).toEqual({
      corrections: [
        {
          doc_id: 'D1',
          field_name: 'pan_number',
          new_value: 'ABCPK1234F',
          reason: 'Clear on the scan',
        },
      ],
    });
  });

  it('loads the document text only when asked', async () => {
    const calls = renderAppAs('KYC_OFFICER', '/cases/A2000009', {
      ...routes(),
      'GET /api/v1/applications/A2000009/documents/D1': {
        body: {
          doc_id: 'D1',
          file_name: 'pan.txt',
          declared_doc_type: 'PAN_CARD',
          sha256: 'x',
          text: 'PERMANENT ACCOUNT NUMBER <b>ABCPK12</b>',
        },
      },
    });
    await screen.findByRole('heading', { name: /A2000009/ });
    expect(calls.some((c) => c.key.includes('/documents/D1'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show document text' }));
    const pre = await screen.findByLabelText('Text of D1');
    expect(pre).toHaveTextContent('<b>ABCPK12</b>'); // shown as text, never as markup
  });

  it('needs a choice and a comment of at least 10 characters before a recommendation can be confirmed; offers no approve/reject suggestion by itself', async () => {
    renderAppAs('KYC_OFFICER', '/cases/A2000009', routes());
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Record recommendation' }));
    expect(await screen.findByText('Choose one option.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Recommend approval/ })).not.toBeChecked();
    await u.click(screen.getByRole('radio', { name: /Recommend approval/ }));
    await u.type(screen.getByLabelText(/Comment/), 'too short');
    await u.click(screen.getByRole('button', { name: 'Record recommendation' }));
    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});

describe('case review (checker)', () => {
  it('offers the decision form only in PENDING_CHECKER and not the correction controls', async () => {
    renderAppAs(
      'COMPLIANCE_OFFICER',
      '/cases/A2000009',
      routes({ ...CASE, status: 'PENDING_CHECKER' }),
    );
    expect(await screen.findByRole('form', { name: 'Checker decision' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Correct /i })).not.toBeInTheDocument();
  });

  it('tells the checker when there is nothing to do', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/cases/A2000009', routes({ ...CASE, status: 'APPROVED' }));
    expect(await screen.findByText(/there is no action for you/)).toBeInTheDocument();
  });
});

describe('AI-5 discrepancy summary', () => {
  it('is generated only on request, labelled AI-generated, and explains when it is not enabled', async () => {
    const calls = renderAppAs('KYC_OFFICER', '/cases/A2000009', {
      ...routes(),
      'GET /api/v1/applications/A2000009/ai-summary': {
        body: {
          label: 'AI-generated',
          application_id: 'A2000009',
          summary: 'R3 fired: pan_number read as ABCPK12 at 0.55.',
          words: 8,
          model: 'anthropic/x',
          prompt_version: 'review-summary-v1',
          generated_at: '2026-10-23T00:00:00Z',
        },
      },
    });
    const button = await screen.findByRole('button', { name: 'Generate AI summary' });
    expect(calls.some((c) => c.key.endsWith('/ai-summary'))).toBe(false);
    await userEvent.click(button);
    const fig = await screen.findByRole('figure', { name: 'AI-generated summary' });
    expect(within(fig).getByText('AI-generated')).toBeInTheDocument();
    expect(within(fig).getByText(/R3 fired/)).toBeInTheDocument();
  });

  it('says when the server has no LLM configured', async () => {
    renderAppAs('KYC_OFFICER', '/cases/A2000009', {
      ...routes(),
      'GET /api/v1/applications/A2000009/ai-summary': {
        status: 503,
        body: {
          error: 'AI_SUMMARY_DISABLED',
          message: 'No LLM is configured for reviewer summaries',
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate AI summary' }));
    expect(
      await screen.findByText('AI summaries are not enabled on this server.'),
    ).toBeInTheDocument();
  });

  it('is not offered for a case the rules did not send to review', async () => {
    renderAppAs(
      'COMPLIANCE_OFFICER',
      '/cases/A2000009',
      routes({
        ...CASE,
        status: 'PENDING_CHECKER',
        evaluation: { ...CASE.evaluation!, decision: 'APPROVE' },
      }),
    );
    await screen.findByRole('heading', { name: /A2000009/ });
    expect(screen.queryByRole('button', { name: 'Generate AI summary' })).not.toBeInTheDocument();
  });
});
