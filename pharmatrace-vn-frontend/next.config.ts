import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'lucide-react', 'recharts'],
  },
};

export default nextConfig;
