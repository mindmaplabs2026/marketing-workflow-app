import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  aiPipelineAnalyze,
  aiPipelineGenerateV1,
  // V2/V3 disabled during testing — only generating 1 variation
  // aiPipelineGenerateV2,
  // aiPipelineGenerateV3,
} from "@/lib/inngest/functions/ai-pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    aiPipelineAnalyze,
    aiPipelineGenerateV1,
  ],
});
