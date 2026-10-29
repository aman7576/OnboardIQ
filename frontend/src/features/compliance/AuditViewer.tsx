import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { downloadAuditCsv, getAudit } from '@/api/client';
import type { AuditEventView } from '@/api/types';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Field } from '@/components/common/Field';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { useToast } from '@/components/toast/toast-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime, humanize } from '@/lib/format';

function Details({ e }: { e: AuditEventView }) {
  const [open, setOpen] = useState(false);
  const has = e.before !== null || e.after !== null || e.details !== null;
  if (!has) return <span className="text-xs text-ink-soft">-</span>;
  return (
    <div>
      <button
        type="button"
        className="text-xs font-medium text-forest underline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} details
      </button>
      {open && (
        <pre className="mt-1 max-w-md overflow-auto rounded-md bg-ivory p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
          {JSON.stringify({ before: e.before, after: e.after, details: e.details }, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** The full history of one application: status changes, decisions, corrections, document views, access denials. */
export function AuditViewer() {
  const [params, setParams] = useSearchParams();
  const applicationId = params.get('application') ?? '';
  const [draft, setDraft] = useState(applicationId);
  const toast = useToast();
  const audit = useAsync(
    () => (applicationId ? getAudit(applicationId) : Promise.resolve(null)),
    [applicationId],
  );

  function search(e: FormEvent) {
    e.preventDefault();
    setParams(draft.trim() ? { application: draft.trim() } : {});
  }

  async function exportCsv() {
    try {
      const blob = await downloadAuditCsv(applicationId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_${applicationId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Audit trail exported.');
    } catch {
      toast.error('The export failed.');
    }
  }

  const columns: Column<AuditEventView>[] = [
    {
      id: 'at',
      header: 'When (IST)',
      accessor: (e) => e.at,
      sortable: true,
      cell: (e) => <span className="tabular whitespace-nowrap">{formatDateTime(e.at)}</span>,
    },
    {
      id: 'type',
      header: 'Event',
      accessor: (e) => e.type,
      sortable: true,
      cell: (e) => (
        <Badge
          tone={e.type === 'ACCESS_DENIED' || e.type === 'LOGIN_FAILED' ? 'danger' : 'neutral'}
        >
          {humanize(e.type)}
        </Badge>
      ),
    },
    {
      id: 'actor',
      header: 'By',
      accessor: (e) => e.actor_name ?? e.actor_role,
      sortable: true,
      cell: (e) => (
        <span>
          {e.actor_name ?? humanize(e.actor_role)}
          <span className="block text-xs text-ink-soft">{humanize(e.actor_role)}</span>
        </span>
      ),
    },
    {
      id: 'doc',
      header: 'Document',
      accessor: (e) => e.doc_id,
      cell: (e) => <span className="font-mono text-xs">{e.doc_id ?? '-'}</span>,
    },
    { id: 'details', header: 'Details', accessor: () => null, cell: (e) => <Details e={e} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Compliance officer"
        title="Audit trail"
        description="Every status change, decision, correction and document view of one application, oldest first. Records cannot be edited or deleted."
        actions={
          applicationId &&
          audit.status === 'success' &&
          audit.data &&
          audit.data.events.length > 0 ? (
            <Button variant="outline" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          ) : undefined
        }
      />
      <form
        onSubmit={search}
        className="mb-6 flex max-w-xl flex-wrap items-end gap-3"
        aria-label="Find an application"
      >
        <div className="min-w-56 flex-1">
          <Field id="application" label="Application number">
            <Input
              value={draft}
              placeholder="For example A2000001"
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit">Show history</Button>
      </form>
      {!applicationId && (
        <EmptyState
          title="Enter an application number"
          hint="The history of that application will appear here."
        />
      )}
      {applicationId && audit.status === 'loading' && (
        <LoadingState label="Loading the audit trail" />
      )}
      {applicationId && audit.status === 'error' && (
        <ErrorState error={audit.error} onRetry={audit.reload} />
      )}
      {applicationId && audit.status === 'success' && audit.data && (
        <DataTable
          rows={audit.data.events}
          columns={columns}
          getRowId={(e) => e.id}
          caption={`Audit trail of ${applicationId}`}
          searchLabel="Search events"
          searchPlaceholder="Event, person or document"
          searchText={(e) => `${e.type} ${e.actor_name ?? ''} ${e.actor_role} ${e.doc_id ?? ''}`}
          pageSizes={[25, 50, 100]}
          initialSort={{ column: 'at', direction: 'asc' }}
          emptyTitle={`No events for ${applicationId}`}
          emptyHint="Check the application number."
          filters={[
            {
              id: 'type',
              label: 'Event',
              options: [...new Set(audit.data.events.map((e) => e.type))]
                .sort()
                .map((t) => ({ value: t, label: humanize(t) })),
              match: (e, v) => e.type === v,
            },
          ]}
        />
      )}
    </>
  );
}
