import { AllVideoForm } from "@/components/downloads/all-video-form";
import { DownloadsList } from "@/components/downloads/downloads-list";

export default function AllVideoDownloaderPage() {
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          All-video downloader
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Universal public-link downloader powered by yt-dlp, ffmpeg HLS, and page
          extraction — queued on Redis/Celery workers for process isolation.
        </p>
      </div>
      <AllVideoForm />
      <DownloadsList />
    </div>
  );
}
