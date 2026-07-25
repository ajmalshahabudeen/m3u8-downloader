import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
  ],
  outputFileTracingIncludes: {
    "/api/**/*": ["./prisma/**/*", "./src/generated/**/*"],
  },
};

export default nextConfig;
