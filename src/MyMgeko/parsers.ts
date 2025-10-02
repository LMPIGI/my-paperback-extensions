import {
  Chapter,
  ChapterDetails,
  ContentRating,
  DiscoverSectionItem,
  MangaInfo,
  SearchResultItem,
  SourceManga,
  Tag,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import {
  blacklistedTags,
  blacklistedType,
  excludedTags,
  excludedTypes,
  getRating,
  Metadata,
} from "./helpers";
import { Requests } from "./requests";

const SEL = {
  // ---- DETAILS PAGE ----
  detailsTitle: ".name.bigger, h1.series-title, h1, .series-header .title",
  detailsCover: ".thumb img, .cover img, .series-cover img, .thumb.mb-3.text-center img",
  detailsDesc: "#noidungm, .description, .summary-content, .series-summary",

  // rows like "Status", "Artist", "Author", "Genres", "Also known as"
  metaRows: ".meta-data.row.px-1 .col-12, .meta .row .col, .series-meta .row > div",

  // ---- CHAPTER LIST ----
  chapterItem: ".chapter, .eplister li, .chapter-item, .chapters li",
  chapterVolName: ".volume-element .volume-name",
  chapterNumLabel: ".d-inline-block, .chapter-number, .chapternum",
  chapterDate: "i.text-right.text-muted.chap-date, time, .date",

  // ---- SEARCH / GRID CARDS ----
  gridItem: ".comics-grid .entry, .grid .entry, .cards .card, .series-card, .book-item",
  gridLink: "a[href]",
  gridTitle: "a[title], .title, .name",
  gridImg: "a img, img",
  gridType: ".genre a, .type a, .badge.type",
  gridAuthorWrap: "div.author",
  gridAuthors: "div.author a",
  gridTagsWrap: "div.genres",
  gridTags: "div.genres a",

  // ---- HOME / DISCOVER ----
  trendingEntry: ".entry.vertical, .trending .entry",
  trendingImg: "a img",
  trendingTitle: ".manga-title, .title",

  monthHotEntry: ".col-12 .top-wrapper .entry, .hot .entry",
  monthHotImg: ".img-fluid, img",
  monthHotTitle: ".name, .title",

  latestGridWrap: ".col-sm-12.col-md-8.col-xl-9 .comics-grid",
  chapterUpdateAnchor: ".d-flex.flex-wrap.flex-row a",
};

export class Parsers {
  private requests = new Requests();

  /** ─────────────────────────
   *  Manga Details
   *  ───────────────────────── */
  parseMangaDetails($: cheerio.CheerioAPI, mangaId: string, shareURL: string): SourceManga {
    const title = ($(SEL.detailsTitle).first().text() || "").trim();
    const image = ($(SEL.detailsCover).first().attr("src") || "").trim();
    const desc  = ($(SEL.detailsDesc).first().text() || "").trim();

    let subs = "";
    const artists: string[] = [];
    const authors: string[] = [];
    const titles: string[]  = [];
    const data = { genre: [] as string[], state: "" };

    $(SEL.metaRows).each((_, el) => {
      const rowTxt = $(el).text().trim().toLowerCase();

      if (/fansub|scan|subs/i.test(rowTxt)) {
        subs = $(el).find("a").first().text().trim();
      }

      if (/stato|status/i.test(rowTxt)) {
        const stateLink = $(el).find("a").first();
        if (stateLink.length) data.state = stateLink.text().trim();
      } else if (/artist/i.test(rowTxt)) {
        $(el).find("a").each((_, a) => artists.push($(a).text().trim()));
      } else if (/autor|author/i.test(rowTxt)) {
        $(el).find("a").each((_, a) => authors.push($(a).text().trim()));
      } else if (/gener|genre/i.test(rowTxt)) {
        $(el).find("a").each((_, a) => data.genre.push($(a).text().trim()));
      } else if (/titol|also|alt\s*name/i.test(rowTxt)) {
        // “Also known as” / alternate titles line
        let t = $(el).text().trim();
        const cut = t.indexOf(":");
        if (cut >= 0) t = t.slice(cut + 1);
        t.split(",").forEach(s => titles.push(s.trim()));
      }
    });

    const arrayTags: Tag[] = data.genre.map(g => ({ title: g, id: g.replaceAll(" ", "-") }));
    const tagSections: TagSection[] = [{ id: "genres", title: "genres", tags: arrayTags }];

    const rating = getRating(arrayTags.map(t => t.title));

    return {
      mangaId,
      mangaInfo: {
        artist: artists.join(", "),
        thumbnailUrl: image,
        synopsis: desc,
        primaryTitle: title,
        contentRating: rating ?? ContentRating.EVERYONE,
        status: data.state,
        author: authors.join(", "),
        tagGroups: tagSections,
        secondaryTitles: titles,
        additionalInfo: { subs },
        shareUrl: shareURL,
      } as MangaInfo,
    } as SourceManga;
  }

  /** ─────────────────────────
   *  Chapters
   *  ───────────────────────── */
  parseChapters($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];
    const nodes = $(SEL.chapterItem).toArray().reverse(); // oldest → newest

    for (const node of nodes) {
      const href = $("a", node).attr("href") ?? "";
      // Accept both .../read/<id> and .../read/<id>?style=list
      const chapterId = (href.match(/read\/([^/?#]+)/i) ?? ["", ""])[1];

      const volTxt = ($(node).closest(".volume-element").find(SEL.chapterVolName).text() || "").trim();
      const chapTxt = ($(node).find(SEL.chapterNumLabel).text() || "").trim();

      const chapNum = (() => {
        const n = (chapTxt.match(/(\d+(?:\.\d+)?)/)?.[1]) ?? "";
        const f = Number(n);
        return Number.isNaN(f) ? undefined : f;
      })();

      const volNum = (() => {
        const n = (volTxt.match(/(\d+(?:\.\d+)?)/)?.[1]) ?? "";
        const f = Number(n);
        return Number.isNaN(f) ? undefined : f;
      })();

      const dateStr = ($(node).find(SEL.chapterDate).text() || "").trim();
      const when = dateStr ? new Date(dateStr) : new Date();

      if (!chapterId) continue;

      chapters.push({
        chapterId,
        sourceManga,
        volume: volNum,
        version: sourceManga.mangaInfo.additionalInfo?.subs ?? "",
        langCode: "EN",
        chapNum,
        publishDate: when,
      });
    }

    return chapters;
  }

  /** ─────────────────────────
   *  Chapter Details (pages)
   *  ───────────────────────── */
  parseChapterDetails($: cheerio.CheerioAPI, mangaId: string, id: string): ChapterDetails {
    const pages: string[] = [];
    // Prefer a scoped container
    const scoped = $(".col-12.text-center.position-relative, #reader, .reading-content, .reader, main");
    const scope = scoped.length ? scoped : $("body");

    scope.find("img").each((_, img) => {
      const src = ($(img).attr("data-src") || $(img).attr("data-original") || $(img).attr("src") || "").trim();
      if (src) pages.push(src);
    });

    // Dedup while preserving order
    const seen = new Set<string>();
    const unique = pages.filter(p => (seen.has(p) ? false : (seen.add(p), true)));

    return { id, mangaId, pages: unique };
  }

  /** ─────────────────────────
   *  Card grid (used by search & some discover sections)
   *  ───────────────────────── */
  parsePage($: cheerio.CheerioAPI): {
    id: string;
    title: string;
    image: string;
    tags: string[];
    authors: string;
    type: string;
  }[] {
    const items: {
      id: string;
      title: string;
      image: string;
      tags: string[];
      authors: string;
      type: string;
    }[] = [];

    $(SEL.gridItem).each((_, el) => {
      const $el = $(el);
      const link = $el.find(SEL.gridLink).first();
      const href = (link.attr("href") ?? "").trim();

      // Accept patterns like /123/slug or /manga/123/slug
      const id = (href.match(/[0-9]+\/[a-zA-Z0-9-]+/i) ?? [""])[0];

      const title =
        ($el.find(SEL.gridTitle).attr("title") ||
          $el.find(SEL.gridTitle).first().text() ||
          link.attr("title") ||
          link.text() ||
          "").trim();

      const image =
        ($el.find(SEL.gridImg).attr("data-src") ||
          $el.find(SEL.gridImg).attr("data-original") ||
          $el.find(SEL.gridImg).attr("src") ||
          "").trim();

      const mangaType = ($el.find(SEL.gridType).text() || "").trim();

      const authors: string[] = [];
      $el.find(SEL.gridAuthors).each((_, a) => authors.push($(a).text().trim()));

      const tags: string[] = [];
      $el.find(SEL.gridTags).each((_, a) => tags.push($(a).text().trim()));

      if (id) {
        items.push({
          id,
          title,
          image,
          tags,
          authors: authors.join(", "),
          type: mangaType,
        });
      }
    });

    return items;
  }

  /** ─────────────────────────
   *  Search Results
   *  ───────────────────────── */
  async parseSearchResults(
    $: cheerio.CheerioAPI,
    excluded: { generi: string[]; tipi: string[] } = { generi: [], tipi: [] }
  ): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    const cards = this.parsePage($);

    for (const item of cards) {
      if (!excludedTypes(item.type, excluded.tipi) && !excludedTags(item.tags, excluded.generi)) {
        results.push({
          imageUrl: item.image,
          title: item.title,
          subtitle: item.authors,
          mangaId: item.id,
          contentRating: getRating(item.tags),
        });
      }
    }
    return results;
  }

  /** ─────────────────────────
   *  Discover: Trending Chapters
   *  ───────────────────────── */
  parseTrendingChapters($: cheerio.CheerioAPI, metadata: Metadata): { items: DiscoverSectionItem[] } {
    const items: DiscoverSectionItem[] = [];
    $(SEL.trendingEntry).each((_, el) => {
      const $el = $(el);
      const href = ($el.find("a").attr("href") ?? "").trim();
      const id = (href.match(/[0-9]+\/[a-zA-Z0-9-]+/i) ?? [""])[0];

      const image = ($el.find(SEL.trendingImg).attr("src") ?? "").trim();
      const chapNum = ($el.find("a div").text() || "").trim();
      const title = ($el.find(SEL.trendingTitle).text() || "").trim();

      if (!id) return;
      items.push({
        metadata,
        type: "featuredCarouselItem",
        contentRating: ContentRating.EVERYONE,
        supertitle: chapNum,
        imageUrl: image,
        mangaId: id,
        title,
      });
    });
    return { items };
  }

  /** ─────────────────────────
   *  Discover: Month Trending
   *  ───────────────────────── */
  parseMonthTrending($: cheerio.CheerioAPI, metadata: Metadata): { items: DiscoverSectionItem[]; metadata: Metadata } {
    const items: DiscoverSectionItem[] = [];
    $(SEL.monthHotEntry).each((_, el) => {
      if (items.length >= 10) return false;
      const $el = $(el);
      const href = ($el.find("a").attr("href") ?? "").trim();
      const id = (href.match(/[0-9]+\/[a-zA-Z0-9-]+/i) ?? [""])[0];
      const image = ($el.find(SEL.monthHotImg).attr("src") ?? "").trim();
      const title = ($el.find(SEL.monthHotTitle).first().text() || "").trim();

      if (!id) return;
      items.push({
        metadata,
        type: "prominentCarouselItem",
        contentRating: ContentRating.EVERYONE,
        imageUrl: image,
        mangaId: id,
        title,
      });
    });
    return { items, metadata };
  }

  /** ─────────────────────────
   *  Discover: Most Read / Latest (shared helper)
   *  ───────────────────────── */
  async parseMostReadSection(metadata: Metadata): Promise<{ items: DiscoverSectionItem[]; metadata: Metadata }> {
    let page = metadata?.page ?? 1;
    const $ = await this.requests.parsePopularSectionRequests(page);
    page++;
    const latest = await this.parseSection($, page);
    return { items: latest, metadata: { page } };
  }

  async parseLastMangaAddedSection(metadata: Metadata): Promise<{ items: DiscoverSectionItem[]; metadata: Metadata }> {
    let page = metadata?.page ?? 1;
    const $ = await this.requests.parseLastMangaAddedSectionRequests(page);
    page++;
    const latest = await this.parseSection($, page);
    return { items: latest, metadata: { page } };
  }

  private async parseSection($: cheerio.CheerioAPI, page: number) {
    const out: DiscoverSectionItem[] = [];
    const cards = this.parsePage($);

    for (const item of cards) {
      if (blacklistedTags(item.tags) || blacklistedType(item.type)) continue;

      out.push({
        metadata: { page },
        subtitle: item.authors,
        type: "simpleCarouselItem",
        contentRating: getRating(item.tags),
        imageUrl: item.image,
        mangaId: item.id,
        title: item.title,
      });
    }
    return out;
  }

  /** ─────────────────────────
   *  Discover: Latest Chapter Updates
   *  ───────────────────────── */
  async parseLastAddedSection(
    $: cheerio.CheerioAPI,
    metadata: Metadata
  ): Promise<{ items: DiscoverSectionItem[]; metadata: Metadata | undefined }> {
    let page = metadata?.page ?? 1;
    if (page > 1) {
      $ = await this.requests.parseLastAddedSectionRequests(page);
    }
    page++;

    const latest: DiscoverSectionItem[] = [];
    const scope = $(SEL.latestGridWrap).length ? $(SEL.latestGridWrap) : $("body");
    const arr = scope.find(".entry, .card, .series-card, .book-item").toArray();

    for (const obj of arr) {
      const $el = $(obj);
      const href = ($el.find("a").attr("href") ?? "").trim();
      const id = (href.match(/[0-9]+\/[a-zA-Z0-9-]+/i) ?? [""])[0];

      const title = ($el.find("a").attr("title") || $el.find(".title,.name").text() || "").trim();
      const image = ($el.find("img").attr("src") || "").trim();
      const mangaType = ($el.find(".genre a, .type a, .badge.type").text() || "").trim();

      const sub = ($el.find(SEL.chapterUpdateAnchor).first().attr("title") || "").trim();
      const chapterHref = ($el.find(SEL.chapterUpdateAnchor).attr("href") || "").trim();
      const chapterId = (chapterHref.match(/\/read\/([a-f0-9]+)(?:\?.*)?$/i) ?? ["", ""])[1];

      // Try to extract chapter publish date from embedded JSON if present (optional)
      let publishDate = new Date();
      if (chapterId) {
        const rx = new RegExp(
          `"createdAt":\\s*"([^"]+)"[^]*?"id":\\s*"${chapterId}"`,
          "m"
        );
        const match = $.html().match(rx);
        if (match) publishDate = new Date(match[1]);
      }

      if (!blacklistedType(mangaType)) {
        latest.push({
          chapterId: chapterId || "",
          metadata,
          type: "chapterUpdatesCarouselItem",
          publishDate,
          contentRating: ContentRating.EVERYONE,
          imageUrl: image,
          mangaId: id,
          title,
          subtitle: sub,
        });
      }
    }

    return { items: latest, metadata: { page } };
  }

  /** ─────────────────────────
   *  Utility: parse dd/mm/yyyy (if your site uses localized dates)
   *  ───────────────────────── */
  getDate(dateString: string): Date {
    // fallback: try Date(...) directly; adjust if your site uses Italian month names, etc.
    const d = new Date(dateString);
    return Number.isNaN(d.valueOf()) ? new Date() : d;
  }
}
