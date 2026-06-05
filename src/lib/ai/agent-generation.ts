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

  // Collect reference images — only what's needed for this variation:
  // 1. Logo, header, footer: ALWAYS included (mandatory on every poster)
  // 2. Uploaded photos: only the ones Agent 2 selected for this variation
  // 3. Uniform/infrastructure: only if Agent 2 specified to use them
  const referenceImages: { buffer: Buffer; name: string }[] = [];

  // Always include: logo, header, footer
  const alwaysInclude = ["logo", "header", "footer"];
  for (const asset of input.brandAssets) {
    if (alwaysInclude.includes(asset.assetType) && asset.signedUrl) {
      const buf = await downloadImage(asset.signedUrl);
      if (buf) {
        referenceImages.push({
          buffer: buf,
          name: `brand-${asset.assetType}-${asset.storagePath.split("/").pop() ?? "asset.png"}`,
        });
      }
    }
  }

  // Conditionally include: uniform (if Agent 2 says useUniform)
  if (brief.schoolAssetUsage.useUniform) {
    for (const asset of input.brandAssets) {
      if (asset.assetType === "uniform" && asset.signedUrl) {
        const buf = await downloadImage(asset.signedUrl);
        if (buf) {
          referenceImages.push({
            buffer: buf,
            name: `brand-uniform-${asset.storagePath.split("/").pop() ?? "asset.png"}`,
          });
        }
      }
    }
  }

  // Conditionally include: infrastructure (if Agent 2 says useInfrastructure)
  if (brief.schoolAssetUsage.useInfrastructure) {
    for (const asset of input.brandAssets) {
      if (asset.assetType === "infrastructure" && asset.signedUrl) {
        const buf = await downloadImage(asset.signedUrl);
        if (buf) {
          referenceImages.push({
            buffer: buf,
            name: `brand-infrastructure-${asset.storagePath.split("/").pop() ?? "asset.png"}`,
          });
        }
      }
    }
  }

  // Only include the specific uploaded photos Agent 2 selected for this variation
  const selectedPaths = new Set(brief.selectedImages.map((s) => s.path));
  for (const img of input.curatedImages) {
    // Match by filename (selectedImages uses just the filename, curatedImages has full path)
    const imgFilename = img.path.split("/").pop() ?? "";
    const isSelected = selectedPaths.has(img.path) ||
      [...selectedPaths].some((p) => img.path.endsWith(p) || p.endsWith(imgFilename));
    if (isSelected) {
      const buf = await downloadImage(img.signedUrl);
      if (buf) {
        referenceImages.push({
          buffer: buf,
          name: imgFilename || "upload.png",
        });
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
        referenceImages.map((img) =>
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
${brandAssets.length > 0 ? `\nIMPORTANT BRANDING RULES:
- Use the school's actual LOGO from the reference images. Place it at ${brief.logoPlacement.position}, ${brief.logoPlacement.size}.
- The HEADER must appear at the top of EVERY poster (single or carousel page). Use the provided header reference image and adapt its style to match the theme.
- The FOOTER must appear at the bottom of EVERY poster (single or carousel page). Use the provided footer reference image and adapt its style to match the theme.
- Header and footer are MANDATORY on every single page. Do not omit them.` : `\n## Logo: ${brief.logoPlacement.position}, ${brief.logoPlacement.size}, style: ${brief.logoPlacement.style}`}

## Header style: ${brief.headerFooter.headerStyle} (MUST appear on every page)
## Footer style: ${brief.headerFooter.footerStyle} (MUST appear on every page)

${brief.schoolAssetUsage.useUniform ? `## Uniform: ${brief.schoolAssetUsage.uniformNotes}` : ""}
${brief.schoolAssetUsage.useInfrastructure ? `## Infrastructure: ${brief.schoolAssetUsage.infrastructureNotes}` : ""}

${pageContext}

## Design Prompt:
${brief.designPrompt}

IMPORTANT: This is a polished, print-ready Instagram poster (1080x1080px square). High quality, vibrant, professional school marketing. All text must be crisp and legible.`;
}
