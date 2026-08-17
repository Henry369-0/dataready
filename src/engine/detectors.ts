import type { CleaningAction, ColumnProfile, DataIssue, DataRow, DiagnosisResult } from '../types'
import { profileDataset } from './profiler'
import { calculateReadiness } from './scoring'
import {
  CITY_ALIASES,
  MISSING_TOKENS,
  displayValue,
  formatPercent,
  hashRow,
  isMissing,
  normalizeString,
  numericValue,
  parseLooseDate,
  quantile,
} from './utils'

let issueSeq = 0
const nextId = (prefix: string) => `${prefix}-${++issueSeq}`

function action(input: Omit<CleaningAction, 'id'>): CleaningAction {
  return { ...input, id: `action-${Math.random().toString(36).slice(2, 10)}` }
}

function detectMissing(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (!p.missingCount) continue
    const severity = p.missingRate >= 0.2 ? 'critical' : p.missingRate >= 0.05 ? 'warning' : 'suggestion'
    const issueId = nextId('missing')
    const tokens = Array.from(new Set(rows.map((row) => row[p.name]).filter((v): v is string => typeof v === 'string' && v.trim() !== '' && MISSING_TOKENS.has(v.trim().toLowerCase())).map((v) => v.trim())))
    issues.push({
      id: issueId,
      type: 'missing',
      severity,
      title: `${p.name} 存在缺失值`,
      column: p.name,
      summary: `${p.missingCount.toLocaleString()} / ${rows.length.toLocaleString()} 行为空或使用了常见缺失值编码（${formatPercent(p.missingRate)}）。`,
      why: '缺失值是否会影响分析，取决于字段用途。关键维度或指标缺失可能造成样本减少、聚合偏差或模型结果变化。',
      suggestion: tokens.length ? `其中包含 ${tokens.join(' / ')} 等明确缺失编码，可先安全统一为 Missing；是否填充值仍需要你决定。` : (p.missingRate < 0.05 ? '缺失比例较低，建议先确认这些记录是否可以保留；DataReady 不会默认进行填充。' : '建议先检查缺失是否集中在特定日期、城市或业务分组，再决定删除、填充或保留。'),
      evidence: [
        { label: '缺失数量', value: p.missingCount.toLocaleString() },
        { label: '缺失比例', value: formatPercent(p.missingRate) },
      ],
      detector: 'Missing Value Detector',
      affectedRows: p.missingCount,
      action: tokens.length ? action({
        issueId,
        type: 'replace_missing_tokens',
        label: `统一 ${p.name} 中的缺失值编码`,
        description: `${tokens.join(' / ')} → Missing；不进行均值、中位数等自动填充。`,
        risk: 'low',
        autoSelected: true,
        column: p.name,
        tokens,
      }) : undefined,
    })
  }
  return issues
}

function detectDuplicates(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  if (!rows.length) return []
  const columns = profiles.map((p) => p.name)
  const seen = new Map<string, number>()
  const dupIndexes: number[] = []
  rows.forEach((row, index) => {
    const key = hashRow(row, columns)
    if (seen.has(key)) dupIndexes.push(index)
    else seen.set(key, index)
  })
  if (!dupIndexes.length) return []
  const issueId = nextId('duplicate')
  return [{
    id: issueId,
    type: 'duplicate',
    severity: 'critical',
    title: '发现完全重复记录',
    summary: `共有 ${dupIndexes.length.toLocaleString()} 行与更早的记录完全一致。`,
    why: '完全重复记录可能让订单量、GMV、成本等聚合指标被重复计算，是分析前优先级很高的问题。',
    suggestion: '若这些记录不是业务上允许的重复事件，建议保留第一次出现的记录并删除后续完全重复行。',
    evidence: [
      { label: '重复行', value: dupIndexes.length.toLocaleString() },
      { label: '占数据量', value: formatPercent(dupIndexes.length / rows.length) },
    ],
    detector: 'Exact Duplicate Detector',
    affectedRows: dupIndexes.length,
    action: action({
      issueId,
      type: 'remove_exact_duplicates',
      label: `删除 ${dupIndexes.length} 条完全重复记录`,
      description: '保留第一次出现的记录，删除后续完全相同的行。',
      risk: 'low',
      autoSelected: true,
      rowIndexes: dupIndexes,
    }),
  }]
}

