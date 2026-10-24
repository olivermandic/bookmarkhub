import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// base "./": all asset URLs are relative. The server injects <base href> with the
// install path (BASE_PATH), so the app works at the domain root and in a subfolder.
export default defineConfig({
  base: "./",
  server: { host: "::", port: 8080, proxy: { "/api": "http://localhost:3131" } },
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "2.1.0") },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { chunkSizeWarningLimit: 700 },
});
