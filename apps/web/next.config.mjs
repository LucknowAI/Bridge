import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone with only the files actually reached, which is what
  // the Docker runtime stage copies. Keeps the ECS image small.
  output: "standalone",

  // Workspace packages ship raw TypeScript, so Next has to compile them.
  transpilePackages: ["@match-maker/db", "@match-maker/auth", "@match-maker/email"],

  // Without this, tracing starts at apps/web and misses ../../packages and the
  // hoisted node_modules at the workspace root.
  outputFileTracingRoot: join(here, "../../"),

  // `pg` uses dynamic requires that must not be bundled into the server build.
  serverExternalPackages: ["pg"],

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
