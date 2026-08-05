/**
 * Public URL -> provider object key helpers.
 *
 * The `metatable` row only stores the public URLs, so deletions derive the
 * underlying R2 object key and Cloudinary public id straight from them.
 */

/** `https://cdn.example.com/videos/abc-file.mp4` -> `videos/abc-file.mp4` */
export function r2KeyFromUrl(videoUrl: string | null | undefined, publicBase?: string): string | null {
  if (!videoUrl) return null;
  try {
    const url = new URL(videoUrl);
    let path = url.pathname.replace(/^\/+/, "");
    if (publicBase) {
      const base = new URL(publicBase);
      if (base.host !== url.host) return null;
      const basePath = base.pathname.replace(/^\/+|\/+$/g, "");
      if (basePath && path.startsWith(`${basePath}/`)) path = path.slice(basePath.length + 1);
    }
    if (!path) return null;
    return path
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

/**
 * `https://res.cloudinary.com/<cloud>/image/upload/v1712/lumix/posters/x.jpg`
 * -> `lumix/posters/x`
 */
export function cloudinaryIdFromUrl(posterUrl: string | null | undefined): string | null {
  if (!posterUrl) return null;
  try {
    const { pathname } = new URL(posterUrl);
    const match = /\/upload\/(.+)$/.exec(pathname);
    if (!match?.[1]) return null;
    const withoutTransforms = match[1]
      .split("/")
      .filter((segment) => !/^v\d+$/.test(segment))
      // transformation segments look like `w_400,c_fill`
      .filter((segment) => !/^[a-z]{1,3}_[^/]*$/.test(segment))
      .join("/");
    return decodeURIComponent(withoutTransforms.replace(/\.[a-z0-9]+$/i, "")) || null;
  } catch {
    return null;
  }
}
