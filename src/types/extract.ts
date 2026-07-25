export type ExtractResult = {
  pageUrl: string;
  title: string | null;
  m3u8Url: string | null;
  candidates: string[];
  /** direct | html | browser | none */
  source: "direct" | "html" | "browser" | "none" | string;
  warnings: string[];
  method?: string | null;
};
