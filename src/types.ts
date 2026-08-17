export type CellValue = string | number | boolean | null
export type DataRow = Record<string, CellValue>

export type ColumnKind =
  | 'id'
  | 'numeric'
  | 'category'
  | 'date'
  | 'datetime'
  | 'text'
  | 'boolean'
  | 'percentage'
  | 'currency'
  | 'unknown'

export type IssueSeverity = 'critical' | 'warning' | 'suggestion'
export type IssueType =
  | 'missing'
  | 'duplicate'
  | 'type'
  | 'category'
  | 'outlier'
  | 'date'
  | 'uniqueness'
  | 'logic'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface DatasetMeta {
  fileName: string
  sheetName?: string
  rowCount: number
  columnCount: number
  loadedAt: string
}

export interface ColumnProfile {
  name: string
  kind: ColumnKind
  missingCount: number
  missingRate: number
  uniqueCount: number
  uniqueRate: number
  examples: CellValue[]
  numeric?: {
    min: number
    max: number
    mean: number
    median: number
    q1: number
    q3: number
  }
}

export interface IssueEvidence {
  label: string
  value: string
  meta?: string
}

export interface CleaningAction {
  id: string
  issueId: string
  type:
    | 'remove_exact_duplicates'
    | 'trim_strings'
    | 'replace_missing_tokens'
    | 'normalize_category'
    | 'coerce_numeric'
    | 'normalize_date'
    | 'flag_outlier'
    | 'remove_column'
  label: string
  description: string
  risk: RiskLevel
  autoSelected: boolean
  column?: string
  mapping?: Record<string, string>
  tokens?: string[]
  rowIndexes?: number[]
}

export interface DataIssue {
  id: string
  type: IssueType
  severity: IssueSeverity
  title: string
  column?: string
  summary: string
  why: string
  suggestion: string
  evidence: IssueEvidence[]
  confidence?: number
  detector: string
  affectedRows: number
  action?: CleaningAction
}

export interface ReadinessScore {
  total: number
  completeness: number
  validity: number
  consistency: number
  uniqueness: number
  logic: number
}

export interface DiagnosisResult {
  profiles: ColumnProfile[]
  issues: DataIssue[]
  score: ReadinessScore
}

export interface ChangeLogEntry {
  step: number
  actionId: string
  action: string
  column?: string
  affectedRows: number
  before?: string
  after?: string
  at: string
}

export interface PreviewChange {
  row: number
  column: string
  before: string
  after: string
}
