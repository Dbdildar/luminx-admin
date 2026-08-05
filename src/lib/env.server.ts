/**
 * Server-only env hydration.
 *
 * Non-VITE_ credentials in `.env` (Supabase, Cloudinary, Cloudflare R2) are not exposed by
 * Vite, and in the Cloudflare Worker runtime `process.env` starts empty. The Vite config
 * injects them as the `__LUMIX_SERVER_ENV__` constant for the server environments only;
 * this module copies them into `process.env` so every server helper can read them normally.
 */

declare const __LUMIX_SERVER_ENV__: Record<string, string> | undefined;

const injected: Record<string, string> =
  typeof __LUMIX_SERVER_ENV__ !== "undefined" && __LUMIX_SERVER_ENV__ ? __LUMIX_SERVER_ENV__ : {};

export function hydrateServerEnv(bindings?: Record<string, unknown>): void {
  const target = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (!target) return;

  for (const [key, value] of Object.entries(injected)) {
    if (!target[key] && value) target[key] = value;
  }

  if (bindings) {
    for (const [key, value] of Object.entries(bindings)) {
      if (!target[key] && typeof value === "string" && value) target[key] = value;
    }
  }
}

hydrateServerEnv();
