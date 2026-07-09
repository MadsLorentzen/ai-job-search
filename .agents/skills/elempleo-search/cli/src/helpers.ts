export const SEARCH_URL =
  "https://www.elempleo.com/co/ofertas-empleo"
export const DETAIL_BASE =
  "https://www.elempleo.com/co/ofertas-trabajo"

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
  experienceLevel: string | null
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
    .replace(/&Uacute;/g, "Ú")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Parse job cards from the Elempleo search results HTML. */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const baseUrl = "https://www.elempleo.com"

  // Each card is wrapped in <div class="col-md-12 result-item mb-3 bg-white">
  const cardRegex = /<div[^>]*class="col-md-12 result-item mb-3 bg-white"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="col-md-12 result-item|<footer|<\/section|<div[^>]*class="(?:row|container))/gi
  let m: RegExpExecArray | null

  while ((m = cardRegex.exec(html)) !== null) {
    const cardHtml = m[1]

    // Extract ID and URL from data-offer-id or data-url
    const idAttr = cardHtml.match(/data-offer-id\s*=\s*"(\d+)"/i)
    if (!idAttr) continue
    const id = idAttr[1]

    const urlMatch = cardHtml.match(/data-url\s*=\s*"([^"]+)"/i) ||
      cardHtml.match(/<a[^>]*href\s*=\s*"([^"]*)"[^>]*class\s*=\s*"[^"]*js-offer-title[^"]*"/i)
    const url = urlMatch
      ? (urlMatch[1].startsWith("http") ? urlMatch[1].split("?")[0] : baseUrl + urlMatch[1].split("?")[0])
      : `${baseUrl}/co/ofertas-trabajo/-${id}`

    const titleMatch = cardHtml.match(/<a[^>]*class\s*=\s*"[^"]*js-offer-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    const title = titleMatch ? clean(titleMatch[1]) : null
    if (!title) continue

    const companyMatch = cardHtml.match(/class\s*=\s*"[^"]*js-offer-company[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    const company = companyMatch ? clean(companyMatch[1]) || null : null

    const locMatch = cardHtml.match(/class\s*=\s*"[^"]*js-offer-city[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    const location = locMatch ? clean(locMatch[1]) || null : null

    // Salary: visible div or from data-ga4-offerdata
    let salary: string | null = null
    const salVisible = cardHtml.match(/class="text-blue-petrol-dark"[^>]*>\s*(\$[\s\S]*?)\s*</i)
    if (salVisible) salary = clean(salVisible[1])
    if (!salary) {
      const salPure = cardHtml.match(/\$\s*[\d.]+[\d,.]*(?:\s*(?:a|millones|millón|COP)\s*[\d.,]*)*/)
      if (salPure) salary = salPure[0].trim()
    }

    const dateMatch = cardHtml.match(/class\s*=\s*"[^"]*js-offer-date[^"]*"[^>]*>[\s\S]*?>\s*(Hoy|Ayer|Hace\s+\d+\s+(?:hora|horas|día|días|minutos))\s*</i)
    const date = dateMatch ? clean(dateMatch[1]) || null : null

    results.push({ id, title, company, location, salary, date, url })
  }

  return results
}

/** Normalize a job identifier: accept a full URL only (numeric IDs need the slug). */
export function normalizeId(input: string): { url: string } | null {
  if (input.startsWith("http")) {
    return { url: input.split("?")[0] }
  }
  if (input.startsWith("/")) {
    return { url: `https://www.elempleo.com${input.split("?")[0]}` }
  }
  return null
}

/** Parse a JS object value from Elempleo's embedded _objectDataJob. */
function extractJsValue(src: string, key: string): string | null {
  const m = src.match(new RegExp(`(?:${key}|"${key}")\\s*:\\s*'([^']*)'`, 'i'))
  return m ? m[1].trim() : null
}

