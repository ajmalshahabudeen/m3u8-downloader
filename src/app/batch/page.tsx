import { BatchDownloadForm } from "@/components/downloads/batch-download-form";
import { DownloadsList } from "@/components/downloads/downloads-list";

export default function BatchPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Batch m3u8 downloads
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Use the table to add multiple titles and m3u8 links, then start them
          together. Track progress, retry failures, and download completed
          files from the list below.
        </p>
      </div>

      <BatchDownloadForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Download queue</h2>
        <DownloadsList emptyMessage="Add rows above and start a batch." />
      </section>
    </div>
  );
}
