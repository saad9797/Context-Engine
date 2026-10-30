let status = 'idle';
const listeners = new Set();

export const getBackendStatus = () => status;
export function subscribeBackendStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function updateBackendStatus(next) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}
