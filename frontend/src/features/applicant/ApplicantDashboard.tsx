import { Link } from 'react-router';
import { listMine } from '@/api/client';
import { STATUSES, type ListItem } from '@/api/types';
import { DataTable, type Column } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDateTime } from '@/lib/format';
import { STATUS_META } from '@/lib/status';

/** Presentation hint only: what the applicant can do next. The backend decides what is actually allowed. */
function nextStep(a: ListItem): string {
  if (a.status === 'SUBMITTED') return 'Upload your documents and submit';
  if (a.status === 'RESUBMISSION_REQUESTED')
    return a.resubmission_deadline
      ? `Upload new documents by ${formatDateTime(a.resubmission_deadline)}`
      : 'Upload new documents';
  return STATUS_META[a.status].hint;
}

export function ApplicantDashboard() {
  const mine = useAsync(() => listMine(), []);
  const columns: Column<ListItem>[] = [
    {
      id: 'id',
      header: 'Application',
      accessor: (a) => a.application_id,
      sortable: true,
      cell: (a) => (
        <Link
          className="font-medium text-forest underline-offset-2 hover:underline"
          to={`/applications/${a.application_id}`}
        >
          {a.application_id}
        </Link>
      ),
    },
    { id: 'name', header: 'Name', accessor: (a) => a.full_name, sortable: true },
    {
      id: 'date',
      header: 'Applied on',
      accessor: (a) => a.application_date,
      sortable: true,
      cell: (a) => formatDate(a.application_date),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (a) => STATUS_META[a.status].label,
      sortable: true,
      cell: (a) => <StatusBadge status={a.status} />,
    },
    { id: 'next', header: 'Next step', accessor: nextStep },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Applicant"
        title="My applications"
        description="Track each application, see why it needs attention, and upload documents when they are requested."
        actions={
          <Button asChild>
            <Link to="/applications/new">New application</Link>
          </Button>
        }
      />
      {mine.status === 'loading' && <LoadingState label="Loading your applications" />}
      {mine.status === 'error' && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {mine.status === 'success' &&
        (mine.data.applications.length === 0 ? (
          <EmptyState
            title="You have no applications yet"
            hint="Open a savings account in a few minutes: fill in the form, upload your documents and submit."
            action={
              <Button asChild>
                <Link to="/applications/new">Start an application</Link>
              </Button>
            }
          />
        ) : (
          <DataTable
            rows={mine.data.applications}
            columns={columns}
            getRowId={(a) => a.application_id}
            caption="Your applications"
            searchLabel="Search applications"
            searchPlaceholder="Application number or name"
            initialSort={{ column: 'date', direction: 'desc' }}
            filters={[
              {
                id: 'status',
                label: 'Status',
                options: STATUSES.filter((s) =>
                  mine.data.applications.some((a) => a.status === s),
                ).map((s) => ({ value: s, label: STATUS_META[s].label })),
                match: (a, v) => a.status === v,
              },
            ]}
          />
        ))}
    </>
  );
}
