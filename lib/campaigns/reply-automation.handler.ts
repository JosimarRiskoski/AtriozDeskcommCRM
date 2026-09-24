import { createAdminClient } from "@/lib/supabase/admin";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import {
  CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
  runCampaignReplyAutomation,
} from "@/lib/campaigns/reply-automation";

export const campaignReplyAutomationHandler: EventHandler = {
  key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
  events: ["message.received"],
  async handle(row) {
    return runCampaignReplyAutomation(createAdminClient(), row);
  },
};
