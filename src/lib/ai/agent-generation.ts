import "server-only";
import { getOpenAI } from "./openai-client";
import type { VariationBrief } from "./agent-creative";
import type { UnderstandingOutput } from "./agent-understanding";

type BrandAssetFile = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
};

type CuratedImageFile = {
  path: string;
  signedUrl: string;
};

type Agent3Input = {
  brief: VariationBrief;
  understanding: UnderstandingOutput;
  brandAssets: BrandAssetFile[];
  curatedImages: CuratedImageFile[];
  schoolName: string;
};

type GenerationResult = {
  imageUrls: string[];
  model: string;
};

/**
 * Generates poster image(s) for one variation using GPT Image API.
 * For carousels, generates each page separately to maintain consistency.
 * Returns base64 image data URLs or URLs from the API.
 */
export async function runGenerationAgent(
  input: Agent3Input,
): Promise<GenerationResult> {
  const openai = getOpenAI();
  const { brief } = input;

  const pages =
    brief.layout.type === "carousel" ? brief.layout.pages : [brief.layout.pages[0]];

  const imageUrls: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isCarousel = brief.layout.type === "carousel";
    const pageContext = isCarousel
      ? `\n\nThis is page ${i + 1} of ${pages.length} in a carousel. ${page.description}`
      : "";

    const prompt = buildImagePrompt(input, page, pageContext);

    // Use gpt-image-1 for generation
    // The model param will be adjusted based on cost optimization later
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "high",
    });

    const item = response.data?.[0];
    if (!item) {
      throw new Error(
        `Agent 3: no image returned for variation ${brief.variationIndex}, page ${i + 1}`,
      );
    }
    // gpt-image-1 returns b64_json by default; prefix it so downstream
    // code can distinguish base64 from HTTP URLs.
    if (item.b64_json) {
      imageUrls.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      imageUrls.push(item.url);
    } else {
      throw new Error(
        `Agent 3: no url or b64_json for variation ${brief.variationIndex}, page ${i + 1}`,
      );
    }
  }

  return { imageUrls, model: "gpt-image-1" };
}

function buildImagePrompt(
  input: Agent3Input,
  page: { description: string; selectedImages: { path: string; placement: string; size: string }[]; textOverlays: { text: string; position: string; style: string }[] } | undefined,
  pageContext: string,
): string {
  const { brief, understanding, schoolName } = input;

  const imageDescriptions = brief.selectedImages
    .map((img) => {
      const curated = understanding.curatedImages.find(
        (c) => c.path === img.path,
      );
      return curated
        ? `- ${curated.description} (placed: ${img.placement})`
        : `- Image at ${img.path} (placed: ${img.placement})`;
    })
    .join("\n");

  const textOverlays = page?.textOverlays
    ?.map((t) => `- "${t.text}" at ${t.position} in ${t.style} style`)
    .join("\n") ?? "";

  return `Create a professional Instagram poster for ${schoolName}.

## Creative Direction: ${brief.direction}
## Theme: ${brief.theme}
## Color Palette: ${brief.colorPalette.join(", ")}

## Text Content:
- Headline: "${brief.textContent.headline}"
- Subheadline: "${brief.textContent.subheadline}"
${brief.textContent.bodyText ? `- Body: "${brief.textContent.bodyText}"` : ""}
${brief.textContent.callToAction ? `- CTA: "${brief.textContent.callToAction}"` : ""}

${textOverlays ? `## Text Overlays:\n${textOverlays}` : ""}

## Images to incorporate:
${imageDescriptions || "(No uploaded images — generate all visuals to match the theme)"}

## Logo: ${brief.logoPlacement.position}, ${brief.logoPlacement.size}, style: ${brief.logoPlacement.style}
## Header: ${brief.headerFooter.headerStyle}
## Footer: ${brief.headerFooter.footerStyle}

${brief.schoolAssetUsage.useUniform ? `## Uniform: ${brief.schoolAssetUsage.uniformNotes}` : ""}
${brief.schoolAssetUsage.useInfrastructure ? `## Infrastructure: ${brief.schoolAssetUsage.infrastructureNotes}` : ""}

${pageContext}

## Design Prompt:
${brief.designPrompt}

IMPORTANT: This is a polished, print-ready Instagram poster (1080x1080px square). High quality, vibrant, professional school marketing. All text must be crisp and legible.`;
}
