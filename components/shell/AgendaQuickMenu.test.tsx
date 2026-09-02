import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/calendar/AppointmentDialog', () => ({ AppointmentDialog: () => null }));
import { AgendaQuickMenu } from './AgendaQuickMenu';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves initial badge loading, pauses hidden polling and refreshes on return', async () => {
  vi.useFakeTimers();
  let visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => { render(<AgendaQuickMenu />); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility = 'hidden';
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event('calendar:refresh')); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
