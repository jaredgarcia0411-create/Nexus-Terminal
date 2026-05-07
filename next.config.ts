import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote profile images.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  // The agent prompts loader reads .md files at runtime via path.join(process.cwd(), ...).
  // Next's static tracer can't follow dynamic paths, so the prompts get dropped from the
  // serverless bundle. This explicitly bundles them for the only Vercel route that imports
  // an agent blueprint (research-report).
  outputFileTracingIncludes: {
    '/api/research-report': ['./lib/agents/prompts/**/*.md'],
  },
  webpack: (config, {dev}) => {
    // HMR can be disabled via DISABLE_HMR env var for agent workflows.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
