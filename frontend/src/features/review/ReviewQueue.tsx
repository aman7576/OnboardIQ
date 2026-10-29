import { Link } from 'react-router';
import { getQueue } from '@/api/client';
import type { QueueItem, RiskLevel } from '@/api/types';
import { DataTable, type Column } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import { DecisionBadge, RiskBadge, StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDateTime, humanize } from '@/lib/format';

const RISK_RANK: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** One queue screen for both roles: the backend returns the right queue for the signed-in user. */
export function ReviewQueue({ mode }: { mode: 'officer' | 'checker' }) {
  const queue = useAsync(() => getQueue(), [mode]);
  const columns: Column<QueueItem>[] = [
    {
      id: 'id',
      header: 'Case',
      accessor: (a) => a.application_id,
      sortable: true,
      cell: (a) => (
        <Link
          className="font-medium text-forest underline-offset-2 hover:underline"
          to={`/cases/${a.application_id}`}
        >
          {a.application_id}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Applicant',
      accessor: (a) => a.full_name,
      sortable: true,
      cell: (a) => (
        <span>
          {a.full_name}
          <span className="block text-xs text-ink-soft">PAN {a.pan_masked}</span>
        </span>
      ),
    },
    {
      id: 'risk',
      header: 'Risk',
      accessor: (a) => (a.risk_category ? RISK_RANK[a.risk_category] : 9),
      sortable: true,
      cell: (a) => <RiskBadge risk={a.risk_category} />,
    },
    {
      id: 'decision',
      header: 'Rules result',
      accessor: (a) => a.decision ?? '',
      sortable: true,
      cell: (a) => <DecisionBadge decision={a.decision} />,
    },
    {
      id: 'reasons',
      header: 'Reasons',
      accessor: (a) => a.reason_codes.join(' '),
      cell: (a) =>
        a.reason_codes.length ? (
          <span className="flex flex-wrap gap-1">
            {a.reason_codes.map((c) => (
              <Badge key={c} tone="neutral" title={c}>
                {humanize(c)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-xs text-ink-soft">None</span>
        ),
    },
    {
      id: 'waiting',
      header: 'Waiting since',
      accessor: (a) => a.waiting_since,
      sortable: true,
      cell: (a) => formatDateTime(a.waiting_since),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (a) => a.status,
      cell: (a) => <StatusBadge status={a.status} />,
    },
    {
      id: 'applied',
      header: 'Applied',
      accessor: (a) => a.application_date,
      sortable: true,
      cell: (a) => formatDate(a.application_date),
    },
  ];
  const title = mode === 'officer' ? 'Review queue' : 'Checker queue';

  return (
    <>
      <PageHeader
        eyebrow={mode === 'officer' ? 'KYC officer' : 'Compliance officer'}
        title={title}
        description={
          mode === 'officer'
            ? 'Cases the rules sent to a person, highest risk first, then the longest waiting.'
            : 'Cases that need a second person to approve, reject or send back.'
        }
      />
      {queue.status === 'loading' && <LoadingState label={`Loading the ${title.toLowerCase()}`} />}
      {queue.status === 'error' && <ErrorState error={queue.error} onRetry={queue.reload} />}
      {queue.status === 'success' && (
        <DataTable
          rows={queue.data.applications}
          columns={columns}
          getRowId={(a) => a.application_id}
          caption={title}
          searchLabel="Search cases"
          searchPlaceholder="Case, name or reason"
          searchText={(a) =>
            `${a.application_id} ${a.full_name} ${a.pan_masked} ${a.reason_codes.join(' ')}`
          }
          emptyTitle="The queue is empty"
          emptyHint="There is nothing waiting for you right now."
          filters={[
            {
              id: 'risk',
              label: 'Risk',
              options: [
                { value: 'HIGH', label: 'High' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'LOW', label: 'Low' },
                { value: 'NONE', label: 'Not assessed' },
              ],
              match: (a, v) => (v === 'NONE' ? a.risk_category === null : a.risk_category === v),
            },
            {
              id: 'decision',
              label: 'Rules result',
              options: [
                { value: 'APPROVE', label: 'Approve' },
                { value: 'REVIEW', label: 'Review' },
                { value: 'REJECT', label: 'Reject' },
              ],
              match: (a, v) => a.decision === v,
            },
          ]}
        />
      )}
    </>
  );
}
