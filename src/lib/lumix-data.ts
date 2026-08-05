import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type MediaRow = Tables<"metatable">;

export type CategoryStat = {
  category: string;
  total: number;
  total_views: number;
  total_duration: number;
};

export type ExplorerParams = {
  search: string;
  categories: string[];
  sort: "created_at" | "views" | "duration_seconds" | "title";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** Full-text search over the generated `search_text` column (GIN indexed). */
function toWebsearchQuery(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[:&|!()<>']/g, ""))
    .filter(Boolean)
    .join(" ");
}

export async function fetchMedia(params: ExplorerParams) {
  const from = params.page * params.pageSize;
  let query = supabase.from("metatable").select("*", { count: "exact" });

  const search = toWebsearchQuery(params.search);
  if (search) {
    query = query.textSearch("search_text", `${search}:*`, { type: "plain", config: "simple" });
  }
  if (params.categories.length > 0) {
    // `category` holds one or more comma-joined labels, so match on containment.
    query = query.or(params.categories.map((c) => `category.ilike.%${c}%`).join(","));
  }


  const { data, error, count } = await query
    .order(params.sort, { ascending: params.direction === "asc" })
    .range(from, from + params.pageSize - 1);

  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as MediaRow[], total: count ?? 0 };
}

export async function fetchCategoryStats(): Promise<CategoryStat[]> {
  const { data, error } = await supabase.rpc("list_categories");
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryStat[];
}

export async function fetchAllMediaLite() {
  const { data, error } = await supabase
    .from("metatable")
    .select("id,title,category,actors,views,duration_seconds,created_at")
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function insertMedia(row: {
  title: string;
  video_url: string;
  poster_url: string;
  category: string;
  actors: string[];
  duration_seconds: number;
  cloudflare_uid: string | null;
  cloudinary_public_id: string | null;
}) {
  const { data, error } = await supabase.from("metatable").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateMedia(
  id: string,
  patch: Partial<Pick<MediaRow, "title" | "category" | "actors" | "duration_seconds" | "views">>,
) {
  const { error } = await supabase.from("metatable").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMedia(id: string) {
  const { error } = await supabase.from("metatable").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Bound to the poster preview action: public.increment_views */
export async function incrementViews(id: string) {
  const { error } = await supabase.rpc("increment_views", { p_id: id });
  if (error) throw new Error(error.message);
}

