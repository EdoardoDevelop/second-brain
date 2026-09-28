import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { getLook } from "@/lib/settings";
import { fontUrl, parseMode, themeCss } from "@/lib/theme";
import "./industry.css";
import "./globals.css";
import { ThemeColor } from "@/components/ThemeColor";
import { Ripple } from "@/components/Ripple";
import { Lightbox } from "@/components/Lightbox";
import { PdfViewer } from "@/components/PdfViewer";

export const metadata: Metadata = {
  title: "Second Brain",
  description: "La tua memoria personale, con l'IA che propone e tu che confermi.",
  applicationName: "Second Brain",
  appleWebApp: { capable: true, title: "Second Brain", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const mode = parseMode(jar.get("sb_theme")?.value);
  const density = jar.get("sb_density")?.value === "compact" ? "compact" : "comfortable";
  const look = await getLook();
  const font = fontUrl(look.font);
  return (
    <html lang="it">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {font && <link id="sb-font" rel="stylesheet" href={font} />}
        {/* Aggiornato da ThemeColor con lo sfondo effettivo del tema. */}
        <meta name="theme-color" content={mode === "dark" ? "#111111" : "#ffffff"} />
        <style id="sb-theme" dangerouslySetInnerHTML={{ __html: themeCss(look) }} />
      </head>
      <body data-sb="1" data-theme={mode} data-density={density}>
        <ThemeColor />
        <Ripple />
        <Lightbox />
        <PdfViewer />
        {children}
      </body>
    </html>
  );
}
