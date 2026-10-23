import { beforeEach, expect, it } from 'vitest';
import { rememberReturnPath, safeReturnPath, takeReturnPath } from './authReturn';

beforeEach(() => sessionStorage.clear());

it('preserves protected deep links and consumes the login return once', () => {
  rememberReturnPath({ pathname: '/contexts/project/claude-context', search: '?view=source' });
  expect(takeReturnPath()).toBe('/contexts/project/claude-context?view=source');
  expect(takeReturnPath()).toBe('/dashboard');
});

it('rejects external redirects, auth loops and malformed paths', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/register', '/%2f%2fevil.example', '/dashboard\n']) {
    expect(safeReturnPath(path)).toBeNull();
  }
  expect(safeReturnPath('/dashboard#token=private')).toBe('/dashboard');
});
