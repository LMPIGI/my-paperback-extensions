import {
  Source,
  SourceInfo,
  SearchRequest,
  PagedResults,
  Manga,
  Chapter,
  ChapterDetails,
  createManga,
  createChapter,
  createChapterDetails,
  MangaStatus,
  ContentRating
} from "paperback-extensions-common"

import axios from "axios"
import * as cheerio from "cheerio"
import { loadCleanHtml, near, attr, text, abs, uniqStable } from "../utils/resilientDom"

// === Site config ===
const BASE = "https://www.mgeko.cc"  // your site
const MIN_PAGES = 6                  // if fewer than this, run fallback

// Tolerant selectors (attribute-anchored, no nth-child chains)
const SEL = {
  // Search results/cards (WP themes vary, so we look for /manga/ links)
  searchCard: 'article, .post, .card, .series-card, .book-item',
  searchLink: 'a[href*="/manga/"]',
  searchImg: 'img',
  searchTitle: '.title, [itemprop="name"], h3, h2',

  // Series page
  seriesTitle: 'h1, .series-title, [itemprop="name"]',
  seriesCover: '.cover img, [itemprop="image"], .thumb img, .series-cover img',
  seriesDesc: '.description, [itemprop="description"], .summary',

  // Chapters list (mgeko uses a series page with chapter links)
  chContainer: '.chapters, .chapter-list, .eplister, .listing, .list',
  chRow: '.chapter, li, .item, .eplister li',
  chLink: 'a[href*="/reader/"]',
  chTitle: '.name, .title, a',
  chDate: '.date, .time',

  // Reader page (mgeko reader lives under /reader/en/slug-chapter-... )
  readerRoot: '#reader, .reading-content, .reader, main',
  readerImg: 'img.page, img[data-src], img[data-original], img[src]'
}

export const MgekoSourceInfo: SourceInfo = {
  version: "1.0.0",
  name: "My Mgeko (0.9)",
  description: "Your private mgeko.cc source with resilient DOM parsing",
  author: "You",
  authorWebsite: "",
  icon: "icon.png",
  contentRating: ContentRating.EVERYONE,
  language: "EN"
}

export class MyMgeko extends Source {
  constructor() {
    super(MgekoSourceInfo)
  }

  private async get$(url: string): Promise<cheerio.CheerioAPI> {
    const res = await axios.get(url, { responseType: "text", headers: { "User-Agent": "Paperback/0.9" } })
    return loadCleanHtml(res.data)
  }

  // --- Search (uses WordPress ?s=) ---
  async getSearchResults(query: SearchRequest, metadata?: any): Promise<PagedResults> {
    const page = metadata?.page ?? 1
    const q = encodeURIComponent(query.title ?? "")
    const url = `${BASE}/?s=${q}&page=${page}`   // WP search pattern
    const $ = await this.get$(url)

    const results: Manga[] = []
    $(SEL.searchCard).each((_, el) => {
      const card = $(el)
      const a = near($, card, SEL.searchLink)
      const href = attr(a, "href")
      if (!href || !href.includes("/manga/")) return

      const titleNode = near($, card, SEL.searchTitle)
      const img = near($, card, SEL.searchImg)

      results.push(createManga({
        id: abs(BASE, href),
        titles: [text(titleNode) || $(a).text().trim()],
        image: abs(BASE, attr(img, "data-src") || attr(img, "data-original") || attr(img, "src") || "")
      }))
    })

    return { results, metadata: { page: page + 1, hasNextPage: results.length >= 10 } }
  }

  // --- Details ---
  async getMangaDetails(mangaId: string) {
    const $ = await this.get$(mangaId)
    const title = text($(SEL.seriesTitle).first()) || $("title").first().text().trim()
    const cover = abs(BASE, $(SEL.seriesCover).first().attr("src") ?? "")
    const desc = text($(SEL.seriesDesc).first())

    // mgeko series pages have chapters; status is unknown → default ongoing
    return createManga({
      id: mangaId,
      titles: [title],
      image: cover,
      desc,
      status: MangaStatus.ONGOING
    })
  }

  // --- Chapters ---
  async getChapters(mangaId: string): Promise<Chapter[]> {
    const $ = await this.get$(mangaId)
    const wrap = $(SEL.chContainer).first().length ? $(SEL.chContainer).first() : $(":contains('Chapter'), :contains('Episodes'), :contains('Chapters')").closest("div, section")
    const chapters: Chapter[] = []

    wrap.find(SEL.chRow).each((_, el) => {
      const row = $(el)
      const a = near($, row, SEL.chLink)
      const href = attr(a, "href")
      if (!href || !href.includes("/reader/")) return

      const titleNode = near($, row, SEL.chTitle) || a
      const name = text(titleNode) || $(a).text().trim()
      const chapNum = parseFloat((name.match(/(\d+(\.\d+)?)/)?.[1]) ?? "0")
      const when = text(near($, row, SEL.chDate))
      const time = when ? new Date(when) : new Date()

      chapters.push(createChapter({
        id: abs(BASE, href),
        mangaId,
        name,
        chapNum,
        time
      }))
    })

    // Ascending by chapter number
    chapters.sort((a, b) => (a.chapNum ?? 0) - (b.chapNum ?? 0))
    return chapters
  }

  // --- Pages (critical: robust & fallback) ---
  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    // mgeko reader pages look like: /reader/en/<slug-chapter-...-eng-li/>  :contentReference[oaicite:0]{index=0}
    const $ = await this.get$(chapterId)

    // Primary: scoped image selection inside reader root
    let pages = $(SEL.readerRoot).find(SEL.readerImg)
      .map((_, el) => abs(BASE, $(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || ""))
      .get()
      .filter(Boolean)

    // Fallback: broader search if count looks implausibly short (e.g., ~4)
    if (pages.length < MIN_PAGES) {
      const root = $(SEL.readerRoot).first().length ? $(SEL.readerRoot).first() : $("img").closest("main, body")
      const broad = root.find("img")
        .map((_, el) => abs(BASE, $(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || ""))
        .get()
        .filter(Boolean)
      pages = uniqStable([...pages, ...broad])
    }

    return createChapterDetails({ id: chapterId, mangaId, pages })
  }
}

export default MyMgeko
