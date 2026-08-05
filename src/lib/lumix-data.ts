import { supabase } from "@/integrations/supabase/client";

/**
 * The live `metatable` schema (external Supabase project):
 *   id, title, video_url, poster_uri, category, actors,
 *   duration_seconds, views, created_at, search_text
 *
 * The generated `Database` types belong to a different (Lovable Cloud) project,
 * so this module owns the row contract and talks to an untyped client handle.
 */
export type MediaRow = {
  id: string;
  title: string;
  video_url: string;
  poster_uri: string;
  category: string;
  actors: string[];
  duration_seconds: number;
  views: number;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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

const RLS_HINT =
  "the database rejected the change (0 rows affected). Row Level Security is blocking writes for this user.";

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
  let query = db.from("metatable").select("*", { count: "exact" });

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
  return { rows: (data ?? []) as MediaRow[], total: (count ?? 0) as number };
}

export async function fetchCategoryStats(): Promise<CategoryStat[]> {
  const { data, error } = await db.rpc("list_categories");
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryStat[];
}

export async function fetchAllMediaLite() {
  const { data, error } = await db
    .from("metatable")
    .select("id,title,category,actors,views,duration_seconds,created_at")
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<
    MediaRow,
    "id" | "title" | "category" | "actors" | "views" | "duration_seconds" | "created_at"
  >[];
}

export async function insertMedia(row: {
  title: string;
  video_url: string;
  poster_uri: string;
  category: string;
  actors: string[];
  duration_seconds: number;
}): Promise<string> {
  const { data, error } = await db.from("metatable").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Insert failed — ${RLS_HINT}`);
  return data.id as string;
}

export async function updateMedia(
  id: string,
  patch: Partial<Pick<MediaRow, "title" | "category" | "actors" | "duration_seconds" | "views">>,
): Promise<MediaRow> {
  const { data, error } = await db.from("metatable").update(patch).eq("id", id).select("*");
  if (error) throw new Error(error.message);
  const updated = (data ?? [])[0] as MediaRow | undefined;
  if (!updated) throw new Error(`Update did not persist — ${RLS_HINT}`);
  return updated;
}

/** Deletes and returns the removed row so callers can roll the insert back. */
export async function deleteMedia(id: string): Promise<MediaRow> {
  const { data, error } = await db.from("metatable").delete().eq("id", id).select("*");
  if (error) throw new Error(error.message);
  const removed = (data ?? [])[0] as MediaRow | undefined;
  if (!removed) throw new Error(`Delete did not persist — ${RLS_HINT}`);
  return removed;
}

/** Used when CDN cleanup fails after the row is already gone. */
export async function restoreMedia(row: MediaRow): Promise<void> {
  const { error } = await db.from("metatable").insert({
    id: row.id,
    title: row.title,
    video_url: row.video_url,
    poster_uri: row.poster_uri,
    category: row.category,
    actors: row.actors,
    duration_seconds: row.duration_seconds,
    views: row.views,
    created_at: row.created_at,
  });
  if (error) throw new Error(error.message);
}

/** Bound to the poster preview action: public.increment_views */
export async function incrementViews(id: string) {
  const { error } = await db.rpc("increment_views", { p_id: id });
  if (error) throw new Error(error.message);
}
