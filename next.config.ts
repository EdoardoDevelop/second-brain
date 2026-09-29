import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Identifica la build: VersionWatch ricarica le pagine aperte dopo un aggiornamento.
  // SB_BUILD_ID la fissa: con webpack (build locale) la configurazione si valuta più volte e l'ora cambierebbe tra client e server.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.SB_BUILD_ID || String(Date.now()) },
  serverExternalPackages: ["@libsql/client"],
  // I comandi vocali inviano l'audio (WAV 16 kHz, max 2 minuti) a una server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
