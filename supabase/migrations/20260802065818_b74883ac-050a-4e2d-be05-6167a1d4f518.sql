CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.lumix_search_vector(p_title text, p_category text, p_actors text[])
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT to_tsvector('simple',
    coalesce(p_title, '') || ' ' ||
    coalesce(p_category, '') || ' ' ||
    coalesce(array_to_string(p_actors, ' '), '')
  );
$$;

CREATE TABLE public.metatable (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  video_url text NOT NULL,
  poster_url text NOT NULL,
  category text NOT NULL,
  actors text[] NOT NULL DEFAULT '{}',
  duration_seconds integer NOT NULL DEFAULT 0,
  views bigint NOT NULL DEFAULT 0,
  cloudflare_uid text,
  cloudinary_public_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  search_text tsvector GENERATED ALWAYS AS (public.lumix_search_vector(title, category, actors)) STORED
);

CREATE INDEX metatable_search_text_idx ON public.metatable USING gin (search_text);
CREATE INDEX metatable_title_trgm_idx ON public.metatable USING gin (title gin_trgm_ops);
CREATE INDEX metatable_created_at_idx ON public.metatable (created_at DESC);
CREATE INDEX metatable_category_idx ON public.metatable (category);

GRANT SELECT ON public.metatable TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metatable TO authenticated;
GRANT ALL ON public.metatable TO service_role;

ALTER TABLE public.metatable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Media is publicly viewable" ON public.metatable FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert media" ON public.metatable FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update media" ON public.metatable FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete media" ON public.metatable FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.increment_views(p_id uuid)
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.metatable SET views = views + 1 WHERE id = p_id RETURNING views;
$$;

CREATE OR REPLACE FUNCTION public.list_categories()
RETURNS TABLE (category text, total bigint, total_views bigint, total_duration bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.category, count(*)::bigint, coalesce(sum(m.views), 0)::bigint, coalesce(sum(m.duration_seconds), 0)::bigint
  FROM public.metatable m
  GROUP BY m.category
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.increment_views(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_categories() TO anon, authenticated, service_role;