import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Static Ventory for GitHub Pages (https://oscarvelz.github.io/Ventory/): the Grok server functions and auth are
// swapped for the browser versions in src/spa (local floor + Supabase sync). The UI files are the Grok app's own.
export default defineConfig({
  root: "spa",
  base: "./",
  publicDir: r("./public"),
  resolve: {
    alias: [
      { find: "@/lib/ventory/server", replacement: r("./src/spa/api.ts") },
      { find: "@/lib/auth/gates", replacement: r("./src/spa/gates.tsx") },
      { find: "@", replacement: r("./src") },
    ],
  },
  plugins: [tailwindcss(), viteReact()],
  build: { outDir: "../dist", emptyOutDir: true, assetsDir: "", chunkSizeWarningLimit: 4000 },
});
