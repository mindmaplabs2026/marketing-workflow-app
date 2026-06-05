import "server-only";
import { getOpenAI } from "./openai-client";
import type { VariationBrief } from "./agent-creative";
import type { UnderstandingOutput } from "./agent-understanding";
import { toFile } from "openai";

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

export type GenerationResult = {
  imageUrls: string[];
  model: string;
  prompts: string[];
  referenceImageCount: number;
};

/**
 * Downloads an image from a signed URL and returns it as a Buffer.
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Generates poster image(s) for one variation using GPT Image API.
 * Passes reference images (uploaded photos + brand assets) so the model
 * can incorporate them into the poster.
 */
export async function runGenerationAgent(
  input: Agent3Input,
): Promise<GenerationResult> {
  const openai = getOpenAI();
  const { brief } = input;

  const pages =
    brief.layout.type === "carousel" ? brief.layout.pages : [brief.layout.pages[0]];

  const imageUrls: string[] = [];
  const prompts: string[] = [];

  // Collect reference images: curated uploads + brand assets (logo, header, footer)
  const referenceImages: { buffer: Buffer; name: string }[] = [];

  // Download curated images (teacher uploads selected by Agent 2)
  for (const img of input.curatedImages) {
    const buf = await downloadImage(img.signedUrl);
    if (buf) {
      const filename = img.path.split("/").pop() ?? "upload.png";
      referenceImages.push({ buffer: buf, name: filename });
    }
  }

  // Download brand assets (logo, header, footer, uniform, infrastructure)
  for (const asset of input.brandAssets) {
    if (asset.signedUrl) {
      const buf = await downloadImage(asset.signedUrl);
      if (buf) {
        const filename = `brand-${asset.assetType}-${asset.storagePath.split("/").pop() ?? "asset.png"}`;
        referenceImages.push({ buffer: buf, name: filename });
      }
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isCarousel = brief.layout.type === "carousel";
    const pageContext = isCarousel
      ? `\n\nThis is page ${i + 1} of ${pages.length} in a carousel. ${page.description}`
      : "";

    const prompt = buildImagePrompt(input, page, pageContext);
    prompts.push(prompt);

    if (referenceImages.length > 0) {
      // Use images.edit to pass reference images so the model can
      // incorporate real photos, logos, headers, etc.
      const referenceFiles = await Promise.all(
        referenceImages.slice(0, 10).map((img) =>
          toFile(img.buffer, img.name, { type: "image/png" }),
        ),
      );

      const response = await openai.images.edit({
        model: "gpt-image-1",
        image: referenceFiles,
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
      if (item.b64_json) {
        imageUrls.push(`data:image/png;base64,${item.b64_json}`);
      } else if (item.url) {
        imageUrls.push(item.url);
      } else {
        throw new Error(
          `Agent 3: no url or b64_json for variation ${brief.variationIndex}, page ${i + 1}`,
        );
      }
    } else {
      // No reference images — pure text-to-image generation
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
  }

  return {
    imageUrls,
    model: "gpt-image-1",
    prompts,
    referenceImageCount: referenceImages.length,
  };
}

function buildImagePrompt(
  input: Agent3Input,
  page: { description: string; selectedImages: { path: string; placement: string; size: string }[]; textOverlays: { text: string; position: string; style: string }[] } | undefined,
  pageContext: string,
): string {
  const { brief, understanding, schoolName, brandAssets } = input;

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

  // Describe brand assets so the model knows what reference images it has
  const brandAssetDescriptions = brandAssets
    .map((a) => `- ${a.assetType}: provided as reference image (filename: brand-${a.assetType}-...)`)
    .join("\n");

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

## Uploaded Photos to incorporate into the poster:
${imageDescriptions || "(No uploaded images — generate all visuals to match the theme)"}
${input.curatedImages.length > 0 ? "\nIMPORTANT: The uploaded photos are provided as reference images. You MUST incorporate them into the poster design. Do NOT replace them with AI-generated imagery." : ""}

## School Brand Assets (provided as reference images):
${brandAssetDescriptions || "(No brand assets provided)"}
${brandAssets.length > 0 ? `\nIMPORTANT: Use the school's actual logo from the reference images. Place it at ${brief.logoPlacement.position}, ${brief.logoPlacement.size}. Adapt the header and footer style to match the theme but use the provided brand elements.` : `\n## Logo: ${brief.logoPlacement.position}, ${brief.logoPlacement.size}, style: ${brief.logoPlacement.style}`}

## Header: ${brief.headerFooter.headerStyle}
## Footer: ${brief.headerFooter.footerStyle}

${brief.schoolAssetUsage.useUniform ? `## Uniform: ${brief.schoolAssetUsage.uniformNotes}` : ""}
${brief.schoolAssetUsage.useInfrastructure ? `## Infrastructure: ${brief.schoolAssetUsage.infrastructureNotes}` : ""}

${pageContext}

## Design Prompt:
${brief.designPrompt}

IMPORTANT: This is a polished, print-ready Instagram poster (1080x1080px square). High quality, vibrant, professional school marketing. All text must be crisp and legible.`;
}