function detectTypes(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (!['numeric', 'currency', 'percentage'].includes(p.kind)) continue
    const bad: { index: number; value: string }[] = []
    const numericText: { index: number; value: string }[] = []
    rows.forEach((row, index) => {
      const value = row[p.name]
      if (isMissing(value)) return
      const numeric = numericValue(value)
      if (numeric === null) bad.push({ index, value: displayValue(value) })
      else if (typeof value === 'string') numericText.push({ index, value })
    })
    if (numericText.length) {
      const convertId = nextId('numeric-text')
      issues.push({
        id: convertId,
        type: 'type',
        severity: 'suggestion',
        title: `${p.name} 中有数字以文本形式存储`,
        column: p.name,
        summary: `发现 ${numericText.length} 个可以可靠解析为数字的文本值。`,
        why: '数字文本在 Excel 或后续代码中可能导致排序、求和和类型推断不一致。',
        suggestion: '可以安全转换为数值类型；原始文件不会被覆盖。',
        evidence: numericText.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: x.value })),
        detector: 'Numeric Coercion Detector',
        affectedRows: numericText.length,
        action: action({
          issueId: convertId,
          type: 'coerce_numeric',
          label: `将 ${p.name} 的 ${numericText.length} 个数字文本转为数值`,
          description: '只转换可以明确解析的数字文本。',
          risk: 'low',
          autoSelected: true,
          column: p.name,
        }),
      })
    }
    if (!bad.length) continue
    const issueId = nextId('type')
    issues.push({
      id: issueId,
      type: 'type',
      severity: bad.length / rows.length > 0.03 ? 'critical' : 'warning',
      title: `${p.name} 包含非数值内容`,
      column: p.name,
      summary: `该字段被识别为${p.kind === 'currency' ? '金额' : p.kind === 'percentage' ? '比例' : '数值'}字段，但发现 ${bad.length} 个无法转换为数字的值。`,
      why: '数值列混入文本会导致求和、均值、排序或图表计算失败，也可能让分析工具把整列当成文本。',
      suggestion: '建议逐个确认这些值是否属于缺失编码、录入错误或真实文本。DataReady 不会直接猜测数值。',
      evidence: bad.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: x.value })),
      detector: 'Type Consistency Detector',
      affectedRows: bad.length,
    })
  }
  return issues
}

