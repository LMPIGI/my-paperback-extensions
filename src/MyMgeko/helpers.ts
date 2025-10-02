import { ContentRating } from "@paperback/types";
import * as cheerio from "cheerio";
import { Requests } from "./requests";

export type Metadata = { page?: number };

type QueryValue = string | number | boolean | undefined | null;
type QueryParam = QueryValue | QueryValue[] | Record<string, QueryValue>;
type OptionItem = { value: string; id: string };
type CacheItem = { expires: number; data: ArrayBuffer };

// ── site base ───────────────────────────────────────────────────────────
export const baseUrl = "https://www.mgeko.cc";

// ── in-memory caches (page HTML + in-flight requests) ───────────────────
const cacheMap = new Map<string, CacheItem>();
const requestMap = new Map<string, Promise<ArrayBuffer>>();
const requests = new Requests();

/** Fetch + cache a page for a short time (seconds) */
export async function getPageCache(name: string, url: string): Promise<ArrayBuffer> {
  const cacheSeconds = 10;
  const now = Math.floor(Date.now() / 1000);

  const cached = cacheMap.get(name);
  if (cached && cached.expires > now) {
    console.log(`[CACHE] Using cached page "${name}"`);
    return cached.data;
  }

  // de-dup concurrent identical requests
  if (requestMap.has(name)) {
    console.log(`[CACHE] Awaiting in-flight request "${name}"`);
    return requestMap.get(name)!;
  }

  console.log(`[CACHE] Fetching "${name}"`);
  const fetchPromise = requests.fetchPage(url)
    .then((data) => {
      cacheMap.set(name, { expires: now + cacheSeconds, data });
      requestMap.delete(name);
      console.log(`[CACHE] Cached "${name}"`);
      return data;
    })
    .catch((err) => {
      requestMap.delete(name);
      console.log(`[CACHE] Error "${name}" — ${String(err)}`);
      throw err;
    });

  requestMap.set(name, fetchPromise);
  return fetchPromise;
}

// ── filter metadata (populated from site, cached in Application state) ──
let YearFilter:   OptionItem[] = [];
let GenreFilter:  OptionItem[] = [];
let TypeFilter:   OptionItem[] = [];
let OrderFilter:  OptionItem[] = [];
let StatusFilter: OptionItem[] = [];

/** Load / refresh filters (scrape once per week) */
export async function populateFilter() {
  const last = Number(Application.getState("last-filter-fetch-date") ?? 0);
  const now  = Math.floor(Date.now() / 1000);
  const oneWeek = 7 * 24 * 60 * 60;

  if (last + oneWeek > now) {
    console.log("[FILTERS] Using cached filters");
    setGenreFilter(JSON.parse((Application.getState(".genres") as string) ?? "[]"));
    setTypeFilter(JSON.parse((Application.getState(".type") as string) ?? "[]"));
    setStatusFilter(JSON.parse((Application.getState(".status") as string) ?? "[]"));
    setOrderFilter(JSON.parse((Application.getState(".sort") as string) ?? "[]"));
    setYearFilter(JSON.parse((Application.getState(".year") as string) ?? "[]"));
    return;
  }

  // If your site has a dedicated filters page/section, Requests.parseFilters() should fetch & return a $ for it.
  console.log("[FILTERS] Scraping filters");
  const $ = await requests.parseFilters(); // implement minimal in requests.ts
  setGenreFilter(extractOptions($, ".genres"));
  setTypeFilter(extractOptions($, ".type"));
  setStatusFilter(extractOptions($, ".status"));
  setOrderFilter(extractOptions($, ".sort"));
  setYearFilter(extractOptions($, ".year"));

  Application.setState(String(now), "last-filter-fetch-date");
}

/** Generic <select> → [{id,value}] scrapers (match Sinon style) */
function extractOptions($: cheerio.CheerioAPI, rootSel: string): OptionItem[] {
  const result: OptionItem[] = [];
  $(`${rootSel} select.filter-select option`).each((_, el) => {
    const id = $(el).attr("data-name");
    const label = $(el).text().trim();
    if (id) result.push({ value: label, id });
  });
  // persist raw arrays so populateFilter() can restore without scraping
  Application.setState(JSON.stringify(result), rootSel);
  return result;
}

// ── public getters used by forms.ts / main.ts ───────────────────────────
export function getGenreFilter()  { return GenreFilter;  }
export function getMangaTypeFilter() { return TypeFilter;   }
export function getStatusFilter() { return StatusFilter; }
export function getOrderFilter()  { return OrderFilter.map(o => ({ id: o.id, label: o.value })); }
export function getYearFilter()   { return YearFilter;   }

// ── internal setters ────────────────────────────────────────────────────
function setGenreFilter(v: OptionItem[])  { GenreFilter  = v ?? []; }
function setTypeFilter(v: OptionItem[])   { TypeFilter   = v ?? []; }
function setStatusFilter(v: OptionItem[]) { StatusFilter = v ?? []; }
function setOrderFilter(v: OptionItem[])  { OrderFilter  = v ?? []; }
function setYearFilter(v: OptionItem[])   { YearFilter   = v ?? []; }

// ── blacklist checks driven by user settings (Forms) ────────────────────
/** hide if any tag is in user’s hidden list */
export const blacklistedTags = (tags: string[]): boolean => {
  const hidden = (Application.getState("hide_tags") as string[] | undefined) ?? [];
  return tags.some(t => hidden.includes(t));
};
/** hide if type is in user’s hidden list */
export const blacklistedType = (type: string): boolean => {
  const hidden = (Application.getState("hide_type") as string[] | undefined) ?? [];
  return hidden.includes((type ?? "").toLowerCase());
};

// ── ratings based on tags (optional map; extend as you like) ────────────
const tagRatingMap: Record<string, ContentRating> = {
  ADULT:  ContentRating.ADULT,
  MATURE: ContentRating.MATURE
};
export function getRating(tags: string[]): ContentRating {
  for (const t of tags) {
    const m = tagRatingMap[t.toUpperCase()];
    if (m) return m;
  }
  return ContentRating.EVERYONE;
}

// ── URL builder (same API as Sinon’s) ───────────────────────────────────
export class URLBuilder {
  private parameters: Record<string, QueryParam> = {};
  private path: string[] = [];
  private base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/^\/|\/$/g, "");
  }

  addPathComponent(component: string): this {
    this.path.push(component.replace(/^\/|\/$/g, ""));
    return this;
  }

  addQueryParameter(key: string, value: QueryParam): this {
    this.parameters[key] = value;
    return this;
  }

  buildUrl(opts: { addTrailingSlash?: boolean; includeUndefinedParameters?: boolean } = {}): string {
    const { addTrailingSlash = false, includeUndefinedParameters = false } = opts;
    let url = `${this.base}/${this.path.join("/")}`;
    if (addTrailingSlash) url += "/";

    const qp = Object.entries(this.parameters).flatMap(([k, v]) => {
      if (v == null && !includeUndefinedParameters) return [];
      if (Array.isArray(v)) {
        return v
          .filter(x => x != null || includeUndefinedParameters)
          .map(x => `${encodeURIComponent(k)}=${encodeURIComponent(String(x ?? ""))}`);
      }
      if (typeof v === "object" && v !== null) {
        return Object.entries(v).flatMap(([sub, val]) =>
          val != null || includeUndefinedParameters
            ? `${encodeURIComponent(k)}[${encodeURIComponent(sub)}]=${encodeURIComponent(String(val ?? ""))}`
            : []
        );
      }
      return `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
    });

    if (qp.length) url += `?${qp.join("&")}`;
    return url;
  }
}
