import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import DatabaseERD from './DatabaseERD';
import { buildERD, layoutERD, columnNames, searchERD } from './erdModel';
import { fitCamera, zoomCamera } from './useDiagramCanvas';

afterEach(cleanup);

it('searches columns, types, defaults, notes and captured enum values', () => {
  const model = buildERD({ tables: [{ name: 'orders', columns: [{ name: 'status', type: 'USER-DEFINED', udt: 'order_status', default: 'pending', comment: 'Fulfilment stage' }] }], enums: [{ name: 'order_status', values: ['paid', 'cancelled'] }] });
  for (const query of ['status', 'order_status', 'pending', 'fulfilment', 'cancelled']) {
    expect(searchERD(model, query)[0].matches[0].name).toBe('status');
  }
  expect(searchERD(model, 'not present')).toEqual([]);
});

it('keeps the board stable while searching and jumps directly to a matching column', () => {
  render(<DatabaseERD database={database} />);
  const board = screen.getByLabelText('Interactive database diagram canvas');
  const before = board.querySelector('svg').getAttribute('viewBox');
  fireEvent.change(screen.getByLabelText('Search schema'), { target: { value: 'user_id' } });
  expect(board.querySelector('svg').getAttribute('viewBox')).toBe(before);
  expect(screen.getByRole('button', { name: 'Focus table public.users' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Explore column public.orders.user_id' }));
  expect(board.querySelector('svg').getAttribute('viewBox')).not.toBe(before);
  expect(screen.getByLabelText('Table inspector')).toHaveTextContent('public.orders');
});

it('reduces large schemas to keys initially and can focus just a table neighborhood', () => {
  const large = { ...database, tables: [...database.tables, ...Array.from({ length: 15 }, (_, i) => ({ name: `extra_${i}`, columns: [{ name: 'description', type: 'text' }] }))] };
  render(<DatabaseERD database={large} />);
  expect(screen.getByRole('button', { name: 'Keys only' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Focus table public.orders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Focus related tables' }));
  expect(screen.getByText(/2 of 17 tables/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fit all tables' }));
  expect(screen.getByText(/17 of 17 tables/)).toBeInTheDocument();
});

it('fits a large schema on a compact board without overlapping table cards', () => {
  const model = buildERD({ tables: Array.from({ length: 77 }, (_, i) => ({ name: `table_${i}`, columns: Array.from({ length: 10 }, (_, j) => ({ name: `field_${j}` })) })) });
  const layout = layoutERD(model);
  const positions = Object.values(layout.positions);
  expect(positions).toHaveLength(77);
  expect(layout.height / layout.width).toBeLessThan(2);
  for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
    const first = positions[a], second = positions[b];
    expect(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y).toBe(true);
  }
  const camera = fitCamera(layout, { width: 1000, height: 640 });
  expect(camera.x).toBeLessThanOrEqual(0);
  expect(camera.y).toBeLessThanOrEqual(0);
  expect(camera.x + 1000 / camera.scale).toBeGreaterThanOrEqual(layout.width);
  expect(camera.y + 640 / camera.scale).toBeGreaterThanOrEqual(layout.height);
});

it('zooms around the cursor without moving its world position', () => {
  const before = { x: 30, y: 40, scale: .2 }, point = { x: 300, y: 200 };
  const after = zoomCamera(before, 2, point);
  expect(after.x + point.x / after.scale).toBeCloseTo(before.x + point.x / before.scale);
  expect(after.y + point.y / after.scale).toBeCloseTo(before.y + point.y / before.scale);
});

it('offers a single fitted canvas, zoom controls and expanded mode', () => {
  render(<DatabaseERD database={database} />);
  const board = screen.getByLabelText('Interactive database diagram canvas');
  const svg = board.querySelector('svg');
  const fitted = svg.getAttribute('viewBox');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom ERD in' }));
  expect(svg.getAttribute('viewBox')).not.toBe(fitted);
  fireEvent.click(screen.getByRole('button', { name: 'Fit all tables' }));
  expect(svg.getAttribute('viewBox')).toBe(fitted);
  expect(screen.getByRole('button', { name: 'Database overview minimap' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expand board' }));
  expect(screen.getByRole('button', { name: 'Exit expanded view' })).toBeInTheDocument();
  fireEvent.keyDown(board, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Expand board' })).toBeInTheDocument();
});

it('renders the exact legacy unique-constraint shape from the reported join crash', () => {
  const legacy = { tables: [{ schema: 'public', name: 'accounts', columns: [{ name: 'email', type: 'text' }, { name: 'tenant_id', type: 'uuid' }], primary_keys: '{}', unique_constraints: [{ name: 'account_email', columns: '{tenant_id,email}' }] }] };
  render(<DatabaseERD database={legacy} />);
  expect(screen.getByRole('button', { name: 'Focus table public.accounts' })).toBeInTheDocument();
  expect(screen.getAllByText(/unique constraints: tenant_id \+ email/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Keys only' }));
  expect(screen.getByText('email', { exact: true })).toBeInTheDocument();
});

it('normalizes quoted Postgres identifiers, JSON arrays, and scalar column names', () => {
  expect(columnNames('{"tenant,id",email}')).toEqual(['tenant,id', 'email']);
  expect(columnNames('["id","email"]')).toEqual(['id', 'email']);
  expect(columnNames('email')).toEqual(['email']);
  expect(columnNames(null)).toEqual([]);
});
const database = { tables: [
  { schema: 'public', name: 'users', primary_keys: ['id'], columns: [{ name: 'id', type: 'integer', nullable: false }, { name: 'name', type: 'text', nullable: true }] },
  { schema: 'public', name: 'orders', primary_keys: ['id'], columns: [{ name: 'id', type: 'integer' }, { name: 'user_id', type: 'integer' }, { name: 'note', type: 'text' }], foreign_keys: [{ constraint: 'orders_user', column: 'user_id', references: { schema: 'public', table: 'users', column: 'id' } }] },
], relationship_graph: [{ from: 'public.orders', from_column: 'user_id', to: 'public.users', to_column: 'id' }] };

it('deduplicates graph references and attaches arrows to actual field rows', () => {
  const model = buildERD(database);
  expect(model.relationships).toHaveLength(1);
  const layout = layoutERD(model);
  const edge = layout.edges[0];
  expect(edge.fromColumn).toBe('user_id');
  expect(edge.toColumn).toBe('id');
  expect(edge.d).not.toMatch(/NaN|undefined/);
  expect(layout.positions['public.orders'].columns).toHaveLength(3);
});

it('renders columns, keys and declared relationships; keys-only preserves endpoints', () => {
  render(<DatabaseERD database={database} />);
  expect(screen.getByRole('button', { name: 'Focus table public.users' })).toBeInTheDocument();
  expect(screen.getByText('user_id')).toBeInTheDocument();
  expect(screen.getByText('FK', { exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keys only' }));
  expect(screen.queryByText('note', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('user_id')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Focus table public.orders' }));
  expect(screen.getByText(/Explain selected relationships/)).toBeInTheDocument();
});

it('filters tables and handles searches without matches', () => {
  render(<DatabaseERD database={database} />);
  fireEvent.change(screen.getByLabelText('Search schema'), { target: { value: 'orders' } });
  expect(screen.getByRole('button', { name: 'Focus table public.orders' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Focus table public.users' })).toBeInTheDocument();
  expect(screen.getByText(/2 of 2 tables/)).toHaveTextContent('1 of 1 field relationships shown');
  fireEvent.change(screen.getByLabelText('Search schema'), { target: { value: 'absent' } });
  expect(screen.getByText(/No tables match/)).toBeInTheDocument();
});

it('keeps composite keys, self references and missing external tables without guessing', () => {
  const model = buildERD({ tables: [{ schema: 'a', name: 'items', columns: [{ name: 'id' }, { name: 'group' }, { name: 'parent' }], primary_keys: ['id', 'group'], foreign_keys: [
    { column: 'parent', references: { schema: 'a', table: 'items', column: 'id' } },
    { column: 'group', references: { schema: 'outside', table: 'groups', column: 'id' } },
  ] }] });
  expect(model.relationships).toHaveLength(2);
  expect(model.relationships.filter(edge => !edge.available)).toHaveLength(1);
  const layout = layoutERD(model, '', true);
  expect(layout.edges).toHaveLength(1);
  expect(layout.positions['a.items'].columns.map(column => column.name)).toEqual(['id', 'group', 'parent']);
  expect(layout.edges[0].d).not.toMatch(/NaN/);
});

it('does not resolve an explicit schema to a similarly named table in another schema', () => {
  const model = buildERD({ tables: [{ schema: 'a', name: 'users', foreign_keys: [{ column: 'other', references: { schema: 'b', table: 'users', column: 'id' } }] }] });
  expect(model.relationships[0].available).toBe(false);
});

it('shows an actionable empty state for snapshots without a relational database', () => {
  render(<DatabaseERD />);
  expect(screen.getByText(/Connect PostgreSQL or MySQL/)).toBeInTheDocument();
});

it('handles explicitly null databases and incomplete legacy schema arrays', () => {
  const view = render(<DatabaseERD database={null} />);
  expect(screen.getByText(/No relational database tables/)).toBeInTheDocument();
  view.rerender(<DatabaseERD database={{ tables: [null, { schema: 'public', name: 'legacy', columns: null, primary_keys: null, foreign_keys: null, unique_constraints: null }], relationship_graph: null }} />);
  expect(screen.getByRole('button', { name: 'Focus table public.legacy' })).toBeInTheDocument();
  expect(screen.getByText('No columns captured')).toBeInTheDocument();
});
