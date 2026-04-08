import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }

          if (id.includes("node_modules/dompurify")) {
            return "vendor-dompurify";
          }

          if (id.includes("node_modules/prosemirror") || id.includes("node_modules/@tiptap/pm/")) {
            return "vendor-prosemirror";
          }

          if (id.includes("node_modules/@tiptap/")) {
            return "vendor-tiptap";
          }

          return undefined;
        }
      }
    }
  }
});
