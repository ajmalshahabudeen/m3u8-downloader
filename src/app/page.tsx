import { SingleDownloadForm } from "@/components/downloads/single-download-form";
import { DownloadsList } from "@/components/downloads/downloads-list";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Download an m3u8 stream
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Enter a title and paste your HLS playlist URL. The server queues the
          job and converts segments to a single MP4 file you can download when
          ready.
        </p>
      </div>

      <SingleDownloadForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent downloads</h2>
        <DownloadsList emptyMessage="Queue your first m3u8 link above." />
      </section>
    </div>
  );
}
