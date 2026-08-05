import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Eye,
  Loader2,
  Pencil,
  Play,
  Search,
  Trash2,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { purgeAssets } from "@/lib/lumix.functions";
import { formatCount, formatDuration } from "@/lib/media";
import {
  deleteMedia,
  fetchMedia,
  incrementViews,
  restoreMedia,
  updateMedia,
  type ExplorerParams,
  type MediaRow,
} from "@/lib/lumix-data";
import { CategoryPicker } from "./CategoryPicker";
import { TagPicker } from "./TagPicker";
import { GlassPanel, SectionHeading } from "./GlassPanel";

const PAGE_SIZE = 8;

const SORTS: { key: ExplorerParams["sort"]; label: string }[] = [
  { key: "created_at", label: "Newest" },
  { key: "views", label: "Views" },
  { key: "duration_seconds", label: "Duration" },
  { key: "title", label: "Title" },
];

export function DataExplorer({
  categorySuggestions,
  actorSuggestions,
  refreshToken,
  onMutated,
}: {
  categorySuggestions: string[];
  actorSuggestions: string[];
  refreshToken: number;
  onMutated: () => void;
}) {
  const purge = useServerFn(purgeAssets);

  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerParams["sort"]>("created_at");
  const [direction, setDirection] = useState<ExplorerParams["direction"]>("desc");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<MediaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<MediaRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCats, setEditCats] = useState<string[]>([]);
  const [editActors, setEditActors] = useState<string[]>([]);
  const [editDuration, setEditDuration] = useState(0);
  const [saving, setSaving] = useState(false);

  const [removing, setRemoving] = useState<MediaRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(rawSearch);
      setPage(0);
    }, 280);
    return () => clearTimeout(id);
  }, [rawSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMedia({ search, categories, sort, direction, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((error: Error) => {
        if (!cancelled) toast.error(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, categories, sort, direction, page, refreshToken]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeSort = useMemo(() => SORTS.find((s) => s.key === sort)!, [sort]);

  const openEdit = (row: MediaRow) => {
    setEditing(row);
    setEditTitle(row.title);
    setEditCats(
      row.category
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    );
    setEditActors([...row.actors]);
    setEditDuration(row.duration_seconds);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (
      editTitle.trim().length < 2 ||
      editCats.length === 0 ||
      editActors.length === 0 ||
      editDuration < 1
    ) {
      toast.error("Title, at least one category, one actor, and a duration are required.");
      return;
    }
    setSaving(true);
    try {
      await updateMedia(editing.id, {
        title: editTitle.trim(),
        category: editCats.join(", "),
        actors: editActors,
        duration_seconds: Math.round(editDuration),
      });
      toast.success("Record updated.");
      setEditing(null);
      onMutated();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      // Delete the row first: it is the only step that can be rolled back.
      const removed = await deleteMedia(removing.id);
      try {
        const result = await purge({
          data: { videoUrl: removed.video_url, posterUrl: removed.poster_uri },
        });
        if (result.video.startsWith("failed") || result.poster.startsWith("failed")) {
          toast.warning(
            `Record deleted, but CDN cleanup was partial (video: ${result.video}, poster: ${result.poster}).`,
          );
        } else {
          toast.success("Deleted from the database, image CDN and video CDN.");
        }
      } catch (cdnError) {
        // Roll the database back so the row never loses its assets silently.
        try {
          await restoreMedia(removed);
          toast.error(`Delete rolled back — CDN cleanup failed: ${(cdnError as Error).message}`);
          setDeleting(false);
          return;
        } catch {
          toast.warning("Record deleted, but its CDN files may need manual cleanup.");
        }
      }
      setRemoving(null);
      onMutated();
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };


  const preview = async (row: MediaRow) => {
    try {
      await incrementViews(row.id);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, views: Number(r.views) + 1 } : r)),
      );
    } catch {
      /* view counting must never block playback */
    }
    window.open(row.video_url, "_blank", "noopener,noreferrer");
  };

  return (
    <GlassPanel className="p-4 sm:p-6">
      <SectionHeading
        eyebrow="Explorer"
        title="Library data grid"
        action={
          <span className="text-muted-foreground font-mono text-xs">
            {total} record{total === 1 ? "" : "s"}
          </span>
        }
      />

      <div className="space-y-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          {loading ? (
            <Loader2 className="text-primary absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          ) : null}
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Full-text search titles, categories, actors…"
            className="h-11 pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                if (option.key === sort) {
                  setDirection(direction === "asc" ? "desc" : "asc");
                } else {
                  setSort(option.key);
                  setDirection(option.key === "title" ? "asc" : "desc");
                }
                setPage(0);
              }}
              className={cn(
                "spring-press inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                option.key === sort
                  ? "bg-gradient-cyan glow-cyan text-primary-foreground"
                  : "glass hover:border-primary",
              )}
            >
              {option.label}
              {option.key === sort ? (
                direction === "asc" ? (
                  <ArrowUp className="size-3.5" />
                ) : (
                  <ArrowDown className="size-3.5" />
                )
              ) : null}
            </button>
          ))}
        </div>

        <CategoryPicker
          value={categories}
          onChange={(next) => {
            setCategories(next);
            setPage(0);
          }}
          suggestions={categorySuggestions}
        />
      </div>

      <div className="mt-5 space-y-3">
        {loading && rows.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-24 rounded-2xl" />
            ))
          : null}

        {!loading && rows.length === 0 ? (
          <div className="glass px-4 py-10 text-center">
            <p className="text-sm font-semibold">
              {search || categories.length > 0 ? "No matching records" : "No records yet"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {search || categories.length > 0
                ? "Try a different search term or clear the category filters."
                : "Upload your first title above — it will appear here instantly."}
            </p>
            {search || categories.length > 0 ? (
              <Button
                variant="outline"
                className="spring-press mt-4"
                onClick={() => {
                  setRawSearch("");
                  setSearch("");
                  setCategories([]);
                  setPage(0);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}


        {rows.map((row) => (
          <div
            key={row.id}
            className="glass neon-edge spring-press flex gap-3 p-3 transition-transform sm:items-center sm:gap-4"
          >
            <button
              type="button"
              onClick={() => void preview(row)}
              className="group relative w-24 shrink-0 overflow-hidden rounded-xl sm:w-36"
            >
              <img
                src={row.poster_uri}
                alt={row.title}
                loading="lazy"
                className="aspect-video size-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <span className="bg-background/60 absolute inset-0 grid place-items-center opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
                <Play className="text-neon-cyan size-6" />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base">{row.title}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {row.category
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .map((c) => (
                    <span
                      key={c}
                      className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[0.65rem]"
                    >
                      {c}
                    </span>
                  ))}
              </div>
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.7rem]">
                <span className="inline-flex items-center gap-1">
                  <Eye className="size-3.5" /> {formatCount(Number(row.views))}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" /> {formatDuration(row.duration_seconds)}
                </span>
                <span className="truncate">{row.actors.join(" · ")}</span>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Edit record"
                onClick={() => openEdit(row)}
                className="spring-press"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Delete record"
                onClick={() => setRemoving(row)}
                className="spring-press text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="spring-press"
          >
            Previous
          </Button>
          <span className="text-muted-foreground font-mono text-xs">
            {page + 1} / {pages} · sorted by {activeSort.label.toLowerCase()}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="spring-press"
          >
            Next
          </Button>
        </div>
      ) : null}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="glass flex max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:w-full">
          <DialogHeader className="shrink-0 border-b border-white/10 p-4 text-left sm:p-6">
            <DialogTitle>Edit record</DialogTitle>
            <DialogDescription>
              Metadata updates apply instantly; media files stay on the CDN.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value.slice(0, 160))}
              />
            </div>
            <div className="space-y-2">
              <Label>Categories</Label>
              <CategoryPicker
                value={editCats}
                onChange={setEditCats}
                suggestions={categorySuggestions}
              />
            </div>
            <div className="space-y-2">
              <Label>Actors</Label>
              <TagPicker
                value={editActors}
                onChange={setEditActors}
                suggestions={actorSuggestions}
                icon={Users}
                tone="pink"
                placeholder="Search or type a new cast member"
                emptyText="No actor selected yet."
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-duration">Duration (seconds)</Label>
              <Input
                id="edit-duration"
                inputMode="numeric"
                value={editDuration || ""}
                onChange={(e) => setEditDuration(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t border-white/10 bg-background/40 p-4 sm:flex-row sm:justify-end sm:p-6">
            <Button
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={saving}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={saving}
              className="bg-gradient-cyan text-primary-foreground glow-cyan spring-press w-full font-semibold sm:w-auto"
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={Boolean(removing)} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <DialogContent className="glass w-[calc(100vw-1.5rem)] max-w-md sm:w-full">
          <DialogHeader className="text-left">
            <DialogTitle>Delete permanently?</DialogTitle>
            <DialogDescription>
              “{removing?.title}” will be removed from the database, the image CDN and the video
              CDN. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setRemoving(null)}
              disabled={deleting}
              className="w-full sm:w-auto"
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="spring-press w-full sm:w-auto"
            >
              {deleting ? "Deleting…" : "Delete everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}

