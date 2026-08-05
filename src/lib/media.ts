/** Browser-side media helpers: duration probing and evenly spaced thumbnail extraction. */

export type Thumbnail = {
  id: string;
  atSeconds: number;
  url: string;
  blob: Blob;
};

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function loadVideo(file: File): Promise<{ video: HTMLVideoElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    const revoke = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => resolve({ video, revoke });
    video.onerror = () => {
      revoke();
      reject(new Error("This video format can't be read by the browser. Try an MP4/WebM file."));
    };
  });
}

export async function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  const { video, revoke } = await loadVideo(file);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const meta = { duration, width: video.videoWidth, height: video.videoHeight };
  revoke();
  if (!meta.duration) throw new Error("Could not read the video duration.");
  return meta;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("error", onError);
      reject(new Error("Seeking failed while generating thumbnails."));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = Math.min(Math.max(time, 0.05), Math.max(video.duration - 0.05, 0.05));
  });
}

/**
 * Grabs `count` frames at equal percentage steps through the clip.
 * onProgress reports 0..100 so the UI can show a real percentage.
 */
export async function extractThumbnails(
  file: File,
  count = 6,
  onProgress?: (pct: number) => void,
): Promise<Thumbnail[]> {
  const { video, revoke } = await loadVideo(file);
  const duration = video.duration;
  const canvas = document.createElement("canvas");
  const targetWidth = Math.min(video.videoWidth || 1280, 1280);
  const scale = targetWidth / (video.videoWidth || targetWidth);
  canvas.width = targetWidth;
  canvas.height = Math.round((video.videoHeight || 720) * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    revoke();
    throw new Error("Canvas is unavailable in this browser.");
  }

  const shots: Thumbnail[] = [];
  try {
    for (let i = 0; i < count; i += 1) {
      const at = (duration * (i + 0.5)) / count;
      await seek(video, at);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Frame capture failed."))),
          "image/jpeg",
          0.86,
        ),
      );
      shots.push({
        id: `frame-${i}`,
        atSeconds: at,
        blob,
        url: URL.createObjectURL(blob),
      });
      onProgress?.(Math.round(((i + 1) / count) * 100));
    }
  } finally {
    revoke();
  }
  return shots;
}
