/** XHR-based uploads so we get real byte-level progress percentages. */

export type ProgressFn = (pct: number) => void;

export type UploadHandle = { promise: Promise<void>; abort: () => void };

/**
 * Direct-to-R2 upload with a presigned PUT URL.
 * Returns an abortable handle so a failed step can cancel siblings.
 */
export function uploadToR2(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: ProgressFn,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (${xhr.status}). ${xhr.responseText || ""}`.trim()));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Network error during upload. Check that the R2 bucket allows PUT from this origin (CORS).",
        ),
      );
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(body);
  });

  return { promise, abort: () => xhr.abort() };
}

export type CloudinarySignature = {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
};

export type CloudinaryResult = { publicId: string; secureUrl: string };

/** Direct-to-Cloudinary signed upload with byte-level progress. */
export function uploadToCloudinary(
  config: CloudinarySignature,
  file: Blob,
  filename: string,
  onProgress?: ProgressFn,
): { promise: Promise<CloudinaryResult>; abort: () => void } {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(config.timestamp));
  form.append("folder", config.folder);
  form.append("signature", config.signature);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<CloudinaryResult>((resolve, reject) => {
    xhr.open("POST", config.uploadUrl, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload: { public_id?: string; secure_url?: string; error?: { message?: string } } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.public_id && payload.secure_url) {
        onProgress?.(100);
        resolve({ publicId: payload.public_id, secureUrl: payload.secure_url });
      } else {
        reject(
          new Error(
            payload.error?.message ?? `Cloudinary rejected the poster upload (${xhr.status}).`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading the poster to Cloudinary."));
    xhr.onabort = () => reject(new Error("Poster upload cancelled."));
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}
