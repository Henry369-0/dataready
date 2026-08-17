import type { CellValue, ColumnKind, ColumnProfile, DataRow } from '../types'
import { isMissing, numericValue, parseLooseDate, quantile } from './utils'

function inferKind(name: string, values: CellValue[], uniqueRate: number): ColumnKind {
  const lower = name.toLowerCase()
  const nonMissing = values.filter((v) => !isMissing(v))
  if (!nonMissing.length) return 'unknown'

  if (/(^|_)(id|编号|编码|code|uuid)($|_)/i.test(name) || /merchant_id|user_id|order_id/i.test(name)) return 'id'
  if (/率|ratio|rate|percent|percentage|completion/i.test(lower)) return 'percentage'
  if (/gmv|amount|cost|price|revenue|sales|金额|成本|价格|收入/i.test(lower)) return 'currency'
  if (/date|日期|day$/i.test(lower)) return 'date'
  if (/duration|delivery_time|avg_.*time|minutes?|seconds?|时长|耗时/i.test(lower)) return 'numeric'
  if (/time|时间|datetime|timestamp/i.test(lower)) return 'datetime'

  const numericCount = nonMissing.filter((v) => numericValue(v) !== null).length
  const dateCount = nonMissing.filter((v) => parseLooseDate(v) !== null).length
  const boolCount = nonMissing.filter((v) => ['true', 'false', 'yes', 'no', '是', '否', '0', '1'].includes(String(v).toLowerCase())).length

  if (boolCount / nonMissing.length > 0.95) return 'boolean'
  if (dateCount / nonMissing.length > 0.92 && numericCount / nonMissing.length < 0.5) return 'date'
  if (numericCount / nonMissing.length > 0.9) return 'numeric'

  const avgLength = nonMissing.reduce<number>((sum, value) => sum + String(value).length, 0) / nonMissing.length
  if (uniqueRate < 0.35 && nonMissing.length > 5) return 'category'
  if (avgLength > 30 || uniqueRate > 0.7) return 'text'
  return 'category'
}

export function profileDataset(rows: DataRow[]): ColumnProfile[] {
  if (!rows.length) return []
  const columns = Object.keys(rows[0])
  return columns.map((name) => {
    const values = rows.map((row) => row[name] ?? null)
    const missingCount = values.filter(isMissing).length
    const valid = values.filter((v) => !isMissing(v))
    const unique = Array.from(new Set(valid.map((v) => String(v))))
    const uniqueRate = valid.length ? unique.length / valid.length : 0
    const kind = inferKind(name, values, uniqueRate)
    const examples = valid.slice(0, 4)
    const profile: ColumnProfile = {
      name,
      kind,
      missingCount,
      missingRate: rows.length ? missingCount / rows.length : 0,
      uniqueCount: unique.length,
      uniqueRate,
      examples,
    }

    if (['numeric', 'currency', 'percentage'].includes(kind)) {
      const nums = valid.map(numericValue).filter((v): v is number => v !== null)
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b)
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length
        profile.numeric = {
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean,
          median: quantile(sorted, 0.5),
          q1: quantile(sorted, 0.25),
          q3: quantile(sorted, 0.75),
        }
      }
    }

    return profile
  })
}