function detectCategory(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (!['category', 'text'].includes(p.kind) || p.uniqueCount > 80) continue
    const rawCounts = new Map<string, number>()
    rows.forEach((row) => {
      const v = row[p.name]
      if (!isMissing(v)) rawCounts.set(String(v), (rawCounts.get(String(v)) ?? 0) + 1)
    })

    const mapping: Record<string, string> = {}
    const groups = new Map<string, string[]>()
    for (const raw of rawCounts.keys()) {
      const norm = normalizeString(raw)
      const canonical = CITY_ALIASES[norm] ?? CITY_ALIASES[raw.trim().toLowerCase()] ?? null
      const key = canonical ? `alias:${canonical}` : `norm:${norm}`
      const arr = groups.get(key) ?? []
      arr.push(raw)
      groups.set(key, arr)
    }

    const candidates = [...groups.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([key, values]) => {
        const alias = key.startsWith('alias:') ? key.slice(6) : null
        const canonical = alias ?? values.slice().sort((a, b) => rawCounts.get(b)! - rawCounts.get(a)!)[0].trim()
        values.filter((v) => v !== canonical).forEach((v) => { mapping[v] = canonical })
        return { canonical, values }
      })

    if (!candidates.length) continue
    const affected = Object.keys(mapping).reduce((n, key) => n + (rawCounts.get(key) ?? 0), 0)
    const hasKnownAlias = candidates.some((c) => c.values.some((v) => Boolean(CITY_ALIASES[normalizeString(v)])))
    const issueId = nextId('category')
    issues.push({
      id: issueId,
      type: 'category',
      severity: hasKnownAlias || affected / rows.length > 0.05 ? 'warning' : 'suggestion',
      title: `${p.name} 可能存在类别值不一致`,
      column: p.name,
      summary: `发现 ${candidates.length} 组写法不同、但可能代表同一类别的值。`,
      why: '如果直接按该字段分组汇总，同一业务对象可能被拆成多个类别，导致维度结果被稀释。',
      suggestion: '建议先预览映射关系，再决定是否统一。语义类合并默认需要人工确认。',
      evidence: candidates.slice(0, 3).flatMap((g) => g.values.slice(0, 3).map((v) => ({ label: v, value: `${rawCounts.get(v)} 行`, meta: `建议 → ${g.canonical}` }))),
      detector: 'Semantic + Normalized Category Matcher',
      confidence: hasKnownAlias ? 96 : 92,
      affectedRows: affected,
      action: action({
        issueId,
        type: 'normalize_category',
        label: `统一 ${p.name} 的 ${Object.keys(mapping).length} 个类别写法`,
        description: '仅按预览中的映射关系替换原值。',
        risk: 'medium',
        autoSelected: false,
        column: p.name,
        mapping,
      }),
    })
  }
  return issues
}

function detectOutliers(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (!['numeric', 'currency', 'percentage'].includes(p.kind)) continue
    const vals = rows
      .map((row, index) => ({ index, value: numericValue(row[p.name]) }))
      .filter((x): x is { index: number; value: number } => x.value !== null)
    if (vals.length < 25) continue
    const nums = vals.map((x) => x.value).sort((a, b) => a - b)
    const q1 = quantile(nums, 0.25)
    const q3 = quantile(nums, 0.75)
    const iqr = q3 - q1
    if (iqr === 0) continue
    const lower = q1 - 3 * iqr
    const upper = q3 + 3 * iqr
    const outliers = vals.filter((x) => x.value < lower || x.value > upper)
    if (!outliers.length) continue
    const issueId = nextId('outlier')
    issues.push({
      id: issueId,
      type: 'outlier',
      severity: 'warning',
      title: `${p.name} 出现极端值`,
      column: p.name,
      summary: `基于较保守的 3×IQR 规则，发现 ${outliers.length} 条记录明显偏离整体分布。`,
      why: '极端值可能是真实的大额业务，也可能来自单位、录入或采集错误。统计异常不等于业务错误。',
      suggestion: '建议结合原始业务语境检查。DataReady 只标记，不会默认删除或截尾。',
      evidence: outliers.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: x.value.toLocaleString() })),
      detector: 'Robust IQR Detector',
      affectedRows: outliers.length,
      action: action({
        issueId,
        type: 'flag_outlier',
        label: `保留并标记 ${outliers.length} 条 ${p.name} 极端值`,
        description: '不修改数值，仅在清洗日志中记录这些行值得复核。',
        risk: 'high',
        autoSelected: false,
        column: p.name,
        rowIndexes: outliers.map((x) => x.index),
      }),
    })
  }
  return issues
}

