import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  aiPipelineAnalyze,
  aiPipelineGenerateV1,
  aiPipelineGenerateV2,
  aiPipelineGenerateV3,
} from "@/lib/inngest/functions/ai-pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    aiPipelineAnalyze,
    aiPipelineGenerateV1,
    aiPipelineGenerateV2,
    aiPipelineGenerateV3,
  ],
});
