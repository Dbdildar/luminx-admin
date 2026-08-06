import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";


/**
 * Split delivery:
 *  - poster image  -> Cloudinary (signed direct browser upload)
 *  - video file    -> Cloudflare R2 (SigV4 presigned PUT, real progress)
 * Both public URLs are then persisted in Supabase. Any failure rolls back by
 * deleting whatever was already stored on either provider.
 */

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_POSTER_BYTES = 15 * 1024 * 1024;
const POSTER_FOLDER = "lumix/posters";

async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cloudinaryEnv() {
  const { hydrateServerEnv } = await import("./env.server");
  hydrateServerEnv();
  const cloudName = process.env["CLOUDINARY_CLOUD_NAME"];
  const apiKey = process.env["CLOUDINARY_API_KEY"];
  const apiSecret = process.env["CLOUDINARY_API_SECRET"];
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Missing Cloudinary environment variables");
  }
  return { cloudName, apiKey, apiSecret };
}

/** Signed params for a direct browser -> Cloudinary poster upload. */
export const signPosterUpload = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ posterSize: z.number().int().positive().max(MAX_POSTER_BYTES) })
      .parse(input ?? { posterSize: 1 }),
  )
  .handler(async () => {
    const { cloudName, apiKey, apiSecret } = await cloudinaryEnv();
   
    const timestamp = Math.floor(Date.now() / 1000);

    // Only folder + timestamp here (since client will send exactly these)
    const params = `folder=${POSTER_FOLDER}&timestamp=${timestamp}`;
    const signature = await sha1Hex(params + apiSecret);


    return {
      cloudName,
      apiKey,
      timestamp,
      signature,
      folder: POSTER_FOLDER,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    };
  });

/** Presigned PUT for the video object on R2. */
export const createUploadTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        videoName: z.string().min(1).max(200),
        videoType: z.string().min(3).max(100),
        videoSize: z.number().int().positive().max(MAX_VIDEO_BYTES),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.videoType.startsWith("video/")) throw new Error("Only video files are accepted.");

    const { hydrateServerEnv } = await import("./env.server");
    hydrateServerEnv();
    const { r2Env, presignR2, buildObjectKey, publicUrlFor } = await import("./r2.server");
    const env = r2Env();

    const videoKey = buildObjectKey("videos", data.videoName);
    const videoUploadUrl = await presignR2({
      env,
      key: videoKey,
      method: "PUT",
      expiresIn: 6 * 3600,
    });

    return { videoKey, videoUploadUrl, videoUrl: publicUrlFor(env, videoKey) };
  });

/** Best-effort cleanup used by rollback and by record deletion. */
export const purgeAssets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        videoKey: z.string().max(300).nullable().optional(),
        cloudflareUid: z.string().max(300).nullable().optional(),
        cloudinaryPublicId: z.string().max(300).nullable().optional(),
        videoUrl: z.string().max(2000).nullable().optional(),
        posterUrl: z.string().max(2000).nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { r2KeyFromUrl, cloudinaryIdFromUrl } = await import("./asset-keys");
    const { hydrateServerEnv: hydrate } = await import("./env.server");
    hydrate();

    const videoKey =
      data.videoKey ??
      data.cloudflareUid ??
      r2KeyFromUrl(data.videoUrl, process.env["R2_PUBLIC_URL"] ?? undefined);
    const posterId = data.cloudinaryPublicId ?? cloudinaryIdFromUrl(data.posterUrl);

    let video = "skipped";
    let poster = "skipped";


    if (videoKey) {
      try {
        const { hydrateServerEnv } = await import("./env.server");
        hydrateServerEnv();
        const { r2Env, deleteR2Object } = await import("./r2.server");
        video = (await deleteR2Object(r2Env(), videoKey)) ? "deleted" : "failed";
      } catch (error) {
        video = `failed (${(error as Error).message})`;
      }
    }

    if (posterId) {
      try {
        const { cloudName, apiKey, apiSecret } = await cloudinaryEnv();

        const timestamp = Math.floor(Date.now() / 1000);

        // Include *public_id* as well, since you send it in the body
        const params = `public_id=${posterId}&timestamp=${timestamp}`;
        const signature = await sha1Hex(params + apiSecret);

        const body = new URLSearchParams({
          public_id: posterId,
          timestamp: String(timestamp),
          api_key: apiKey,
          signature,
        });
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const json = (await res.json().catch(() => ({}))) as { result?: string };
        poster = res.ok && (json.result === "ok" || json.result === "not found")
          ? "deleted"
          : `failed (${json.result ?? res.status})`;
      } catch (error) {
        poster = `failed (${(error as Error).message})`;
      }
    }

    return { video, poster };
  });


/** Lets the UI warn before a user wastes an upload. */
export const getDeliveryConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { hydrateServerEnv } = await import("./env.server");
  hydrateServerEnv();
  const { r2Configured } = await import("./r2.server");
  const r2Ready = r2Configured();
  const cloudinaryReady = Boolean(
    process.env["CLOUDINARY_CLOUD_NAME"] &&
    process.env["CLOUDINARY_API_KEY"] &&
    process.env["CLOUDINARY_API_SECRET"],
  );
  return { r2Ready, cloudinaryReady, cloudflareReady: r2Ready };
});

/* ---------------- Multipart (parallel) video upload ---------------- */

/** Opens a multipart upload and hands back presigned URLs for every part. */
export const createMultipartTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        videoName: z.string().min(1).max(200),
        videoType: z.string().min(3).max(100),
        videoSize: z.number().int().positive().max(MAX_VIDEO_BYTES),
        partCount: z.number().int().positive().max(10000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.videoType.startsWith("video/")) throw new Error("Only video files are accepted.");
    const { hydrateServerEnv } = await import("./env.server");
    hydrateServerEnv();
    const mod = await import("./r2.server");
    const env = mod.r2Env();
    const videoKey = mod.buildObjectKey("videos", data.videoName);
    const uploadId = await mod.createMultipartUpload(env, videoKey, data.videoType);
    const partUrls = await mod.presignParts(
      env,
      videoKey,
      uploadId,
      Array.from({ length: data.partCount }, (_, i) => i + 1),
    );
    return { videoKey, uploadId, partUrls, videoUrl: mod.publicUrlFor(env, videoKey) };
  });

export const completeMultipartTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        videoKey: z.string().min(1).max(300),
        uploadId: z.string().min(1).max(400),
        parts: z
          .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
          .min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { hydrateServerEnv } = await import("./env.server");
    hydrateServerEnv();
    const mod = await import("./r2.server");
    const env = mod.r2Env();
    await mod.completeMultipartUpload(env, data.videoKey, data.uploadId, data.parts);
    return { ok: true, videoUrl: mod.publicUrlFor(env, data.videoKey) };
  });

export const abortMultipartTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ videoKey: z.string().min(1).max(300), uploadId: z.string().min(1).max(400) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      const { hydrateServerEnv } = await import("./env.server");
    hydrateServerEnv();
    const mod = await import("./r2.server");
    const env = mod.r2Env();
      return { aborted: await mod.abortMultipartUpload(env, data.videoKey, data.uploadId) };
    } catch {
      return { aborted: false };
    }
  });
