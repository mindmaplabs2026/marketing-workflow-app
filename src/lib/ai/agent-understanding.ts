import "server-only";
import { getOpenAI } from "./openai-client";

/** Image metadata passed into Agent 1. */
export type UploadedImage = {
  path: string;
  signedUrl: string;
  mimeType: string | null;
  fileSize: number | null;
};

/** A curated image from Agent 1's shortlist. */
export type CuratedImage = {
  path: string;
  relevanceScore: number;
  description: string;
  quality: "high" | "medium" | "low";
};

/** Agent 1 output — stored in ai_generation_jobs.agent1_output. */
export type UnderstandingOutput = {
  theme: string;
  coreMessage: string;
  curatedImages: CuratedImage[];
  rejectedImages: { path: string; reason: string }[];
  audience: string;
  tone: string;
  constraints: string[];
};

type Agent1Input = {
  title: string;
  description: string | null;
  images: UploadedImage[];
  brandAssetTypes: string[];
};

const SYSTEM_PROMPT = `You are an expert visual content analyst for school marketing posters.

Your job is to:
1. Understand the theme, audience, and tone from the title and description.
2. Analyze every uploaded image for quality, content, and relevance to the theme.
3. Curate a shortlist of the best images (max 10-15) ranked by relevance.
4. Reject images that are blurry, irrelevant, or low quality — explain why.
5. Identify the core message that should come through in the poster(s).

Return ONLY valid JSON matching this schema:
{
  "theme": "string — the central theme/topic",
  "coreMessage": "string — the key message for the poster",
  "curatedImages": [{ "path": "string", "relevanceScore": 0-100, "description": "string", "quality": "high|medium|low" }],
  "rejectedImages": [{ "path": "string", "reason": "string" }],
  "audience": "string — target audience (parents, students, community, etc.)",
  "tone": "string — visual tone (celebratory, informational, urgent, etc.)",
  "constraints": ["string — any constraints or notes for the designer"]
}`;

export async function runUnderstandingAgent(
  input: Agent1Input,
): Promise<UnderstandingOutput> {
  const openai = getOpenAI();

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Title: ${input.title}\n\nDescription: ${input.description ?? "(none provided)"}\n\nNumber of images uploaded: ${input.images.length}\nSchool brand asset types available: ${input.brandAssetTypes.join(", ") || "none"}`,
    },
  ];

  // Attach images (up to 60) with low detail to save tokens
  for (const img of input.images) {
    userContent.push({
      type: "image_url",
      image_url: { url: img.signedUrl, detail: "low" },
    });
    userContent.push({
      type: "text",
      text: `[Image: ${img.path}]`,
    });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Agent 1: empty response from model");

  return JSON.parse(raw) as UnderstandingOutput;
}
