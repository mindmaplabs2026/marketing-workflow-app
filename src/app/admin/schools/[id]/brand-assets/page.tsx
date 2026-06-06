import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import { removeBrandAsset, updateSchoolGuidelines } from "../actions";
import { BrandAssetUpload } from "./brand-asset-upload";
import { ConfirmForm } from "@/components/confirm-form";
import { BackLink } from "@/components/back-link";
import { SubmitButton } from "@/components/submit-button";
import type { BrandAssetType } from "@/lib/supabase/types";

const ASSET_TYPE_LABELS: Record<BrandAssetType, string> = {
  logo: "Logo",
  header: "Header",
  footer: "Footer",
  uniform: "Uniform Standards",
  infrastructure: "Infrastructure",
  sample: "Sample Posters (Style Reference)",
};

const ASSET_TYPES: BrandAssetType[] = [
  "logo",
  "header",
  "footer",
  "uniform",
  "infrastructure",
  "sample",
];

type AssetRow = {
  id: string;
  asset_type: BrandAssetType;
  storage_path: string;
  mime_type: string | null;
  label: string | null;
  created_at: string;
};

export default async function BrandAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionUser();
  if (!session || (session.role !== "super_admin" && session.role !== "school_admin")) {
    redirect("/");
  }

  const { id: schoolId } = await params;
  const supabase = await createClient();

  const [schoolRes, assetsRes] = await Promise.all([
    supabase.from("schools").select("id, name, ai_guidelines").eq("id", schoolId).single(),
    supabase
      .from("school_brand_assets")
      .select("id, asset_type, storage_path, mime_type, label, created_at")
      .eq("school_id", schoolId)
      .order("asset_type")
      .order("created_at")
      .returns<AssetRow[]>(),
  ]);

  if (!schoolRes.data) notFound();
  const school = schoolRes.data;
  const assets = assetsRes.data ?? [];

  // Group by asset type
  const grouped = new Map<BrandAssetType, AssetRow[]>();
  for (const type of ASSET_TYPES) grouped.set(type, []);
  for (const a of assets) {
    grouped.get(a.asset_type)?.push(a);
  }

  // Generate signed URLs for previews
  const signedUrls = new Map<string, string>();
  for (const a of assets) {
    const { data } = await supabase.storage
      .from("school-assets")
      .createSignedUrl(a.storage_path, 300);
    if (data?.signedUrl) signedUrls.set(a.id, data.signedUrl);
  }

  return (
    <div className="space-y-8">
      <div>
        <BackLink href={`/admin/schools/${schoolId}`}>
          {school.name}
        </BackLink>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Brand Assets
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Upload logos, headers, footers, uniform standards, and infrastructure
          images. These are used by the AI poster generator.
        </p>
      </div>

      {/* School-specific AI guidelines */}
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          AI Design Guidelines
        </h2>
        <p className="text-xs text-zinc-500">
          School-specific instructions for the AI creative designer. These are
          passed to the AI before it starts designing. Include branding rules,
          language preferences, special requirements, etc.
        </p>
        <form action={updateSchoolGuidelines}>
          <input type="hidden" name="school_id" value={schoolId} />
          <textarea
            name="guidelines"
            rows={5}
            defaultValue={school.ai_guidelines ?? ""}
            placeholder={"e.g.\n- Always include both SMC and SMPS logos side by side\n- Use Kannada tagline below school name\n- Primary colors: navy blue (#1B3A5C) and gold (#C4A035)\n- Include affiliation badges (CBSE 830987, IGCSE IA 109)\n- Contact bar at bottom: phone, website, address\n- Include curriculum info: Nursery to Grade X"}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <div className="mt-2">
            <SubmitButton
              className="rounded-md border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              pendingLabel="Saving..."
            >
              Save guidelines
            </SubmitButton>
          </div>
        </form>
      </section>

      {ASSET_TYPES.map((type) => {
        const items = grouped.get(type) ?? [];
        return (
          <section key={type} className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {ASSET_TYPE_LABELS[type]}
            </h2>

            {items.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {items.map((a) => {
                  const url = signedUrls.get(a.id);
                  return (
                    <div
                      key={a.id}
                      className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      {url && a.mime_type?.startsWith("image/") ? (
                        <img
                          src={url}
                          alt={a.label ?? a.asset_type}
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
                          {a.mime_type ?? "File"}
                        </div>
                      )}
                      <div className="px-2 py-1.5">
                        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                          {a.label ?? a.storage_path.split("/").pop()}
                        </p>
                      </div>
                      <ConfirmForm
                        action={removeBrandAsset}
                        message={`Remove this ${ASSET_TYPE_LABELS[type].toLowerCase()}?`}
                      >
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input type="hidden" name="school_id" value={schoolId} />
                        <input type="hidden" name="storage_path" value={a.storage_path} />
                        <button
                          type="submit"
                          className="absolute right-1 top-1 hidden rounded bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-red-600 group-hover:block"
                        >
                          Remove
                        </button>
                      </ConfirmForm>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                No {ASSET_TYPE_LABELS[type].toLowerCase()} uploaded yet.
              </p>
            )}

            <BrandAssetUpload schoolId={schoolId} assetType={type} />
          </section>
        );
      })}
    </div>
  );
}
