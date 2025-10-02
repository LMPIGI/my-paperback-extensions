import { SearchQuery, SortingOption } from "@paperback/types";
import * as cheerio from "cheerio";
import { baseUrl, getGenreFilter, getPageCache, URLBuilder } from "./helpers";

const toText = (ab: ArrayBuffer) => Application.arrayBufferToUTF8String(ab);
const loadClean = (html: string) => cheerio.load(html.replace(/<!--[\s\S]*?-->/g, ""));

export class Requests {
  /*───────────────────────────────────────────────────────────────────────────*
   *  A)  Sinon-style search URL builder + callers (matches the code you sent)
   *───────────────────────────────────────────────────────────────────────────*/

  constructSearchRequestURL(
    page: number,
    query: SearchQuery = { title: "", filters: [] },
    sorting: SortingOption | undefined,
  ): {
    url: string;
    excluded: { generi: string[]; tipi: string[] };
  } {
    const generi: string[] = [];
    const generi_esclusi: string[] = [];
    const tipi_esclusi: string[] = [];
    const tipologia: string[] = [];
    const stato: string[] = [];
    const anno: string[] = [];

    const getFilterValue = (id: string) => query.filters.find((f) => f.id == id)?.value;

    const genres: string | Record<string, "included" | "excluded"> = getFilterValue("genres") ?? "";
    const types:  string | Record<string, "included" | "excluded"> = getFilterValue("types")  ?? "";
    const status: string | Record<string, "included" | "excluded"> = getFilterValue("status") ?? "";
    const year:   string | Record<string, "included" | "excluded"> = getFilterValue("year")   ?? "";

    if (genres && typeof genres === "object") {
      for (const [id, mode] of Object.entries(genres)) {
        if (mode === "included") generi.push(id);
        if (mode === "excluded") {
          const label = getGenreFilter().find((item) => item.id === id)?.value ?? "";
          if (label) generi_esclusi.push(label);
        }
      }
    }

    if (types && typeof types === "object") {
      for (const [id, mode] of Object.entries(types)) {
        if (mode === "included") tipologia.push(id);
        if (mode === "excluded") tipi_esclusi.push(id);
      }
    }

    if (status && typeof status === "object") {
      for (const [id] of Object.entries(status)) if (id.length > 0) stato.push(id);
    } else if ((status as string).length > 0) stato.push(status as string);

    if (year && typeof year === "object") {
      for (const [id] of Object.entries(year)) if (id.length > 0) anno.push(id);
    } else if ((year as string).length > 0) anno.push(year as string);

    // NOTE: Many themes use /archive for listing + filters; adjust if your site differs.
    const urlBuilder = new URLBuilder(baseUrl).addPathComponent("archive"); // ← adjust if your site differs
    if ((query.title ?? "").toString().length > 0) {
      urlBuilder.addQueryParameter("keyword", (query.title ?? "").toString());
    }
    urlBuilder.addQueryParameter("page", page.toString());
    if (sorting?.id) urlBuilder.addQueryParameter("sort", sorting.id);
    if (generi.length)    urlBuilder.addQueryParameter("genre", generi);
    if (tipologia.length) urlBuilder.addQueryParameter("type",  tipologia);
    if (stato.length)     urlBuilder.addQueryParameter("status", stato[0]);
    if (anno.length)      urlBuilder.addQueryParameter("year",   anno[0]);

    return {
      url: urlBuilder.buildUrl(),
      excluded: { generi: generi_esclusi, tipi: tipi_esclusi },
    };
  }

  async getSearchResultsRequests(url: string) {
    const [, data] = await Application.scheduleRequest({ url, method: "GET" });
    return loadClean(toText(data));
    }

  async parseFilters() {
    // The reference scrapes filters from /archive. If Mgeko uses a different path,
    // change it here.
    const [, data] = await Application.scheduleRequest({
      url: `${baseUrl}/archive`, // ← adjust if your site differs
      method: "GET",
    });
    return loadClean(toText(data));
  }

  async parseLastMangaAddedSectionRequests(page: number) {
    if (page > 1) {
      const [, data] = await Application.scheduleRequest({
        url: `${baseUrl}/archive?sort=newest&page=${page}`, // ← adjust if needed
        method: "GET",
      });
      return loadClean(toText(data));
    } else {
      const buf = await getPageCache(
        "LastMangaAddedSection",
        `${baseUrl}/archive?sort=newest&page=${page}`, // ← adjust if needed
      );
      return loadClean(toText(buf));
    }
  }

  async parseLastAddedSectionRequests(page: number) {
    const [, data] = await Application.scheduleRequest({
      url: `${baseUrl}?page=${page}`, // homepage with pagination
      method: "GET",
    });
    return loadClean(toText(data));
  }

  async parsePopularSectionRequests(page: number) {
    if (page > 1) {
      const [, data] = await Application.scheduleRequest({
        url: `${baseUrl}/archive?sort=most_read&page=${page}`, // ← adjust if needed
        method: "GET",
      });
      return loadClean(toText(data));
    } else {
      const buf = await getPageCache(
        "PopularSection",
        `${baseUrl}/archive?sort=most_read&page=${page}`, // ← adjust if needed
      );
      return loadClean(toText(buf));
    }
  }

  async fetchPage(url: string): Promise<ArrayBuffer> {
    const [, responseData] = await Application.scheduleRequest({ url, method: "GET" });
    return responseData;
  }

  /*───────────────────────────────────────────────────────────────────────────*
   *  B)  Simple helpers (used by the main.ts I gave you earlier)
   *───────────────────────────────────────────────────────────────────────────*/

  /** Build a search URL for simple title queries (fallback) */
  searchUrl(title: string, page: number) {
    const q = encodeURIComponent(title ?? "");
    // Many WP themes support ?s=; if yours doesn’t, point to /archive?keyword=
    return q
      ? `${baseUrl}/?s=${q}&page=${page}`
      : `${baseUrl}/?page=${page}`;
  }

  /** Accepts either relative ID/path or absolute URL */
  mangaUrl(idOrPath: string) {
    if (/^https?:\/\//i.test(idOrPath)) return idOrPath;
    // If your work uses /manga/<id> change "manga" to your slug.
    return `${baseUrl}/manga/${idOrPath}`;
  }

  /** Reader URL – prefer list mode to expose all <img> on one page */
  readerUrl(mangaId: string, chapterId: string) {
    // If your route differs, update this pattern.
    return `${baseUrl}/manga/${mangaId}/read/${chapterId}/?style=list`;
  }

  /** Fetch page and return a cleaned Cheerio instance */
  async get$(url: string): Promise<cheerio.CheerioAPI> {
    const [, data] = await Application.scheduleRequest({ url, method: "GET" });
    return loadClean(toText(data));
  }
}