/** Parse the single-job detail page on Elempleo. */
export function parseJobDetail(html: string, id: string, fetchedUrl?: string): JobDetail {
  const objData = html.match(/_objectDataJob\s*=\s*(\{[\s\S]*?\});/i)

  let title: string
  if (objData) {
    title = clean(extractJsValue(objData[1], 'title') || '') || "(untitled)"
  } else {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    title = h1 ? clean(h1[1]) : "(untitled)"
  }

  let company: string | null = null
  if (objData) {
    company = clean(extractJsValue(objData[1], 'company') || '') || null
  }
  if (!company) {
    const cm = html.match(/class="[^"]*(?:company|empresa)[^"]*"[^>]*title\s*=\s*"([^"]+)"/i) ||
      html.match(/<a[^>]*class\s*=\s*"[^"]*link-empresa[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    if (cm) company = clean(cm[1]) || null
  }

  let location: string | null = null
  if (objData) {
    location = clean(extractJsValue(objData[1], 'location') || '') || null
  }
  if (!location) {
    const lm = html.match(/<span[^>]*class\s*=\s*"[^"]*(?:ubica|location)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    if (lm) {
      const l = clean(lm[1])
      if (l.length < 50) location = l
    }
  }

  let salary: string | null = null
  if (objData) {
    salary = extractJsValue(objData[1], 'salary') || null
  }
  if (!salary) {
    const sm = html.match(/\$\s*[\d.]+[\d,.]*(?:\s*(?:a|millones|millón|COP)\s*[\d.,]*)*/i)
    if (sm) salary = sm[0].trim()
  }

  let contractType: string | null = null
  if (objData) {
    const c = extractJsValue(objData[1], 'contract')
    if (c) contractType = clean(c)
  }
  if (!contractType) {
    const cm = html.match(/(?:Contrato|Tipo de contrato)[^:]*:\s*([^<]+)/i) ||
      html.match(/(Indefinido|Fijo|Obra\s*o\s*labor|Aprendizaje|Prestación\s*de\s*servicios|Definido|Temporal)/i)
    if (cm) contractType = clean(cm[1]).replace(/^Contrato\s*/i, "").trim() || null
  }

  let workMode: string | null = null
  const wm = html.match(/(Presencial\s+y\s+remoto|Presencial|Remoto|Híbrido|Teletrabajo|Desde casa)/i)
  if (wm) {
    workMode = wm[1].charAt(0).toUpperCase() + wm[1].slice(1).toLowerCase()
    workMode = workMode.replace(/\s+y\s+/, " y ")
  }

  let experienceLevel: string | null = null
  if (objData) {
    const e = extractJsValue(objData[1], 'experience')
    if (e) experienceLevel = clean(e)
  }
  if (!experienceLevel) {
    const em = html.match(/(?:Experiencia|Nivel\s*laboral)[^:]*:\s*([^<]+)/i) ||
      html.match(/(Sin experiencia|Profesional|Técnico|Tecnólogo|Estudiante|Practicante)/i)
    if (em) experienceLevel = clean(em[1])?.replace(/^Experiencia\s*/i, "").trim() || null
  }

  let description: string | null = null
  const jsonld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (jsonld) {
    const descM = jsonld[1].match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/i)
    if (descM) {
      description = clean(descM[1].replace(/\\n/g, "\n").replace(/\\r/g, "")).replace(/\n{3,}/g, "\n\n").trim() || null
    }
  }

  let date: string | null = null
  const dm = html.match(/(?:Publicado|Fecha)\s*(?::\s*)?([^<]+)/i) ||
    html.match(/>\s*(Hoy|Ayer|Hace\s+\d+\s+(?:hora|horas|día|días))\s*</i)
  if (dm) date = clean(dm[1])?.replace(/^Publicado\s*/i, "").trim() || null

  const url = fetchedUrl || `${DETAIL_BASE}/${id}`

  // Extract numeric ID from URL
  const urlNum = url.match(/(\d{6,})(?:\?|$)/)
  const finalId = urlNum ? urlNum[1] : id

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
    experienceLevel,
  }
}