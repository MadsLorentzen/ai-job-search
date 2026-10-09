import type { NormalizedLocation, NormalizedSalary } from "./job-schema.js"

function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const result = value.replace(/\s+/g, " ").trim()
  return result || null
}

function numberFrom(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseChineseSalary(value: string | null | undefined): NormalizedSalary {
  const raw = clean(value)
  if (!raw || /面议|面谈|不限|保密/i.test(raw)) {
    return { raw, min: null, max: null, unit: "unknown", months: null }
  }

  const monthsMatch = raw.match(/[·.]\s*(\d{1,2})\s*薪/i)
  const months = monthsMatch ? Number(monthsMatch[1]) : null
  const unit: NormalizedSalary["unit"] = /元\s*\/\s*(天|日)/.test(raw)
    ? "day"
    : /元\s*\/\s*(时|小时)/.test(raw)
      ? "hour"
      : /年薪|万\/年|元\/年|年/.test(raw)
        ? "year"
        : "month"

  const match = raw.match(/(\d+(?:\.\d+)?)\s*(万|千|K|k)?\s*(?:-|至|~|～)\s*(\d+(?:\.\d+)?)\s*(万|千|K|k)?/)
  if (!match) {
    const single = raw.match(/(\d+(?:\.\d+)?)\s*(万|千|K|k)?/)
    const amount = single ? scaleAmount(single[1], single[2]) : null
    return { raw, min: amount, max: amount, unit, months }
  }

  const left = scaleAmount(match[1], match[2] || match[4])
  const right = scaleAmount(match[3], match[4] || match[2])
  return { raw, min: left, max: right, unit, months }
}

function scaleAmount(value: string, suffix: string | undefined): number | null {
  const amount = numberFrom(value)
  if (amount === null) return null
  if (suffix === "万") return amount * 10000
  if (suffix === "千" || suffix === "K" || suffix === "k") return amount * 1000
  return amount
}

export function parseChineseDate(value: string | null | undefined, now = new Date()): string | null {
  const raw = clean(value)
  if (!raw) return null
  const iso = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const relative = raw.match(/(\d+)\s*天前/)
  if (/今天|刚刚/.test(raw)) return formatDate(now)
  if (/昨天/.test(raw)) return formatDate(addDays(now, -1))
  if (relative) return formatDate(addDays(now, -Number(relative[1])))
  return null
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value.getTime())
  result.setDate(result.getDate() + days)
  return result
}

function formatDate(value: Date): string {
  return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0")
}

function isoDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(year, month - 1, day)
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0")
}

export function normalizeExperience(value: string | null | undefined): string | null {
  const raw = clean(value)
  if (!raw) return null
  if (/经验不限|不限经验|无经验/.test(raw)) return "不限"
  if (/应届|校招|毕业生/.test(raw)) return "应届生"
  const range = raw.match(/(\d+)\s*[-至~～]\s*(\d+)\s*年/)
  if (range) return range[1] + "-" + range[2] + "年"
  const single = raw.match(/(\d+)\s*年/)
  return single ? single[1] + "年以上" : raw
}

export function normalizeEducation(value: string | null | undefined): string | null {
  const raw = clean(value)
  if (!raw) return null
  if (/学历不限|不限学历/.test(raw)) return "不限"
  if (/博士/.test(raw)) return "博士"
  if (/硕士|研究生/.test(raw)) return "硕士"
  if (/本科/.test(raw)) return "本科"
  if (/大专|专科/.test(raw)) return "大专"
  if (/高中|中专|中技/.test(raw)) return "高中/中专"
  return raw
}

export function normalizeLocation(value: string | null | undefined): NormalizedLocation {
  const raw = clean(value)
  if (!raw) return { raw: null, province: null, city: null, district: null }
  const parts = raw.split(/[·|,，/\s]+/).filter(Boolean)
  return {
    raw,
    province: parts[0] ?? null,
    city: parts.length > 1 ? parts[1] : parts[0] ?? null,
    district: parts.length > 2 ? parts[2] : null,
  }
}
