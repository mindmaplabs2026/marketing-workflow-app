import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { aiPipeline } from "@/lib/inngest/functions/ai-pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [aiPipeline],
});
