import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataRow, DatasetMeta } from '../types'

function normalizeRows(rows: Record<string, unknown>[]): DataRow[] {
  return rows.map((row) => {
    const next: DataRow = {}
    Object.entries(row).forEach(([key, value]) => {
      if (value === undefined || value === null) next[key] = null
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') next[key] = value
      else next[key] = String(value)
    })
    return next
  })
}

export async function parseFile(file: File): Promise<{ rows: DataRow[]; meta: DatasetMeta }> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.csv')) {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: true,
    })
    const rows = normalizeRows(parsed.data)
    return {
      rows,
      meta: {
        fileName: file.name,
        rowCount: rows.length,
        columnCount: rows.length ? Object.keys(rows[0]).length : 0,
        loadedAt: new Date().toISOString(),
      },
    }
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
    const rows = normalizeRows(raw)
    return {
      rows,
      meta: {
        fileName: file.name,
        sheetName,
        rowCount: rows.length,
        columnCount: rows.length ? Object.keys(rows[0]).length : 0,
        loadedAt: new Date().toISOString(),
      },
    }
  }

  throw new Error('暂不支持该文件格式，请上传 CSV / XLSX / XLS。')
}

export async function loadDemoCsv(): Promise<{ rows: DataRow[]; meta: DatasetMeta }> {
  const response = await fetch('./demo/retail_operations_dirty.csv')
  if (!response.ok) throw new Error('示例数据加载失败。')
  const text = await response.text()
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: true,
  })
  const rows = normalizeRows(parsed.data)
  return {
    rows,
    meta: {
      fileName: 'retail_operations_dirty.xlsx',
      sheetName: '经营数据',
      rowCount: rows.length,
      columnCount: rows.length ? Object.keys(rows[0]).length : 0,
      loadedAt: new Date().toISOString(),
    },
  }
}
