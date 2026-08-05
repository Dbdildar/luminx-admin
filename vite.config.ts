// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Server-side credentials (Supabase, Cloudinary, R2) live in .env WITHOUT the VITE_ prefix,
// so Vite does not expose them. Inject them into the SSR/server environment only, so
// server functions can read process.env[...] both in dev and in the Cloudflare build.
const SERVER_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PROJECT_ID",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
];

const fileEnv = loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), "");

const serverDefine = {
  __LUMIX_SERVER_ENV__: JSON.stringify(
    Object.fromEntries(SERVER_ENV_KEYS.filter((key) => fileEnv[key]).map((key) => [key, fileEnv[key]])),
  ),
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    environments: {
      ssr: { define: serverDefine },
      server: { define: serverDefine },
    },
  },
});
