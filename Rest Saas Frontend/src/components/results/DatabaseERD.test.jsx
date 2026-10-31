import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import DatabaseERD from './DatabaseERD';
import { buildERD, layoutERD, columnNames } from './erdModel';

afterEach(cleanup);

it('renders the exact legacy unique-constraint shape from the reported join crash', () => {
  const legacy = { tables: [{ schema: 'public', name: 'accounts', columns: [{ name: 'email', type: 'text' }, { name: 'tenant_id', type: 'uuid' }], primary_keys: '{}', unique_constraints: [{ name: 'account_email', columns: '{tenant_id,email}' }] }] };
  render(<DatabaseERD database={legacy} />);
  expect(screen.getByText('public.accounts')).toBeInTheDocument();
  expect(screen.getAllByText(/unique constraints: tenant_id \+ email/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keys only' }));
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
  expect(screen.getByText('public.users')).toBeInTheDocument();
  expect(screen.getByText('user_id')).toBeInTheDocument();
  expect(screen.getByText('FK', { exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keys only' }));
  expect(screen.queryByText('note', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('user_id')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Focus table public.orders' }));
  expect(screen.getByText(/Explain selected relationships/)).toBeInTheDocument();
});

it('filters tables and handles searches without matches', () => {
  render(<DatabaseERD database={database} />);
  fireEvent.change(screen.getByLabelText('Find a table'), { target: { value: 'orders' } });
  expect(screen.getByText('public.orders')).toBeInTheDocument();
  expect(screen.queryByText('public.users')).not.toBeInTheDocument();
  expect(screen.getByText(/1 of 2 tables/)).toHaveTextContent('0 of 1 field relationships shown');
  fireEvent.change(screen.getByLabelText('Find a table'), { target: { value: 'absent' } });
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
  expect(screen.getByText('public.legacy')).toBeInTheDocument();
  expect(screen.getByText('No columns captured')).toBeInTheDocument();
});
