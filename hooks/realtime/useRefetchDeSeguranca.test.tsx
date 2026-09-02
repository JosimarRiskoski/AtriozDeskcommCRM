import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRefetchDeSeguranca } from './useRefetchDeSeguranca';

const mocks = vi.hoisted(() => ({ refetchQueries: vi.fn().mockResolvedValue(undefined), getQueryData: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('pauses hidden polling and reconciles immediately on returning', async () => {
  vi.useFakeTimers();
  let visibility = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState);
  renderHook(() => useRefetchDeSeguranca({ queryKey: ['board', 'test'], assinatura: () => 'same', ultimaEntrega: { current: null } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(mocks.refetchQueries).not.toHaveBeenCalled();
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(mocks.refetchQueries).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
  expect(mocks.refetchQueries).toHaveBeenCalledTimes(2);
});
