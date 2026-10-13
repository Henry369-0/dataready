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

function parseCsv(text: string): DataRow[] {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    // Preserve the source; numeric conversion belongs in the reviewed cleaning plan.
    dynamicTyping: false,
  })
  const error = parsed.errors.find((entry) => entry.code !== 'UndetectableDelimiter')
  if (error) throw new Error(`CSV 解析失败：请检查第 ${(error.row ?? 0) + 2} 行的引号或字段数量。`)
  const fields = parsed.meta.fields ?? []
  if (!fields.length || fields.some((field) => !field.trim())) throw new Error('CSV 缺少有效字段名，请检查第一行。')
  if (!parsed.data.length) throw new Error('文件没有可分析的数据行，请添加数据后重试。')
  return normalizeRows(parsed.data)
}

export async function parseFile(file: File): Promise<{ rows: DataRow[]; meta: DatasetMeta }> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.csv')) {
    const text = await file.text()
    const rows = parseCsv(text)
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
    if (!sheetName) throw new Error('Excel 没有可读取的工作表。')
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
    const rows = normalizeRows(raw)
    if (!rows.length) throw new Error('首个工作表没有可分析的数据行，请添加数据后重试。')
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
  const rows = parseCsv(text)
  return {
    rows,
    meta: {
      fileName: 'retail_operations_dirty.csv',
      sheetName: '经营数据',
      rowCount: rows.length,
      columnCount: rows.length ? Object.keys(rows[0]).length : 0,
      loadedAt: new Date().toISOString(),
    },
  }
}
