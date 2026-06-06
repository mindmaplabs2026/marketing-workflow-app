import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  aiPipelineAnalyze,
  aiPipelineCreative,
  aiPipelineGenerateV1,
} from "@/lib/inngest/functions/ai-pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    aiPipelineAnalyze,
    aiPipelineCreative,
    aiPipelineGenerateV1,
  ],
});
