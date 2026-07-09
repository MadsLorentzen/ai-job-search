export const SEARCH_URL =
  "https://www.computrabajo.com.co/ofertas-de-trabajo/"
export const DETAIL_BASE =
  "https://co.computrabajo.com"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  salary: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  contractType: string | null
  workMode: string | null
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10)
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16)
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í").replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú").replace(/&uacute;/g, "ú")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

function extractTitleFromLinkChunk(chunk: string): string | null {
  const m = chunk.match(/<a[^>]*class\s*=\s*"[^"]*js-o-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  if (!m) return null
  return clean(m[1]) || null
}

/** Parse job cards from the Computrabajo search results HTML. */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const baseUrl = "https://co.computrabajo.com"
  const chunks = html.split(/<article[^>]*>/i).slice(1)

  for (const chunk of chunks) {
    const linkMatch = chunk.match(/<a[^>]*class\s*=\s*"[^"]*js-o-link[^"]*"[^>]*href\s*=\s*"([^"]+)"/i)
    if (!linkMatch) continue
    const rawUrl = linkMatch[1].split("#")[0]
    const url = rawUrl.startsWith("http") ? rawUrl : baseUrl + rawUrl

    const idMatch = url.match(/-([A-F0-9]{32})$/i)
    if (!idMatch) continue
    const id = idMatch[1]

    const title = extractTitleFromLinkChunk(chunk)
    if (!title) continue

    let company: string | null = null
    const dFlexSection = chunk.match(/<p\s+class="dFlex[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    if (dFlexSection) {
      const ca = dFlexSection[1].match(/class="[^"]*fc_base\s+t_ellipsis[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      if (ca) company = clean(ca[1])
      if (!company) {
        const txt = clean(dFlexSection[1])
        if (txt && !/^\d/.test(txt)) company = txt
      }
    }

    let location: string | null = null
    const locM = chunk.match(/<p\s+class="fs16\s+fc_base\s+mt5"[^>]*>\s*<span[^>]*>\s*([\s\S]*?)\s*<\/span>/i)
    if (locM) location = clean(locM[1])

    let salary: string | null = null
    const salM = chunk.match(/<span\s+class="icon\s+i_salary"[^>]*><\/span>\s*([\s\S]*?)\s*<\/span>/i)
    if (salM) salary = clean(salM[1])

    let date: string | null = null
    const dateM = chunk.match(/<p[^>]*class="[^"]*fc_aux[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/i)
    if (dateM) date = clean(dateM[1])

    results.push({ id, title, company, location, salary, date, url })
  }

  return results
}

/** Normalize a job identifier: accept a full URL only (hex IDs need the slug). */
export function normalizeId(input: string): { url: string } | null {
  if (input.startsWith("http")) {
    return { url: input.split("?")[0] }
  }
  if (input.startsWith("/")) {
    return { url: `${DETAIL_BASE}${input.split("?")[0]}` }
  }
  return null
}

/** Parse the single-job detail page on Computrabajo. */
export function parseJobDetail(html: string, id: string, fetchedUrl?: string): JobDetail {
  const titleMatch = html.match(/<h1[^>]*class="[^"]*box_detail[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = titleMatch ? clean(titleMatch[1]) : "(untitled)"

  let company: string | null = null
  let location: string | null = null
  const p16 = html.match(/<p\s+class="fs16"[^>]*>([\s\S]*?)<\/p>/i)
  if (p16) {
    const parts = clean(p16[1]).split(/\s*-\s*/)
    if (parts.length >= 2) {
      company = parts[0].trim() || null
      location = parts.slice(1).join(" - ").trim() || null
    } else {
      location = parts[0] || null
    }
  }

  let salary: string | null = null
  let contractType: string | null = null
  let workMode: string | null = null
  const offerSection = html.match(/<div[^>]*div-link="oferta"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*div-link=|$)/i)
  if (offerSection) {
    const tags = [...offerSection[1].matchAll(/<span\s+class="tag\s+base\s+mb10"[^>]*>([\s\S]*?)<\/span>/gi)]
    for (const tag of tags) {
      const t = clean(tag[1])
      if (t.startsWith("$")) salary = t
      else if (/indefinido|fijo|obra|aprendizaje|servicios|término|temporal/i.test(t)) contractType = t
      else if (/presencial|remoto|híbrido|teletrabajo/i.test(t)) workMode = t
    }
  }
  if (!salary) {
    const salM = html.match(/\$\s*[\d.]+[\d.,]*(?:\s*\([^)]*\))?/)
    if (salM) salary = salM[0]
  }

  let description: string | null = null
  if (offerSection) {
    const descP = offerSection[1].match(/<p\s+class="mbB"[^>]*>([\s\S]*?)<\/p>/i)
    if (descP) {
      const withBreaks = descP[1]
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      description = clean(withBreaks).replace(/\n{3,}/g, "\n\n").trim() || null
    }
  }

  if (!contractType) {
    const ctM = html.match(/Contrato\s*(?:a\s+)?(término|de|por)?\s*([^<,.]+)/i)
    if (ctM) contractType = clean(`Contrato ${ctM[0]}`) || null
  }

  if (!workMode) {
    const wmM = html.match(/(Presencial\s+y\s+remoto|Presencial|Remoto|Híbrido|Teletrabajo)/i)
    if (wmM) workMode = wmM[1]
  }

  const dateMatch = html.match(/<p\s+class="fc_aux\s+fs13"[^>]*>\s*([\s\S]*?)\s*<\/p>/i)
  const date = dateMatch ? clean(dateMatch[1]) || null : null

  const url = fetchedUrl || `https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-${id}`

  // Extract hex ID from URL
  const urlId = url.match(/-([A-F0-9]{32})$/i)
  const finalId = urlId ? urlId[1] : id

  return {
    id: finalId,
    title,
    company,
    location,
    salary,
    date,
    url,
    description,
    contractType,
    workMode,
  }
}
