/**
 * Minimal AWS SigV4 helper for Cloudflare R2 (S3 API).
 * Pure Web Crypto — works inside the edge/worker runtime, no aws-sdk bundle.
 */

export type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  endpoint: string;
};

export function r2Configured(): boolean {
  return Boolean(
    process.env["CLOUDFLARE_ACCOUNT_ID"] &&
      process.env["R2_ACCESS_KEY_ID"] &&
      process.env["R2_SECRET_ACCESS_KEY"] &&
      process.env["R2_BUCKET_NAME"] &&
      process.env["R2_PUBLIC_URL"],
  );
}

export function r2Env(): R2Env {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET_NAME"];
  const publicUrl = process.env["R2_PUBLIC_URL"];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error(
      "R2 storage is not configured. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_URL.",
    );
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: publicUrl.replace(/\/+$/, ""),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

function uriEncode(value: string, encodeSlash = true): string {
  return value
    .split("")
    .map((char) => {
      if (/[A-Za-z0-9_\-~.]/.test(char)) return char;
      if (char === "/") return encodeSlash ? "%2F" : "/";
      return Array.from(enc.encode(char))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    })
    .join("");
}

function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, short: iso.slice(0, 8) };
}

async function signingKey(env: R2Env, short: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${env.secretAccessKey}`);
  key = await hmac(key, short);
  key = await hmac(key, "auto");
  key = await hmac(key, "s3");
  return hmac(key, "aws4_request");
}

/** Presigned URL the browser can call directly (PUT for upload, DELETE for rollback). */
export async function presignR2(options: {
  env: R2Env;
  key: string;
  method: "PUT" | "GET" | "DELETE" | "POST";
  expiresIn?: number;
  /** Extra query params folded into the signature (multipart uses these). */
  query?: Record<string, string>;
}): Promise<string> {
  const { env, key, method } = options;
  const expires = Math.min(Math.max(options.expiresIn ?? 3600, 60), 7 * 24 * 3600);
  const { amz, short } = amzDate();
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${uriEncode(env.bucket, false)}/${uriEncode(key, false)}`;
  const credential = `${env.accessKeyId}/${short}/auto/s3/aws4_request`;

  const params: [string, string][] = [
    ...Object.entries(options.query ?? {}),
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amz],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];

  const canonicalQuery = params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    `${short}/auto/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hex(await hmac(await signingKey(env, short), stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Server-side object delete (used for rollback + record deletion). */
export async function deleteR2Object(env: R2Env, key: string): Promise<boolean> {
  const url = await presignR2({ env, key, method: "DELETE", expiresIn: 120 });
  const res = await fetch(url, { method: "DELETE" });
  return res.ok || res.status === 404;
}

export function publicUrlFor(env: R2Env, key: string): string {
  return `${env.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function buildObjectKey(prefix: string, fileName: string): string {
  const clean = fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ext = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "bin";
  const stamp = Date.now().toString(36);
  const rand = crypto.randomUUID().slice(0, 8);
  return `${prefix}/${stamp}-${rand}-${clean || "file"}.${ext}`;
}

/* ------------------------------------------------------------------ *
 * Multipart upload (parallel part transfer = much faster big uploads) *
 * ------------------------------------------------------------------ */

function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match?.[1]?.trim() ?? null;
}

/** Starts a multipart upload and returns its uploadId. */
export async function createMultipartUpload(
  env: R2Env,
  key: string,
  contentType: string,
): Promise<string> {
  const url = await presignR2({ env, key, method: "POST", expiresIn: 600, query: { uploads: "" } });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType } });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 refused to start the upload (${res.status}). ${text.slice(0, 200)}`);
  const uploadId = xmlValue(text, "UploadId");
  if (!uploadId) throw new Error("R2 did not return an upload id.");
  return uploadId;
}

/** Presigned PUT URLs, one per part, that the browser uploads in parallel. */
export async function presignParts(
  env: R2Env,
  key: string,
  uploadId: string,
  partNumbers: number[],
): Promise<string[]> {
  return Promise.all(
    partNumbers.map((partNumber) =>
      presignR2({
        env,
        key,
        method: "PUT",
        expiresIn: 6 * 3600,
        query: { partNumber: String(partNumber), uploadId },
      }),
    ),
  );
}

export async function completeMultipartUpload(
  env: R2Env,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const body = `<CompleteMultipartUpload>${parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(
      (p) =>
        `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/"/g, "&quot;")}</ETag></Part>`,
    )
    .join("")}</CompleteMultipartUpload>`;

  const url = await presignR2({ env, key, method: "POST", expiresIn: 900, query: { uploadId } });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/xml" }, body });
  const text = await res.text();
  if (!res.ok || text.includes("<Error>")) {
    throw new Error(`R2 could not finalise the upload (${res.status}). ${text.slice(0, 200)}`);
  }
}

export async function abortMultipartUpload(env: R2Env, key: string, uploadId: string): Promise<boolean> {
  const url = await presignR2({ env, key, method: "DELETE", expiresIn: 300, query: { uploadId } });
  const res = await fetch(url, { method: "DELETE" });
  return res.ok || res.status === 404;
}
