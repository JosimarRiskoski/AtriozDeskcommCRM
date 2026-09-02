export interface ConversationCounts {
  unassigned: number;
  automatic: number;
  mine: number;
  all: number;
}

type InboxCountsRow = {
  u: number | string | null;
  a: number | string | null;
  m: number | string | null;
  t: number | string | null;
};

type InboxCountsRpcClient = {
  rpc: (
    functionName: "fn_inbox_counts",
    args: { p_org: string },
  ) => PromiseLike<{ data: InboxCountsRow | null; error: { message: string } | null }>;
};

function count(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Uma agregação RLS-scoped no banco substitui as quatro consultas `count: exact`
 * que o Inbox executava em paralelo. A função é SECURITY INVOKER: o escopo do
 * membro continua definido pelas policies de conversations/channel_sessions.
 */
export async function loadConversationCounts(
  supabase: InboxCountsRpcClient,
  organizationId: string,
): Promise<ConversationCounts> {
  const { data, error } = await supabase.rpc("fn_inbox_counts", { p_org: organizationId });
  if (error) throw error;

  const row = data;
  return {
    unassigned: count(row?.u),
    automatic: count(row?.a),
    mine: count(row?.m),
    all: count(row?.t),
  };
}
