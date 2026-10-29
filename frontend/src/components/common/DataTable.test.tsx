import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: string;
  name: string;
  amount: number;
  kind: 'A' | 'B';
}
const ROWS: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Person ${String(i + 1).padStart(2, '0')}`,
  amount: (i * 7) % 12,
  kind: i % 2 ? 'A' : 'B',
}));
const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Name', accessor: (r) => r.name, sortable: true },
  { id: 'amount', header: 'Amount', accessor: (r) => r.amount, sortable: true },
];
const table = (rows = ROWS) => (
  <DataTable
    rows={rows}
    columns={COLUMNS}
    getRowId={(r) => r.id}
    caption="People"
    searchLabel="Search people"
    pageSizes={[5, 10]}
    filters={[
      {
        id: 'kind',
        label: 'Kind',
        options: [{ value: 'A', label: 'Kind A' }],
        match: (r, v) => r.kind === v,
      },
    ]}
    emptyTitle="No people"
  />
);
const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row');

describe('DataTable', () => {
  it('paginates and reports the range', async () => {
    render(table());
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText(/Showing 1-5 of 12/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/Showing 6-10 of 12/)).toBeInTheDocument();
  });

  it('searches, shows "No matches" and clears again', async () => {
    render(table());
    await userEvent.type(screen.getByLabelText('Search people'), 'person 07');
    expect(bodyRows()).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText('Search people'));
    await userEvent.type(screen.getByLabelText('Search people'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('filters', async () => {
    render(table());
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'A');
    expect(screen.getByText(/of 6 \(filtered from 12\)/)).toBeInTheDocument();
  });

  it('sorts ascending then descending and exposes aria-sort', async () => {
    render(table());
    const header = screen.getByRole('columnheader', { name: /Amount/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(within(bodyRows()[0]!).getAllByRole('cell')[1]).toHaveTextContent('0');
    await userEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(within(bodyRows()[0]!).getAllByRole('cell')[1]).toHaveTextContent('11');
  });

  it('shows the empty state for no rows', () => {
    render(table([]));
    expect(screen.getByText('No people')).toBeInTheDocument();
  });
});
