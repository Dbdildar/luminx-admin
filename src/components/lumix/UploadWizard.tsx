import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CloudUpload, Film, RotateCcw, Sparkles, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  abortMultipartTicket,
  completeMultipartTicket,
  createMultipartTicket,
  createUploadTicket,
  purgeAssets,
  signPosterUpload,
} from "@/lib/lumix.functions";
import { extractThumbnails, formatBytes, formatDuration, probeVideo, type Thumbnail } from "@/lib/media";
import {
  MULTIPART_THRESHOLD,
  pickPartSize,
  uploadPartsInParallel,
  uploadToCloudinary,
  uploadToR2,
} from "@/lib/uploads";
import { compressVideo } from "@/lib/compress";
import { insertMedia } from "@/lib/lumix-data";
import { CategoryPicker } from "./CategoryPicker";
import { TagPicker } from "./TagPicker";
import { GlassPanel, SectionHeading } from "./GlassPanel";
import { StageProgress, type StageState } from "./StageProgress";

type Stages = {
  compress: { pct: number; state: StageState; detail?: string };
  poster: { pct: number; state: StageState; detail?: string };
  video: { pct: number; state: StageState; detail?: string };
  record: { pct: number; state: StageState; detail?: string };
};

const initialStages: Stages = {
  compress: { pct: 0, state: "idle" },
  poster: { pct: 0, state: "idle" },
  video: { pct: 0, state: "idle" },
  record: { pct: 0, state: "idle" },
};


