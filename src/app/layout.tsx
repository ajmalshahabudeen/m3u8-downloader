import type { Metadata } from "next";
import { Exo_2, JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";
import { GridPattern } from "@/components/magic-ui/grid-pattern";
import "./globals.css";

// https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap
const exo2 = Exo_2({
  variable: "--font-exo-2",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "m3u8 Downloader",
  description:
    "Download public videos & HLS — single, batch, extract, or all-video (yt-dlp).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${exo2.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col bg-background font-sans text-foreground">
        <Providers>
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <GridPattern
              width={48}
              height={48}
              className="[mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]"
              squares={[
                [2, 3],
                [6, 1],
                [8, 5],
                [12, 2],
                [15, 7],
              ]}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
          </div>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
            {children}
          </main>
          <footer className="border-t py-6 text-center font-mono text-xs text-muted-foreground">
            m3u8 Downloader · Next.js · Prisma · Redis/Celery · yt-dlp / ffmpeg
          </footer>
        </Providers>
      </body>
    </html>
  );
}
