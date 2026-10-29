import { useId, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  header: string;
  /** Value used for sorting and (by default) searching. */
  accessor: (row: T) => string | number | null;
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
}

export interface FilterDef<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  caption: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchText?: (row: T) => string;
  filters?: FilterDef<T>[];
  pageSizes?: number[];
  initialSort?: { column: string; direction: 'asc' | 'desc' };
  emptyTitle?: string;
  emptyHint?: string;
}

const compare = (a: string | number | null, b: string | number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1; // empty values sort last
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true });
};

/** Table with search, filters, sortable columns and pagination, all on the rows the backend returned. */
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  caption,
  searchLabel = 'Search',
  searchPlaceholder = 'Search…',
  searchText,
  filters = [],
  pageSizes = [10, 25, 50],
  initialSort,
  emptyTitle = 'Nothing to show',
  emptyHint,
}: Props<T>) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(
    initialSort ?? null,
  );
  const [pageSize, setPageSize] = useState(pageSizes[0] ?? 10);
  const [page, setPage] = useState(0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((row) => {
      if (q) {
        const text = searchText
          ? searchText(row)
          : columns.map((c) => c.accessor(row) ?? '').join(' ');
        if (!text.toLowerCase().includes(q)) return false;
      }
      return filters.every(
        (f) => !filterValues[f.id] || f.match(row, filterValues[f.id] as string),
      );
    });
    const column = sort && columns.find((c) => c.id === sort.column);
    if (sort && column)
      out = [...out].sort(
        (a, b) =>
          (sort.direction === 'asc' ? 1 : -1) * compare(column.accessor(a), column.accessor(b)),
      );
    return out;
  }, [rows, query, filterValues, sort, columns, filters, searchText]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * pageSize, current * pageSize + pageSize);

  function toggleSort(id: string) {
    setSort((s) =>
      s?.column !== id
        ? { column: id, direction: 'asc' }
        : s.direction === 'asc'
          ? { column: id, direction: 'desc' }
          : null,
    );
    setPage(0);
  }

  return (
    <section aria-label={caption} className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-52 flex-1 gap-1">
          <label htmlFor={`${uid}-search`} className="text-xs font-medium text-ink-soft">
            {searchLabel}
          </label>
          <Input
            id={`${uid}-search`}
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        {filters.map((f) => (
          <div key={f.id} className="grid gap-1">
            <label htmlFor={`${uid}-${f.id}`} className="text-xs font-medium text-ink-soft">
              {f.label}
            </label>
            <Select
              id={`${uid}-${f.id}`}
              value={filterValues[f.id] ?? ''}
              onChange={(e) => {
                setFilterValues((v) => ({ ...v, [f.id]: e.target.value }));
                setPage(0);
              }}
            >
              <option value="">All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? emptyTitle : 'No matches'}
          hint={rows.length === 0 ? emptyHint : 'Try a different search or clear the filters.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="border-b border-line bg-ivory text-xs text-ink-soft uppercase">
              <tr>
                {columns.map((c) => {
                  const active = sort?.column === c.id;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={
                        active
                          ? sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : c.sortable
                            ? 'none'
                            : undefined
                      }
                      className={cn(
                        'px-4 py-2.5 font-semibold',
                        c.align === 'right' && 'text-right',
                      )}
                    >
                      {c.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.id)}
                          className="inline-flex items-center gap-1 uppercase hover:text-ink"
                        >
                          {c.header}
                          <span aria-hidden>
                            {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((row) => (
                <tr key={getRowId(row)} className="hover:bg-ivory/60">
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        'px-4 py-3 align-top',
                        c.align === 'right' && 'text-right tabular',
                      )}
                    >
                      {c.cell ? c.cell(row) : (c.accessor(row) ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
          <p aria-live="polite">
            Showing {current * pageSize + 1}-
            {Math.min(visible.length, current * pageSize + pageSize)} of {visible.length}
            {visible.length !== rows.length ? ` (filtered from ${rows.length})` : ''}
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor={`${uid}-size`} className="text-xs">
              Rows
            </label>
            <Select
              id={`${uid}-size`}
              className="h-8 w-20"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span className="tabular text-xs">
              Page {current + 1} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
