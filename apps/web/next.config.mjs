// SPDX-License-Identifier: AGPL-3.0-only
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // One image runs web or worker, and the worker needs the compiled output on disk.
  output: "standalone",
  // @aeyhey/core ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ["@aeyhey/core"],
  // better-sqlite3 and argon2 are native and must not be bundled.
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "postgres", "unpdf", "mammoth"],

  // Both this app and @aeyhey/core are written as Node ESM, so a relative import carries
  // a .js extension even though the file on disk is .ts. TypeScript understands that;
  // the bundler has to be told.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },

  turbopack: {
    resolveAlias: {},
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
  // /api/v1/... is the stable path for apps outside this codebase, such as the phone
  // app. Today it is the same handlers as /api/...; when a breaking change comes, /api/v1
  // keeps the old behaviour and /api/v2 gets the new one. See docs/api.md.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/api/v1/:path*", destination: "/api/:path*" }],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Only what the PWA actually needs. No camera, no microphone, no location.
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
