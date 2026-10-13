import type { CellValue, DataRow } from '../types'

export const MISSING_TOKENS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none', '暂无', '无', 'nan'])

export function displayValue(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === '') return '空值'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function isMissing(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return MISSING_TOKENS.has(value.trim().toLowerCase())
  return false
}

export function normalizeString(value: CellValue | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·.，,。/\\()（）]+/g, '')
}

export function numericValue(value: CellValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/[￥¥$,，%]/g, '')
  if (!cleaned || MISSING_TOKENS.has(cleaned.toLowerCase())) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

export function hashRow(row: DataRow, columns: string[]): string {
  return JSON.stringify(columns.map((c) => row[c] ?? null))
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function formatPercent(n: number): string {
  return `${(n * 100).toFixed(n < 0.01 ? 1 : 0)}%`
}

export function parseLooseDate(value: CellValue | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30)
    const d = new Date(excelEpoch + value * 86400000)
    return Number.isNaN(d.getTime()) ? null : calendarDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
  }
  const raw = String(value).trim()
  if (!raw) return null
  if (/^[+-]?[0-9]+(?:\.[0-9]+)?$/.test(raw)) return parseLooseDate(Number(raw))

  const ymd = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (ymd) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = ymd
    return calendarDate(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss))
  }

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    return calendarDate(Number(y), Number(m), Number(d))
  }

  const isoDate = raw.match(/^([0-9]{4})[/-]([0-9]{1,2})[/-]([0-9]{1,2})[ T]/i)
  if (isoDate && !calendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]))) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function calendarDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date | null {
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, second, 0)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date : null
}

export function isDatetimeColumn(column: string): boolean {
  return /time|时间|timestamp/i.test(column)
}

export function formatDate(date: Date, withTime = false): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (!withTime) return base
  return `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const CITY_ALIASES: Record<string, string> = {
  上海市: '上海',
  shanghai: '上海',
  上海: '上海',
  北京市: '北京',
  beijing: '北京',
  北京: '北京',
  广州市: '广州',
  guangzhou: '广州',
  广州: '广州',
  深圳市: '深圳',
  shenzhen: '深圳',
  深圳: '深圳',
}
