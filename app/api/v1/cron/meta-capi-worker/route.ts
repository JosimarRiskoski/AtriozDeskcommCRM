import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail,ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { runMetaCapiTick } from "@/lib/meta-capi/worker";
import { createAdminClient } from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
async function handle(req:NextRequest){const requestId=randomUUID();const auth=req.headers.get("authorization")??"";const provided=(auth.startsWith("Bearer ")?auth.slice(7):"")||req.headers.get("x-cron-secret")||"";if(![env.INTERNAL_CRON_SECRET,env.INTERNAL_SECRET].filter(Boolean).includes(provided.trim()))return fail("forbidden","Cron secret missing or invalid.",403,{requestId});try{return ok(await runMetaCapiTick(createAdminClient() as unknown as SupabaseClient),{requestId});}catch(error){return fail("internal_error",error instanceof Error?error.message:"meta_worker_failed",500,{requestId});}}
export async function GET(req:NextRequest){return handle(req)} export async function POST(req:NextRequest){return handle(req)}