export function UploadWizard({
  categorySuggestions,
  actorSuggestions,
  ready,
  onCreated,
}: {
  categorySuggestions: string[];
  actorSuggestions: string[];
  ready: boolean;
  onCreated: () => void;
}) {
  const createTicket = useServerFn(createUploadTicket);
  const createMultipart = useServerFn(createMultipartTicket);
  const completeMultipart = useServerFn(completeMultipartTicket);
  const abortMultipart = useServerFn(abortMultipartTicket);
  const purge = useServerFn(purgeAssets);
  const signPoster = useServerFn(signPosterUpload);


  const inputRef = useRef<HTMLInputElement | null>(null);
  const thumbsRef = useRef<Thumbnail[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePct, setAnalyzePct] = useState(0);
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [stages, setStages] = useState<Stages>(initialStages);

  useEffect(() => {
    thumbsRef.current = thumbs;
  }, [thumbs]);

  useEffect(
    () => () => {
      thumbsRef.current.forEach((t) => URL.revokeObjectURL(t.url));
    },
    [],
  );

  const resetMedia = useCallback(() => {
    thumbsRef.current.forEach((t) => URL.revokeObjectURL(t.url));
    setThumbs([]);
    setSelectedThumb(null);
    setDuration(0);
    setFile(null);
    setAnalyzePct(0);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const resetAll = useCallback(() => {
    resetMedia();
    setTitle("");
    setCategories([]);
    setActors([]);
    setStages(initialStages);
  }, [resetMedia]);

  const handleFile = useCallback(
    async (nextFile: File) => {
      if (!nextFile.type.startsWith("video/")) {
        toast.error("Please choose a video file.");
        return;
      }
      resetMedia();
      setFile(nextFile);
      setAnalyzing(true);
      setAnalyzePct(0);
      try {
        const meta = await probeVideo(nextFile);
        setDuration(Math.round(meta.duration));
        const frames = await extractThumbnails(nextFile, 6, setAnalyzePct);
        setThumbs(frames);
        setSelectedThumb(frames[2]?.id ?? frames[0]?.id ?? null);
        if (!title) setTitle(nextFile.name.replace(/\.[^.]+$/, "").slice(0, 120));
      } catch (error) {
        toast.error((error as Error).message);
        resetMedia();
      } finally {
        setAnalyzing(false);
      }
    },
    [resetMedia, title],
  );

  const complete =
    ready &&
    Boolean(file) &&
    title.trim().length >= 2 &&
    categories.length > 0 &&
    actors.length > 0 &&
    duration > 0 &&
    Boolean(selectedThumb) &&
    !analyzing;

  const setStage = (key: keyof Stages, patch: Partial<Stages[keyof Stages]>) =>
    setStages((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const submit = async () => {
    if (!complete || !file) return;
    const thumb = thumbs.find((t) => t.id === selectedThumb);
    if (!thumb) return;

    setSubmitting(true);
    setStages({
      compress: { pct: 0, state: "active", detail: "Preparing video…" },
      video: { pct: 0, state: "idle" },
      poster: { pct: 0, state: "idle" },
      record: { pct: 0, state: "idle" },
    });

    let posterId: string | null = null;
    let posterUrl: string | null = null;
    let videoKey: string | null = null;
    let multipart: { videoKey: string; uploadId: string } | null = null;

    try {
      // 1) Compress locally (hardware encoder). Falls back to the original file.
      const result = await compressVideo(file, (pct) =>
        setStage("compress", { pct, detail: `Re-encoding… ${pct}%` }),
      );
      const upload = result.file;
      setStage("compress", {
        pct: 100,
        state: "done",
        detail: result.compressed
          ? `${formatBytes(result.originalSize)} → ${formatBytes(result.finalSize)} (−${Math.round(
              (1 - result.finalSize / result.originalSize) * 100,
            )}%)`
          : (result.reason ?? "Uploading the original file."),
      });

      const contentType = upload.type || "video/mp4";
      setStage("video", { state: "active", detail: "Requesting signed upload URLs…" });

      const posterSignPromise = signPoster({ data: { posterSize: thumb.blob.size } });
      let videoUrl: string;

      // 2) Video → R2 first: no poster is ever stored for a failed video upload.
      if (upload.size > MULTIPART_THRESHOLD) {
        // Parallel multipart transfer — many chunks in flight at once.
        const partSize = pickPartSize(upload.size);
        const partCount = Math.ceil(upload.size / partSize);
        const ticket = await createMultipart({
          data: {
            videoName: upload.name,
            videoType: contentType,
            videoSize: upload.size,
            partCount,
          },
        });
        multipart = { videoKey: ticket.videoKey, uploadId: ticket.uploadId };

        const parts = await uploadPartsInParallel({
          file: upload,
          partUrls: ticket.partUrls,
          partSize,
          concurrency: 6,
          onProgress: (pct, bps) =>
            setStage("video", {
              pct,
              detail: `${pct}% of ${formatBytes(upload.size)} · ${formatBytes(bps)}/s · ${partCount} chunks in parallel`,
            }),
        });

        setStage("video", { pct: 99, detail: "Finalising object on R2…" });
        await completeMultipart({
          data: { videoKey: ticket.videoKey, uploadId: ticket.uploadId, parts },
        });
        multipart = null;
        videoKey = ticket.videoKey;
        videoUrl = ticket.videoUrl;
      } else {
        const ticket = await createTicket({
          data: { videoName: upload.name, videoType: contentType, videoSize: upload.size },
        });
        await uploadToR2(ticket.videoUploadUrl, upload, contentType, (pct) =>
          setStage("video", { pct, detail: `${pct}% of ${formatBytes(upload.size)} transferred` }),
        ).promise;
        videoKey = ticket.videoKey;
        videoUrl = ticket.videoUrl;
      }
      setStage("video", { pct: 100, state: "done", detail: "Video stored on R2 + CDN." });

      // 3) Poster → Cloudinary
      setStage("poster", { state: "active", detail: "Uploading poster to Cloudinary…" });
      const posterSign = await posterSignPromise;
      const poster = await uploadToCloudinary(
        posterSign,
        thumb.blob,
        "poster.jpg",
        (pct) => setStage("poster", { pct, detail: `Uploading poster… ${pct}%` }),
      ).promise;
      posterId = poster.publicId;
      posterUrl = poster.secureUrl;
      setStage("poster", { pct: 100, state: "done", detail: "Poster stored on Cloudinary." });

      // 4) Persist the record
      setStage("record", { state: "active", pct: 40, detail: "Writing database record…" });
      await insertMedia({
        title: title.trim(),
        video_url: videoUrl,
        poster_uri: posterUrl,
        category: categories.join(", "),
        actors,
        duration_seconds: Math.max(1, Math.round(duration)),
      });
      setStage("record", { pct: 100, state: "done", detail: "Saved." });

      toast.success("Published to the LumiX library.");
      onCreated();
      resetAll();
    } catch (error) {
      const message = (error as Error).message;
      setStages((prev) => ({
        compress: prev.compress.state === "done" ? prev.compress : { ...prev.compress, state: "error" },
        video: prev.video.state === "done" ? prev.video : { ...prev.video, state: "error" },
        poster: prev.poster.state === "done" ? prev.poster : { ...prev.poster, state: "error" },
        record: { ...prev.record, state: "error", detail: message },
      }));

      // Abandon a half-finished multipart upload so R2 keeps no orphan chunks.
      if (multipart) {
        try {
          await abortMultipart({ data: multipart });
        } catch {
          /* best effort */
        }
      }

      if (videoKey || posterId) {
        try {
          await purge({ data: { videoKey, cloudinaryPublicId: posterId } });
          toast.error(`Upload failed — rolled back stored files. ${message}`);
        } catch {
          toast.error(`Upload failed: ${message}. Some files may need manual cleanup.`);
        }
      } else {
        toast.error(`Upload failed: ${message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <GlassPanel className="p-4 sm:p-6">
        <SectionHeading eyebrow="Ingest" title="New media drop" />

        {/* Step 1 — source */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleFile(dropped);
          }}
          className={cn(
            "glass neon-edge grid-noise relative grid place-items-center px-4 py-8 text-center",
            file && "py-6",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void handleFile(picked);
            }}
          />
          <span className="bg-gradient-cyan glow-cyan mb-3 grid size-12 place-items-center rounded-2xl">
            <CloudUpload className="text-primary-foreground size-6" />
          </span>
          {file ? (
            <div className="w-full">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                {formatBytes(file.size)} · {formatDuration(duration)}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => inputRef.current?.click()}
                >
                  <RotateCcw className="size-4" /> Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={resetMedia}
                >
                  <Trash2 className="size-4" /> Remove
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold">Drop a video or browse</p>
              <p className="text-muted-foreground mt-1 text-xs">
                MP4 / WebM / MOV · duration and 6 poster frames are detected automatically
              </p>
              <Button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="bg-gradient-cyan glow-cyan spring-press text-primary-foreground mt-4 font-semibold"
              >
                <Film className="size-4" /> Choose video
              </Button>
            </>
          )}
        </div>

        {analyzing ? (
          <div className="mt-4">
            <StageProgress
              label="Analyzing video · extracting 6 frames"
              pct={analyzePct}
              state="active"
              detail="Reading duration and capturing evenly spaced thumbnails"
            />
          </div>
        ) : null}

        {/* Step 2 — thumbnail choice */}
        {thumbs.length > 0 ? (
          <div className="mt-5">
            <Label className="mb-2 block">Poster frame</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {thumbs.map((thumb) => {
                const active = selectedThumb === thumb.id;
                return (
                  <button
                    key={thumb.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => setSelectedThumb(thumb.id)}
                    className={cn(
                      "spring-press relative aspect-video overflow-hidden rounded-xl border transition-all",
                      active
                        ? "border-primary glow-cyan scale-[1.02]"
                        : "border-border hover:border-primary/60",
                    )}
                  >
                    <img
                      src={thumb.url}
                      alt={`Frame at ${formatDuration(thumb.atSeconds)}`}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    <span className="bg-background/70 absolute right-1.5 bottom-1.5 rounded-md px-1.5 py-0.5 font-mono text-[0.6rem] backdrop-blur-sm">
                      {formatDuration(thumb.atSeconds)}
                    </span>
                    {active ? (
                      <span className="bg-gradient-cyan text-primary-foreground absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[0.6rem] font-bold">
                        SELECTED
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </GlassPanel>

      {/* Step 3 — metadata + pipeline */}
      <GlassPanel className="p-4 sm:p-6">
        <SectionHeading eyebrow="Metadata" title="Everything is required" />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              disabled={submitting}
              onChange={(e) => setTitle(e.target.value.slice(0, 160))}
              placeholder="Neon Horizon — Episode 01"
            />
          </div>

          <div className="space-y-2">
            <Label>Categories</Label>
            <CategoryPicker
              value={categories}
              onChange={setCategories}
              suggestions={categorySuggestions}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label>Actors</Label>
            <TagPicker
              value={actors}
              onChange={setActors}
              suggestions={actorSuggestions}
              disabled={submitting}
              icon={Users}
              tone="pink"
              placeholder="Search or type a new cast member"
              emptyText="No actor selected yet."
              maxLength={60}
            />
          </div>


          <div className="space-y-2">
            <Label htmlFor="duration">Duration (seconds · auto-detected)</Label>
            <Input
              id="duration"
              inputMode="numeric"
              value={duration || ""}
              disabled={submitting}
              onChange={(e) => setDuration(Number(e.target.value.replace(/\D/g, "")) || 0)}
              placeholder="Select a video first"
            />
            <p className="text-muted-foreground font-mono text-xs">{formatDuration(duration)}</p>
          </div>

          {!ready ? (
            <p className="glass text-destructive px-3 py-2 text-xs">
              Cloudflare R2 or Cloudinary credentials are missing, so publishing is disabled.
            </p>
          ) : null}

          <Button
            type="button"
            disabled={!complete || submitting}
            onClick={submit}
            className="bg-gradient-cyan glow-cyan spring-press text-primary-foreground h-12 w-full text-base font-bold disabled:opacity-40"
          >
            <Sparkles className="size-5" />
            {submitting ? "Publishing…" : "Compress, upload & publish"}
          </Button>

          <div className="space-y-2">
            <StageProgress
              label="1 · Smart compression (on-device)"
              pct={stages.compress.pct}
              state={stages.compress.state}
              detail={stages.compress.detail}
            />
            <StageProgress
              label="2 · Video → Cloudflare R2 (parallel chunks)"
              pct={stages.video.pct}
              state={stages.video.state}
              detail={stages.video.detail}
              tone="pink"
            />

            <StageProgress
              label="3 · Poster → Cloudinary"
              pct={stages.poster.pct}
              state={stages.poster.state}
              detail={stages.poster.detail}
            />
            <StageProgress
              label="4 · Database record"
              pct={stages.record.pct}
              state={stages.record.state}
              detail={stages.record.detail}
              tone="emerald"
            />

          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
