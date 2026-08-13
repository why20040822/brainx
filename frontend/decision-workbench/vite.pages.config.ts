import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/client-job-decision-workbench/",
  plugins: [react()],
  root: "pages",
  build: {
    outDir: "../docs",
    emptyOutDir: true,
  },
});
