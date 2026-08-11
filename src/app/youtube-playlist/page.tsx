import { YouTubePlaylistForm } from "@/components/downloads/youtube-playlist-form";
import { DownloadsList } from "@/components/downloads/downloads-list";

export default function YouTubePlaylistPage() {
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          YouTube Playlist Downloader
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Dedicated YouTube playlist downloader powered by yt-dlp flat extraction.
          List all videos with accurate names, thumbnails, and durations — queue
          them one by one automatically.
        </p>
      </div>

      <YouTubePlaylistForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Download Queue & History</h2>
        <DownloadsList emptyMessage="Analyze a YouTube playlist link above to start downloading." />
      </section>
    </div>
  );
}
