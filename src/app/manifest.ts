import type { MetadataRoute } from "next";

/** App installabile; share_target la fa comparire nel «Condividi» di Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Second Brain",
    short_name: "Second Brain",
    description: "La tua memoria personale, con l'IA che propone e tu che confermi.",
    lang: "it",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nuova cattura", url: "/inbox", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Assistente", url: "/assistente", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    share_target: {
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        // Solo tipi MIME: su Android le estensioni (".pdf") possono far scartare i file condivisi.
        files: [{ name: "file", accept: ["image/*", "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "audio/*"] }],
      },
    },
  } as MetadataRoute.Manifest;
}
