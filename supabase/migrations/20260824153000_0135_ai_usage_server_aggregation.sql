-- 0135: agrega o painel de uso da IA dentro do Postgres.
-- Evita transferir dezenas de milhares de invocações/mensagens/eventos para o
-- servidor web apenas para calcular totais e séries diárias.

create or replace function public.fn_ai_usage_summary(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_agent_id uuid default null,
  p_invocation_kind text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  with days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to),
      interval '1 day'
    )::date as day
  ),
  inv as (
    select
      created_at::date as day,
      invocation_kind,
      coalesce(cost_cents, 0)::bigint as cost_cents,
      coalesce(total_tokens, coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))::bigint as tokens,
      latency_ms
    from public.ai_invocations
    where organization_id = p_organization_id
      and created_at >= p_from and created_at <= p_to
      and (p_agent_id is null or agent_id = p_agent_id)
      and (p_invocation_kind is null or invocation_kind = p_invocation_kind)
  ),
  inv_daily as (
    select
      day,
      sum(cost_cents)::bigint as cost_cents,
      sum(tokens)::bigint as tokens,
      count(*)::bigint as invocations,
      coalesce(percentile_cont(0.5) within group (order by latency_ms) filter (where latency_ms > 0), 0)::bigint as p50,
      coalesce(percentile_cont(0.95) within group (order by latency_ms) filter (where latency_ms > 0), 0)::bigint as p95
    from inv group by day
  ),
  inbound_daily as (
    select created_at::date as day, count(*)::bigint as amount
    from public.messages
    where organization_id = p_organization_id
      and direction = 'inbound'
      and created_at >= p_from and created_at <= p_to
    group by created_at::date
  ),
  handoff_daily as (
    select created_at::date as day, count(*)::bigint as amount
    from public.event_log
    where organization_id = p_organization_id
      and event_type = 'ai.handoff_triggered'
      and created_at >= p_from and created_at <= p_to
    group by created_at::date
  ),
  daily as (
    select
      d.day,
      coalesce(i.cost_cents, 0) as cost_cents,
      coalesce(i.tokens, 0) as tokens,
      coalesce(i.invocations, 0) as invocations,
      coalesce(i.p50, 0) as p50,
      coalesce(i.p95, 0) as p95,
      coalesce(ib.amount, 0) as inbounds,
      coalesce(h.amount, 0) as handoffs
    from days d
    left join inv_daily i using (day)
    left join inbound_daily ib using (day)
    left join handoff_daily h using (day)
  ),
  by_kind as (
    select coalesce(jsonb_object_agg(invocation_kind, amount), '{}'::jsonb) as value
    from (select invocation_kind, count(*)::bigint as amount from inv group by invocation_kind) x
  ),
  totals as (
    select
      coalesce(sum(cost_cents), 0)::bigint as cost_cents,
      coalesce(sum(tokens), 0)::bigint as total_tokens,
      count(*)::bigint as invocations,
      coalesce(percentile_cont(0.5) within group (order by latency_ms) filter (where latency_ms > 0), 0)::bigint as p50,
      coalesce(percentile_cont(0.95) within group (order by latency_ms) filter (where latency_ms > 0), 0)::bigint as p95
    from inv
  ),
  message_totals as (
    select coalesce(sum(inbounds), 0)::numeric as inbounds, coalesce(sum(handoffs), 0)::numeric as handoffs
    from daily
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', to_char(date_trunc('day', p_from), 'YYYY-MM-DD'), 'to', to_char(date_trunc('day', p_to), 'YYYY-MM-DD')),
    'totals', jsonb_build_object(
      'cost_cents', t.cost_cents,
      'total_tokens', t.total_tokens,
      'invocations', t.invocations,
      'p50_latency_ms', t.p50,
      'p95_latency_ms', t.p95,
      'handoff_rate', case when mt.inbounds > 0 then round(mt.handoffs / mt.inbounds, 4) else 0 end
    ),
    'series', jsonb_build_object(
      'cost_cents', (select jsonb_agg(jsonb_build_object('day', day, 'value', cost_cents) order by day) from daily),
      'total_tokens', (select jsonb_agg(jsonb_build_object('day', day, 'value', tokens) order by day) from daily),
      'p50_latency_ms', (select jsonb_agg(jsonb_build_object('day', day, 'value', p50) order by day) from daily),
      'p95_latency_ms', (select jsonb_agg(jsonb_build_object('day', day, 'value', p95) order by day) from daily),
      'handoff_rate', (select jsonb_agg(jsonb_build_object('day', day, 'value', case when inbounds > 0 then round(handoffs::numeric / inbounds, 4) else 0 end) order by day) from daily)
    ),
    'by_kind', bk.value
  )
  from totals t cross join message_totals mt cross join by_kind bk;
$fn$;

revoke all on function public.fn_ai_usage_summary(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.fn_ai_usage_summary(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;
