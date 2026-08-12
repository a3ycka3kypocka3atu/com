import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
      { protocol: "https", hostname: "i.pravatar.cc", pathname: "/**" },
      { protocol: "https", hostname: "uaaszmcfancqxrhkoamc.supabase.co", pathname: "/storage/v1/**" },
    ],
  },
};

export default nextConfig;
