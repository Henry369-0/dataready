import type { ChangeLogEntry, CleaningAction, DataRow, PreviewChange } from '../types'
import { formatDate, hashRow, isMissing, isDatetimeColumn, numericValue, parseLooseDate } from './utils'

export function previewActions(rows: DataRow[], actions: CleaningAction[], limit = 40): PreviewChange[] {
  const changes: PreviewChange[] = []
  const add = (row: number, column: string, before: unknown, after: unknown) => {
    if (changes.length >= limit) return
    const b = before === null || before === undefined ? '空值' : String(before)
    const a = after === null || after === undefined ? '空值' : String(after)
    if (b !== a) changes.push({ row: row + 2, column, before: b, after: a })
  }

  for (const action of actions) {
    if (changes.length >= limit) break
    if (action.type === 'normalize_category' && action.column && action.mapping) {
      rows.forEach((row, i) => {
        const raw = row[action.column!]
        const mapped = raw !== null && raw !== undefined ? action.mapping![String(raw)] : undefined
        if (mapped !== undefined) add(i, action.column!, raw, mapped)
      })
    } else if (action.type === 'replace_missing_tokens' && action.column && action.tokens) {
      rows.forEach((row, i) => {
        const raw = row[action.column!]
        if (typeof raw === 'string' && action.tokens!.includes(raw.trim())) add(i, action.column!, raw, null)
      })
    } else if (action.type === 'coerce_numeric' && action.column) {
      rows.forEach((row, i) => {
        const raw = row[action.column!]
        if (typeof raw === 'string' && !isMissing(raw)) {
          const n = numericValue(raw)
          if (n !== null) add(i, action.column!, raw, n)
        }
      })
    } else if (action.type === 'normalize_date' && action.column) {
      rows.forEach((row, i) => {
        const raw = row[action.column!]
        if (isMissing(raw)) return
        const date = parseLooseDate(raw)
        if (date) add(i, action.column!, raw, formatDate(date, isDatetimeColumn(action.column!)))
      })
    } else if (action.type === 'remove_column' && action.column) {
      rows.slice(0, 8).forEach((row, i) => add(i, action.column!, row[action.column!], '（移除字段）'))
    }
  }
  return changes
}

export function applyActions(rows: DataRow[], actions: CleaningAction[], startStep = 1): { rows: DataRow[]; logs: ChangeLogEntry[] } {
  let nextRows = rows.map((row) => ({ ...row }))
  const logs: ChangeLogEntry[] = []
  let step = startStep

  const log = (action: CleaningAction, affectedRows: number, before?: string, after?: string) => {
    logs.push({
      step: step++,
      actionId: action.id,
      action: action.label,
      column: action.column,
      affectedRows,
      before,
      after,
      at: new Date().toISOString(),
    })
  }

  for (const action of actions) {
    if (action.type === 'remove_exact_duplicates') {
      const columns = nextRows.length ? Object.keys(nextRows[0]) : []
      const seen = new Set<string>()
      let removed = 0
      nextRows = nextRows.filter((row) => {
        const key = hashRow(row, columns)
        if (seen.has(key)) {
          removed += 1
          return false
        }
        seen.add(key)
        return true
      })
      log(action, removed)
      continue
    }

    if (action.type === 'normalize_category' && action.column && action.mapping) {
      let affected = 0
      nextRows = nextRows.map((row) => {
        const raw = row[action.column!]
        if (raw !== null && raw !== undefined && action.mapping![String(raw)] !== undefined) {
          affected += 1
          return { ...row, [action.column!]: action.mapping![String(raw)] }
        }
        return row
      })
      const sample = Object.entries(action.mapping)[0]
      log(action, affected, sample?.[0], sample?.[1])
      continue
    }

    if (action.type === 'replace_missing_tokens' && action.column && action.tokens) {
      let affected = 0
      nextRows = nextRows.map((row) => {
        const raw = row[action.column!]
        if (typeof raw === 'string' && action.tokens!.includes(raw.trim())) {
          affected += 1
          return { ...row, [action.column!]: null }
        }
        return row
      })
      log(action, affected, action.tokens.join(' / '), 'Missing')
      continue
    }

    if (action.type === 'coerce_numeric' && action.column) {
      let affected = 0
      nextRows = nextRows.map((row) => {
        const raw = row[action.column!]
        if (typeof raw === 'string' && !isMissing(raw)) {
          const n = numericValue(raw)
          if (n !== null) {
            affected += 1
            return { ...row, [action.column!]: n }
          }
        }
        return row
      })
      log(action, affected, 'Numeric-like text', 'Number')
      continue
    }

    if (action.type === 'normalize_date' && action.column) {
      let affected = 0
      const withTime = isDatetimeColumn(action.column)
      nextRows = nextRows.map((row) => {
        const raw = row[action.column!]
        if (isMissing(raw)) return row
        const date = parseLooseDate(raw)
        if (!date) return row
        const formatted = formatDate(date, withTime)
        if (String(raw) === formatted) return row
        affected += 1
        return { ...row, [action.column!]: formatted }
      })
      log(action, affected, 'Mixed date formats', withTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD')
      continue
    }

    if (action.type === 'remove_column' && action.column) {
      let affected = 0
      nextRows = nextRows.map((row) => {
        if (!(action.column! in row)) return row
        const copy = { ...row }
        delete copy[action.column!]
        affected += 1
        return copy
      })
      log(action, affected, action.column, 'Removed from cleaned copy')
      continue
    }

    if (action.type === 'trim_strings') {
      let affected = 0
      nextRows = nextRows.map((row) => {
        const copy = { ...row }
        Object.keys(copy).forEach((key) => {
          if (typeof copy[key] === 'string' && copy[key] !== copy[key].trim()) {
            copy[key] = copy[key].trim()
            affected += 1
          }
        })
        return copy
      })
      log(action, affected, 'Text with spaces', 'Trimmed text')
      continue
    }

    if (action.type === 'flag_outlier') {
      log(action, action.rowIndexes?.length ?? 0, 'Outlier', 'Kept + logged')
    }
  }

  return { rows: nextRows, logs }
}