function detectDates(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (!['date', 'datetime'].includes(p.kind)) continue
    const valid: { index: number; raw: string }[] = []
    const invalid: { index: number; raw: string }[] = []
    rows.forEach((row, index) => {
      const value = row[p.name]
      if (isMissing(value)) return
      const parsed = parseLooseDate(value)
      if (parsed) valid.push({ index, raw: String(value) })
      else invalid.push({ index, raw: String(value) })
    })
    if (invalid.length) {
      const issueId = nextId('date-invalid')
      issues.push({
        id: issueId,
        type: 'date',
        severity: 'critical',
        title: `${p.name} 存在无法解析的日期`,
        column: p.name,
        summary: `发现 ${invalid.length} 个值无法可靠转换成日期。`,
        why: '非法日期会影响按天/周/月聚合、同比环比、时间排序和时效计算。',
        suggestion: '建议回到源数据确认这些记录；DataReady 不会凭空修正无法解析的日期。',
        evidence: invalid.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: x.raw })),
        detector: 'Date Parser',
        affectedRows: invalid.length,
      })
    }
    const formatSet = new Set(valid.map((x) => x.raw.replace(/\d/g, '#')))
    if (formatSet.size > 1 && valid.length) {
      const issueId = nextId('date-format')
      issues.push({
        id: issueId,
        type: 'date',
        severity: 'suggestion',
        title: `${p.name} 使用了多种日期格式`,
        column: p.name,
        summary: `同一字段中识别到 ${formatSet.size} 种日期写法。`,
        why: '格式混用不一定造成错误，但统一格式可以降低跨工具导入、排序和人工核对的歧义。',
        suggestion: '可安全统一为 YYYY-MM-DD；如果字段包含时分秒，则保留时间。',
        evidence: valid.slice(0, 5).map((x) => ({ label: `第 ${x.index + 2} 行`, value: x.raw })),
        detector: 'Date Format Detector',
        affectedRows: valid.length,
        action: action({
          issueId,
          type: 'normalize_date',
          label: `标准化 ${p.name} 日期格式`,
          description: `统一为 ${p.kind === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'}。`,
          risk: 'low',
          autoSelected: true,
          column: p.name,
        }),
      })
    }
  }
  return issues
}

function detectUniqueness(rows: DataRow[], profiles: ColumnProfile[]): DataIssue[] {
  const issues: DataIssue[] = []
  for (const p of profiles) {
    if (p.uniqueCount === 1 && rows.length > 5) {
      const issueId = nextId('constant')
      issues.push({
        id: issueId,
        type: 'uniqueness',
        severity: 'suggestion',
        title: `${p.name} 是常量字段`,
        column: p.name,
        summary: '除缺失值外，该字段只有 1 个唯一值。',
        why: '常量字段通常不提供分组或建模区分度，但可能仍具有业务说明意义。',
        suggestion: '如果后续分析不需要该字段，可以从分析副本中移除；原始数据仍应保留。',
        evidence: [{ label: '唯一值数量', value: '1' }, { label: '示例', value: displayValue(p.examples[0]) }],
        detector: 'Cardinality Detector',
        affectedRows: rows.length - p.missingCount,
        action: action({
          issueId,
          type: 'remove_column',
          label: `从分析副本移除常量字段 ${p.name}`,
          description: '只从清洗后的副本移除，不影响原文件。',
          risk: 'medium',
          autoSelected: false,
          column: p.name,
        }),
      })
    } else if (p.kind === 'category' && p.uniqueRate > 0.9 && rows.length > 50) {
      const issueId = nextId('high-unique')
      issues.push({
        id: issueId,
        type: 'uniqueness',
        severity: 'suggestion',
        title: `${p.name} 几乎每行都不同`,
        column: p.name,
        summary: `唯一值占有效记录的 ${formatPercent(p.uniqueRate)}，更像 ID 或自由文本，而不是普通类别变量。`,
        why: '高唯一值字段直接拿来做类别分组，通常会产生大量碎片化分组。',
        suggestion: '建议确认字段角色，必要时将其视为 ID / 文本，而不是普通分类维度。',
        evidence: [{ label: '唯一值', value: p.uniqueCount.toLocaleString() }, { label: '唯一率', value: formatPercent(p.uniqueRate) }],
        detector: 'Cardinality Detector',
        affectedRows: p.uniqueCount,
      })
    }
  }
  return issues
}

