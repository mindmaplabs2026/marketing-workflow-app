import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  aiPipelineAnalyze,
  aiPipelineCreative,
  aiPipelineGenerateV1,
  aiPipelineEvaluate,
  aiPipelineRefine,
} from "@/lib/inngest/functions/ai-pipeline";
import { aiChatEdit } from "@/lib/inngest/functions/ai-chat";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    aiPipelineAnalyze,
    aiPipelineCreative,
    aiPipelineGenerateV1,
    aiPipelineEvaluate,
    aiPipelineRefine,
    aiChatEdit,
  ],
});
