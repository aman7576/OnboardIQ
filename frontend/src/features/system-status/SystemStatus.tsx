import { useCallback, useEffect, useState } from 'react';
import { fetchDatabaseHealth, fetchServiceHealth } from '@/api/health';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill, type Tone } from '@/components/ui/status-pill';

interface Check {
  tone: Tone;
  label: string;
  detail: string;
}

const CHECKING: Check = { tone: 'wait', label: 'Checking', detail: '' };

function StatusRow({ name, check }: { name: string; check: Check }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="tabular min-h-4 font-mono text-xs text-ink-soft">{check.detail}</p>
      </div>
      <StatusPill tone={check.tone}>{check.label}</StatusPill>
    </div>
  );
}

export function SystemStatus() {
  const [api, setApi] = useState<Check>(CHECKING);
  const [db, setDb] = useState<Check>(CHECKING);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const { body } = await fetchServiceHealth();
      setApi({ tone: 'good', label: 'Up', detail: `v${body.version} · ${body.environment}` });
    } catch {
      setApi({ tone: 'bad', label: 'Down', detail: 'Backend not reachable' });
    }
    try {
      const { httpStatus, body } = await fetchDatabaseHealth();
      setDb(
        httpStatus === 200
          ? { tone: 'good', label: 'Up', detail: `${body.latencyMs ?? 0} ms` }
          : { tone: 'bad', label: 'Down', detail: body.message ?? 'Database unreachable' },
      );
    } catch {
      setDb({ tone: 'bad', label: 'Down', detail: 'No answer from backend' });
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    // Initial load on mount; state updates happen after the awaited fetches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <Card aria-labelledby="system-status-title">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle id="system-status-title">System status</CardTitle>
          <CardDescription>Backend and database health</CardDescription>
        </div>
        <Button variant="outline" size="sm" loading={busy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <StatusRow name="Backend API" check={api} />
        <StatusRow name="PostgreSQL" check={db} />
      </CardContent>
    </Card>
  );
}
