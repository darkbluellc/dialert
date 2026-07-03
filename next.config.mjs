/** @type {import('next').NextConfig} */
const nextConfig = {
  // node-cron / nodemailer / simple-oauth2 are server-only; keep them external.
  serverExternalPackages: ["simple-oauth2", "node-cron", "nodemailer"],
  // Type errors still fail the build; skip lint so a style nit can't block deploys.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