function detectLogic(rows: DataRow[]): DataIssue[] {
  const issues: DataIssue[] = []
  const columns = rows.length ? Object.keys(rows[0]) : []
  const gmv = columns.find((c) => /(^|_)gmv($|_)|销售额|成交额/i.test(c))
  const orders = columns.find((c) => /(^|_)orders?($|_)|订单量|订单数/i.test(c))
  if (gmv && orders) {
    const bad = rows
      .map((row, index) => ({ index, g: numericValue(row[gmv]), o: numericValue(row[orders]) }))
      .filter((x) => x.o === 0 && x.g !== null && x.g > 0)
    if (bad.length) {
      const issueId = nextId('logic-orders-gmv')
      issues.push({
        id: issueId,
        type: 'logic',
        severity: 'warning',
        title: '订单量为 0，但 GMV 大于 0',
        summary: `发现 ${bad.length} 条记录同时满足 ${orders}=0 且 ${gmv}>0。`,
        why: '如果两列口径对应同一业务范围，这种组合可能造成客单价、转化或经营汇总失真；也可能只是指标口径不同。',
        suggestion: '建议优先核对指标口径与源数据。DataReady 只提示逻辑冲突，不自动修改业务值。',
        evidence: bad.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: `${orders}=0 · ${gmv}=${x.g}` })),
        detector: 'Business Logic Rule',
        affectedRows: bad.length,
      })
    }
  }

  for (const p of ['gmv', 'cost', 'amount', 'orders', 'delivery_time']) {
    const col = columns.find((c) => c.toLowerCase().includes(p))
    if (!col) continue
    const negative = rows
      .map((row, index) => ({ index, value: numericValue(row[col]) }))
      .filter((x) => x.value !== null && x.value < 0)
    if (!negative.length) continue
    const issueId = nextId(`logic-negative-${p}`)
    issues.push({
      id: issueId,
      type: 'logic',
      severity: 'warning',
      title: `${col} 出现负值`,
      column: col,
      summary: `发现 ${negative.length} 条小于 0 的记录。`,
      why: '负值可能代表退款、冲销等真实业务，也可能是录入或单位错误，需要结合字段口径确认。',
      suggestion: '不要直接改成 0。建议查看原始记录并确认该指标是否允许负数。',
      evidence: negative.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: String(x.value) })),
      detector: 'Business Logic Rule',
      affectedRows: negative.length,
    })
  }

  const createCol = columns.find((c) => /create.*time|创建时间/i.test(c))
  const completeCol = columns.find((c) => /complete.*time|完成时间/i.test(c))
  if (createCol && completeCol) {
    const bad = rows
      .map((row, index) => ({ index, a: parseLooseDate(row[createCol]), b: parseLooseDate(row[completeCol]) }))
      .filter((x) => x.a && x.b && x.b < x.a)
    if (bad.length) {
      const issueId = nextId('logic-time')
      issues.push({
        id: issueId,
        type: 'logic',
        severity: 'critical',
        title: '完成时间早于创建时间',
        summary: `发现 ${bad.length} 条记录的时间顺序不成立。`,
        why: '时间顺序错误会直接影响时长、履约和漏斗分析。',
        suggestion: '建议回源核对时间字段和时区，不自动交换两个字段。',
        evidence: bad.slice(0, 4).map((x) => ({ label: `第 ${x.index + 2} 行`, value: `${createCol} > ${completeCol}` })),
        detector: 'Temporal Logic Rule',
        affectedRows: bad.length,
      })
    }
  }

  return issues
}

export function diagnoseDataset(rows: DataRow[]): DiagnosisResult {
  issueSeq = 0
  const profiles = profileDataset(rows)
  const issues = [
    ...detectDuplicates(rows, profiles),
    ...detectLogic(rows),
    ...detectTypes(rows, profiles),
    ...detectDates(rows, profiles),
    ...detectCategory(rows, profiles),
    ...detectMissing(rows, profiles),
    ...detectOutliers(rows, profiles),
    ...detectUniqueness(rows, profiles),
  ].sort((a, b) => {
    const rank = { critical: 0, warning: 1, suggestion: 2 }
    return rank[a.severity] - rank[b.severity] || b.affectedRows - a.affectedRows
  })
  return {
    profiles,
    issues,
    score: calculateReadiness(issues, rows.length, profiles.length),
  }
}
