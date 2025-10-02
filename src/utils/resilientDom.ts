import * as cheerio from 'cheerio'

export function loadCleanHtml(html: string): cheerio.CheerioAPI {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '')
  return cheerio.load(noComments)
}

export function near($: cheerio.CheerioAPI, ctx: cheerio.Cheerio<any>, sel: string) {
  if (!ctx || ctx.length === 0) return $()
  if (ctx.is(sel)) return ctx
  const p = ctx.parents(sel).first()
  if (p && p.length) return p
  const d = ctx.find(sel).first()
  if (d && d.length) return d
  return $()
}

export function attr(node: cheerio.Cheerio<any>, name: string): string {
  const v = node?.attr?.(name)
  return v ? v.trim() : ''
}

export function text(node: cheerio.Cheerio<any>): string {
  return (node?.text?.() ?? '').trim()
}

export function abs(baseUrl: string, pathOrUrl?: string | null): string {
  const s = (pathOrUrl ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return baseUrl.replace(/\/+$/, '') + '/' + s.replace(/^\/+/, '')
}

export function uniqStable<T>(arr: T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x) }
  return out
}
