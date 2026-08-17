import type { DataIssue, ReadinessScore } from '../types'
import { clamp } from './utils'

/**
 * Data Readiness is deliberately an auxiliary score, not a statistical truth.
 * Each issue contributes a bounded penalty based on severity plus a small
 * prevalence boost. This keeps one issue that touches every row (for example,
 * mixed date formatting) from collapsing a whole dimension to zero.
 */
const severityPenalty = { critical: 22, warning: 10, suggestion: 4 }

function dimensionScore(issues: DataIssue[], types: DataIssue['type'][], rowCount: number): number {
  const relevant = issues.filter((issue) => types.includes(issue.type))
  const penalty = relevant.reduce((sum, issue) => {
    const rate = rowCount > 0 ? Math.min(1, issue.affectedRows / rowCount) : 0
    const prevalenceBoost = 1 + Math.min(1, rate * 5) * 0.35
    return sum + severityPenalty[issue.severity] * prevalenceBoost
  }, 0)
  return clamp(100 - penalty)
}

export function calculateReadiness(issues: DataIssue[], rowCount: number, _columnCount: number): ReadinessScore {
  const completeness = dimensionScore(issues, ['missing'], rowCount)
  const validity = dimensionScore(issues, ['type', 'date', 'outlier'], rowCount)
  const consistency = dimensionScore(issues, ['category'], rowCount)
  const uniqueness = dimensionScore(issues, ['duplicate', 'uniqueness'], rowCount)
  const logic = dimensionScore(issues, ['logic'], rowCount)

  return {
    completeness,
    validity,
    consistency,
    uniqueness,
    logic,
    total: clamp(completeness * 0.2 + validity * 0.25 + consistency * 0.2 + uniqueness * 0.15 + logic * 0.2),
  }
}
