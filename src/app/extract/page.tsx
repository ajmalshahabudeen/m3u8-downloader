import { ExtractForm } from "@/components/downloads/extract-form";
import { DownloadsList } from "@/components/downloads/downloads-list";

export default function ExtractPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Extract from video URL
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Paste a video page link. The app fetches the page, reads the title,
          and looks for HLS <span className="font-mono text-foreground">.m3u8</span>{" "}
          playlists so you can queue a download in one step.
        </p>
      </div>

      <ExtractForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent downloads</h2>
        <DownloadsList emptyMessage="Extract a stream above to start downloading." />
      </section>
    </div>
  );
}
