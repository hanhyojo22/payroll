import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  test: {
    // Node by default; component tests opt into jsdom with a `@vitest-environment jsdom`
    // docblock so the pure domain suite keeps running without DOM overhead.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
