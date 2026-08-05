import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LayoutGrid, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getDeliveryConfig } from "@/lib/lumix.functions";
import {
  fetchAllMediaLite,
  fetchCategoryStats,
  type CategoryStat,
} from "@/lib/lumix-data";
import { AuthGate } from "@/components/lumix/AuthGate";
import { AnalyticsPanel } from "@/components/lumix/AnalyticsPanel";
import { StatsHeader } from "@/components/lumix/StatsHeader";
import { DataExplorer } from "@/components/lumix/DataExplorer";
import { UploadWizard } from "@/components/lumix/UploadWizard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LumiX Admin — Media Control Deck" },
      {
        name: "description",
        content:
          "LumiX admin console: upload, transcode and publish HLS video, explore the library with full-text search, and track views, categories and storage analytics.",
      },
      { property: "og:title", content: "LumiX Admin — Media Control Deck" },
      {
        property: "og:description",
        content:
          "Cyberpunk glass admin dashboard for the LumiX media library: uploads, HLS pipeline, CRUD and neon analytics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminDashboard,
});

type LiteRow = Awaited<ReturnType<typeof fetchAllMediaLite>>[number];

function AdminDashboard() {
  const { loading, session, isAdmin } = useAuth();
  const readConfig = useServerFn(getDeliveryConfig);

  const [rows, setRows] = useState<LiteRow[]>([]);
  const [stats, setStats] = useState<CategoryStat[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    const [lite, categoryStats] = await Promise.all([fetchAllMediaLite(), fetchCategoryStats()]);
    setRows(lite as LiteRow[]);
    setStats(categoryStats);
  }, []);

  useEffect(() => {
    if (!session || !isAdmin) return;
    let cancelled = false;
    void load();
    void readConfig()
      .then((config) => {
        if (!cancelled) setReady(Boolean(config.r2Ready && config.cloudinaryReady));
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, isAdmin, load, readConfig, refreshToken]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="skeleton-shimmer h-32 w-full max-w-sm rounded-3xl" />
      </main>
    );
  }

  if (!session) return <AuthGate />;
  if (!isAdmin) return <AuthGate  />;

  const refresh = () => setRefreshToken((token) => token + 1);

  const categorySuggestions = Array.from(
    new Set([
      ...stats.map((s) => s.category),
      ...rows.flatMap((r) => r.category.split(",").map((c) => c.trim())),
    ]),
  ).filter(Boolean);

  const actorSuggestions = Array.from(
    new Set(rows.flatMap((r) => r.actors.map((a) => a.trim()))),
  ).filter(Boolean);

  return (
    <main className="relative min-h-screen px-3 pb-16 sm:px-6 lg:px-10">
      <div className="aurora" aria-hidden />

      <header className="flex flex-wrap items-center justify-between gap-3 py-5 sm:py-8">
        <div>
          <p className="text-primary font-mono text-[0.65rem] tracking-[0.32em] uppercase">
            LumiX control deck
          </p>
          <h1 className="text-2xl font-bold sm:text-4xl">Media Admin & Analytics</h1>
        </div>
        <Button
          variant="outline"
          className="spring-press"
          onClick={() => void supabase.auth.signOut()}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </header>

      <section className="mb-4">
        <StatsHeader rows={rows} />
      </section>

      <section>
        <DataExplorer
          categorySuggestions={categorySuggestions}
          actorSuggestions={actorSuggestions}
          refreshToken={refreshToken}
          onMutated={refresh}
        />
      </section>

      <section className="mt-4">
        <UploadWizard
          categorySuggestions={categorySuggestions}
          actorSuggestions={actorSuggestions}
          ready={ready}
          onCreated={refresh}
        />
      </section>

      <section className="mt-4">
        <AnalyticsPanel rows={rows} stats={stats} />
      </section>

      <footer className="text-muted-foreground mt-8 flex items-center justify-center gap-2 text-xs">
        <LayoutGrid className="size-3.5" /> LumiX · glass control deck
      </footer>
    </main>
  );
}
