import type { ApplicationStatus, Decision, RiskLevel } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { DECISION_META, RISK_META, STATUS_META } from '@/lib/status';

export const StatusBadge = ({ status }: { status: ApplicationStatus }) => (
  <Badge tone={STATUS_META[status].tone} title={STATUS_META[status].hint}>
    {STATUS_META[status].label}
  </Badge>
);

export const RiskBadge = ({ risk }: { risk: RiskLevel | null }) =>
  risk ? (
    <Badge tone={RISK_META[risk].tone}>{RISK_META[risk].label}</Badge>
  ) : (
    <span className="text-xs text-ink-soft">Not assessed</span>
  );

export const DecisionBadge = ({ decision }: { decision: Decision | null }) =>
  decision ? (
    <Badge tone={DECISION_META[decision].tone}>Rules: {DECISION_META[decision].label}</Badge>
  ) : (
    <span className="text-xs text-ink-soft">Not evaluated</span>
  );
