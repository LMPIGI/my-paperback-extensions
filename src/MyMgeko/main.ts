import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  ContentRating,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverSectionProviding,
  DiscoverSectionType,
  Extension,
  Form,
  MangaProviding,
  PagedResults,
  SearchFilter,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SettingsFormProviding,
  SortingOption,
  SourceManga
} from "@paperback/types";

import * as cheerio from "cheerio";
import { Forms } from "./forms";
import {
  baseUrl,
  blacklistedTags,
  blacklistedType,
  getGenreFilter,
  getMangaTypeFilter,
  getOrderFilter,
  getPageCache,
  getRating,
  getStatusFilter,
  getYearFilter,
  Metadata,
  populateFilter
} from "./helpers";
import { MainInterceptor } from "./interceptors";
import { Parsers } from "./parsers";
import { Requests } from "./requests";

// Should match the capabilities declared in pbconfig.ts
type Impl =
  SettingsFormProviding &
  Extension &
  DiscoverSectionProviding &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding;

export class MgekoExtension implements Impl {
  // Global rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 15,
    bufferInterval: 10,
    ignoreImages: true
  });
  RETRIES = 10;

  private parser = new Parsers();
  private requests = new Requests();

  // Interceptor (strips HTML comments in interceptors.ts)
  mainInterceptor = new MainInterceptor("main");

  /** Initialise rate limiter + interceptor */
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  /** Settings form */
  async getSettingsForm(): Promise<Form> {
    await populateFilter();
    return new Forms();
  }

  /** Search filters */
  async getSearchFilters(): Promise<SearchFilter[]> {
    await populateFilter();

    const filters: SearchFilter[] = [];
    const defValue = ((Application.getState("def_type") as string[]) ?? [])[0];

    const excludedTypes = {
      ...Object.fromEntries(
        getMangaTypeFilter()
          .filter(opt => blacklistedType(opt.id))
          .map(opt => [opt.id, "excluded" as const])
      ),
      ...(defValue ? { [defValue.toLowerCase()]: "included" as const } : {})
    } as Record<string, "included" | "excluded">;

    const excludedGenres = Object.fromEntries(
      getGenreFilter()
        .filter(opt => blacklistedTags([opt.id]))
        .map(opt => [opt.id, "excluded" as const])
    ) as Record<string, "included" | "excluded">;

    if (getMangaTypeFilter().length) {
      filters.push({
        type: "multiselect",
        options: getMangaTypeFilter(),
        id: "types",
        allowExclusion: true,
        title: "Type",
        value: excludedTypes,
        allowEmptySelection: true,
        maximum: 3
      });
    }

    if (getGenreFilter().length) {
      filters.push({
        type: "multiselect",
        options: getGenreFilter(),
        id: "genres",
        allowExclusion: true,
        title: "Genre",
        value: excludedGenres,
        allowEmptySelection: true,
        maximum: 5
      });
    }

    if (getStatusFilter().length) {
      filters.push({
        type: "dropdown",
        options: getStatusFilter(),
        id: "status",
        title: "Status",
        value: ""
      });
    }

    if (getYearFilter().length) {
      filters.push({
        type: "dropdown",
        options: getYearFilter(),
        id: "year",
        title: "Year",
        value: ""
      });
    }

    return filters;
  }

  /** Search results */
  async getSearchResults(
    query: SearchQuery,
    metadata: Metadata,
    _sorting: SortingOption
  ): Promise<PagedResults<SearchResultItem>> {
    const items: SearchResultItem[] = [];
    let page = Math.max(metadata?.page ?? 1, 1);

    for (let cycle = 0; cycle < 5 && items.length < 16; cycle++, page++) {
      const url = this.requests.searchUrl(query.title ?? "", page);
      const buf = await getPageCache(`search-${page}-${query.title ?? ""}`, url);
      const $ = cheerio.load(Application.arrayBufferToUTF8String(buf));
      const parsed = this.parser.parseSearchResults($);
      items.push(...parsed);
      if (parsed.length === 0) break;
    }

    return { items, metadata: { page } };
  }

  /** Title details page */
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.requests.mangaUrl(mangaId);
    const buf = await getPageCache(mangaId, url);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buf));
    return this.parser.parseMangaDetails($, mangaId, url);
  }

  /** Chapters list */
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.requests.mangaUrl(sourceManga.mangaId);
    const buf = await getPageCache(sourceManga.mangaId, url);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buf));
    return this.parser.parseChapters($, sourceManga);
  }

  /** Pages for a chapter */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.requests.readerUrl(chapter.sourceManga.mangaId, chapter.chapterId);
    const buf = await getPageCache(`${chapter.sourceManga.mangaId}-${chapter.chapterId}`, url);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buf));

    // Primary: scoped images
    let pages = $("#reader, .reading-content, .reader, main")
      .find("img.page, img[data-src], img[data-original], img[src]")
      .map((_, el) => ($(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || "").trim())
      .get()
      .filter(Boolean);

    // Fallback: broader search if DOM is malformed
    if (pages.length < 6) {
      const root = $("#reader, .reading-content, .reader, main").first().length
        ? $("#reader, .reading-content, .reader, main").first()
        : $("img").closest("main, body");

      const broad = root.find("img")
        .map((_, el) => ($(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || "").trim())
        .get()
        .filter(Boolean);

      const seen = new Set<string>();
      pages = [...pages, ...broad].filter(p => (seen.has(p) ? false : (seen.add(p), true)));
    }

    return { id: chapter.chapterId, sourceManga: chapter.sourceManga, pages };
  }

  /** Discover sections */
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular_section",
        title: "Trending",
        type: DiscoverSectionType.featured
      },
      {
        id: "updated_section",
        title: "Recently Updated",
        subtitle: "Latest chapters added",
        type: DiscoverSectionType.chapterUpdates
      }
    ];
  }

  /** Items for each Discover section */
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const buf = await getPageCache("home", baseUrl);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buf));

    switch (section.id) {
      case "popular_section":
        return this.parser.parseTrendingChapters($, metadata) as any;
      case "updated_section":
        return this.parser.parseLastAddedSection($, metadata) as any;
      default:
        return { items: [], metadata };
    }
  }

  /** Sort options for search */
  async getSortingOptions(): Promise<SortingOption[]> {
    return getOrderFilter().map(item => ({ id: item.id, label: item.value }));
  }
}

export const Mgeko = new MgekoExtension();
