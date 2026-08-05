import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function cloudinaryEnv() {
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ posterSize: z.number().int().positive().max(MAX_POSTER_BYTES) })
      .parse(input ?? { posterSize: 1 }),
  )
  .handler(async () => {
    const { cloudName, apiKey, apiSecret } = cloudinaryEnv();
   
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        videoKey: z.string().max(300).nullable().optional(),
        cloudflareUid: z.string().max(300).nullable().optional(),
        cloudinaryPublicId: z.string().max(300).nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const videoKey = data.videoKey ?? data.cloudflareUid ?? null;
    const posterId = data.cloudinaryPublicId ?? null;

    let video = "skipped";
    let poster = "skipped";

    if (videoKey) {
      try {
        const { r2Env, deleteR2Object } = await import("./r2.server");
        video = (await deleteR2Object(r2Env(), videoKey)) ? "deleted" : "failed";
      } catch (error) {
        video = `failed (${(error as Error).message})`;
      }
    }

    if (posterId) {
      try {
        const { cloudName, apiKey, apiSecret } = cloudinaryEnv();

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
  const { r2Configured } = await import("./r2.server");
  const r2Ready = r2Configured();
  const cloudinaryReady = Boolean(
    process.env["CLOUDINARY_CLOUD_NAME"] &&
    process.env["CLOUDINARY_API_KEY"] &&
    process.env["CLOUDINARY_API_SECRET"],
  );
  return { r2Ready, cloudinaryReady, cloudflareReady: r2Ready };
});