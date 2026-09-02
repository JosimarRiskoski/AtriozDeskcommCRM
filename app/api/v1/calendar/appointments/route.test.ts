import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ role: vi.fn(), client: vi.fn(), admin: vi.fn(), sync: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/calendar/sync', () => ({ syncGoogleCalendar: mocks.sync }));
import { GET } from './route';

const request = { url: 'https://crm.test/api/v1/calendar/appointments?from=2026-09-01&until=2026-09-30' } as NextRequest;
beforeEach(() => vi.resetAllMocks());

describe('calendar local read', () => {
  it('returns saved appointments without accessing Google or an admin client', async () => {
    const appointment = { id: 'saved', assigned_user_id: 'owner', meet_url: 'https://meet.google.com/test' };
    const chain = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), order: vi.fn() };
    for (const key of ['select', 'eq', 'gte', 'lte'] as const) chain[key].mockReturnValue(chain);
    chain.order.mockResolvedValue({ data: [appointment], error: null });
    const from = vi.fn().mockReturnValue(chain);
    mocks.role.mockResolvedValue({ ok: true, org: { orgId: 'org-authorized' } });
    mocks.client.mockResolvedValue({ from });
    mocks.admin.mockImplementation(() => { throw new Error('Google unavailable: no admin work allowed on reads'); });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([appointment]);
    expect(from).toHaveBeenCalledWith('calendar_appointments');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-authorized');
    expect(chain.gte).toHaveBeenCalledWith('starts_at', '2026-09-01');
    expect(chain.lte).toHaveBeenCalledWith('starts_at', '2026-09-30');
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('keeps authorization before any database read', async () => {
    mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(request)).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
