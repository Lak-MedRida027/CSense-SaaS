import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
  score: number;
}
const rows: Row[] = [
  { id: '1', name: 'Amina', score: 80 },
  { id: '2', name: 'Karim', score: 40 },
];
const columns: DataTableColumn<Row, 'name' | 'score'>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name, sortable: true, isRowHeader: true },
  { key: 'score', header: 'Score', render: (r) => `${r.score}%`, sortable: true, align: 'end' },
];

describe('DataTable', () => {
  it('has a caption, row headers and aria-sort on the active column', () => {
    render(
      <DataTable
        caption="Employees"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={() => undefined}
      />,
    );
    expect(screen.getByRole('table', { name: 'Employees' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    expect(screen.getByRole('rowheader', { name: 'Amina' })).toBeDefined();
  });

  it('toggles sort direction via header buttons', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="E"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
    fireEvent.click(screen.getByRole('button', { name: 'Score' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'score', direction: 'asc' });
  });

  it('renders empty, loading and error states', () => {
    const { rerender } = render(
      <DataTable
        caption="E"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyTitle="No matches"
      />,
    );
    expect(screen.getByText('No matches')).toBeDefined();
    rerender(
      <DataTable caption="E" columns={columns} rows={[]} rowKey={(r) => r.id} state="loading" />,
    );
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    rerender(
      <DataTable
        caption="E"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        state="error"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <DataTable
        caption="Employees"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'score', direction: 'desc' }}
        onSortChange={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
