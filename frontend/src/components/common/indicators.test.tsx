import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfidenceMeter } from './ConfidenceMeter';
import { DecisionBadge, RiskBadge, StatusBadge } from './StatusBadge';

describe('indicators', () => {
  it('marks a confidence below the configured limit with text, not just colour', () => {
    render(<ConfidenceMeter value={0.62} limit={0.8} />);
    expect(screen.getByText('0.62')).toBeInTheDocument();
    expect(screen.getByText(/below 0\.80/)).toBeInTheDocument();
  });

  it('does not flag a confidence at the limit', () => {
    render(<ConfidenceMeter value={0.8} limit={0.8} />);
    expect(screen.queryByText(/below/)).not.toBeInTheDocument();
  });

  it('labels statuses, risk and decisions; missing values say so', () => {
    render(
      <>
        <StatusBadge status="PENDING_CHECKER" />
        <RiskBadge risk="HIGH" />
        <RiskBadge risk={null} />
        <DecisionBadge decision="REVIEW" />
        <DecisionBadge decision={null} />
      </>,
    );
    expect(screen.getByText('Awaiting checker')).toBeInTheDocument();
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.getByText('Rules: Review')).toBeInTheDocument();
    expect(screen.getByText('Not evaluated')).toBeInTheDocument();
  });
});
