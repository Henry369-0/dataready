import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Download,
  FileJson,
  FileSpreadsheet,
  Github,
  History,
  Info,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Lock,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Table2,
  Upload,
  X,
} from 'lucide-react'
import type {
  ChangeLogEntry,
  CleaningAction,
  DataIssue,
  DataRow,
  DatasetMeta,
  DiagnosisResult,
  IssueSeverity,
  PreviewChange,
} from './types'
import { parseFile, loadDemoCsv } from './engine/parser'
import { diagnoseDataset } from './engine/detectors'
import { applyActions, previewActions } from './engine/cleaning'
import { buildPythonScript, exportLog, exportPython, exportRecipe, exportXlsx } from './engine/exporters'
import { displayValue } from './engine/utils'

type View = 'overview' | 'issues' | 'cleaning' | 'history' | 'export'

type Snapshot = {
  rows: DataRow[]
  diagnosis: DiagnosisResult
  logs: ChangeLogEntry[]
  appliedActions: CleaningAction[]
}

const viewLabels: Record<View, string> = {
  overview: '数据概览',
  issues: '数据问题',
  cleaning: '清洗方案',
  history: '修改记录',
  export: '导出',
}

const severityMeta: Record<IssueSeverity, { label: string; icon: typeof AlertCircle }> = {
  critical: { label: '必须处理', icon: AlertCircle },
  warning: { label: '建议检查', icon: AlertTriangle },
  suggestion: { label: '优化建议', icon: Info },
}

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [rawRows, setRawRows] = useState<DataRow[]>([])
  const [rows, setRows] = useState<DataRow[]>([])
  const [meta, setMeta] = useState<DatasetMeta | null>(null)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null)
  const [initialDiagnosis, setInitialDiagnosis] = useState<DiagnosisResult | null>(null)
  const [activeView, setActiveView] = useState<View>('overview')
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<ChangeLogEntry[]>([])
  const [appliedActions, setAppliedActions] = useState<CleaningAction[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])
  const [preview, setPreview] = useState<{ actions: CleaningAction[]; changes: PreviewChange[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [issueFilter, setIssueFilter] = useState<'all' | IssueSeverity>('all')
  const [hasApplied, setHasApplied] = useState(false)

  const loadDataset = (nextRows: DataRow[], nextMeta: DatasetMeta, view: View = 'overview') => {
    const result = diagnoseDataset(nextRows)
    setRawRows(nextRows.map((r) => ({ ...r })))
    setRows(nextRows.map((r) => ({ ...r })))
    setMeta(nextMeta)
    setDiagnosis(result)
    setInitialDiagnosis(result)
    setLogs([])
    setAppliedActions([])
    setHistory([])
    setHasApplied(false)
    setSelectedActions(new Set(result.issues.flatMap((i) => i.action?.autoSelected ? [i.action.id] : [])))
    setActiveView(view)
    setError('')
  }

  const loadDemo = async (view?: View) => {
    try {
      setLoading(true)
      const demo = await loadDemoCsv()
      loadDataset(demo.rows, demo.meta, view ?? 'overview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '示例数据加载失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') {
      const requested = params.get('view') as View | null
      loadDemo(requested && viewLabels[requested] ? requested : 'overview')
    }
    // only bootstrap once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFile = async (file?: File) => {
    if (!file) return
    try {
      setLoading(true)
      const parsed = await parseFile(file)
      loadDataset(parsed.rows, parsed.meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件解析失败。')
    } finally {
      setLoading(false)
    }
  }

  const allActions = useMemo(() => diagnosis?.issues.flatMap((i) => i.action ? [i.action] : []) ?? [], [diagnosis])
  const selected = useMemo(() => allActions.filter((a) => selectedActions.has(a.id)), [allActions, selectedActions])
  const counts = useMemo(() => {
    const issues = diagnosis?.issues ?? []
    return {
      critical: issues.filter((i) => i.severity === 'critical').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      suggestion: issues.filter((i) => i.severity === 'suggestion').length,
    }
  }, [diagnosis])

  const toggleAction = (id: string) => {
    setSelectedActions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const showPreview = (actions = selected) => {
    setPreview({ actions, changes: previewActions(rows, actions) })
  }

  const executeCleaning = () => {
    if (!diagnosis || !selected.length) return
    setHistory((prev) => [...prev, { rows: rows.map((r) => ({ ...r })), diagnosis, logs: [...logs], appliedActions: [...appliedActions] }])
    const result = applyActions(rows, selected, logs.length + 1)
    const nextDiagnosis = diagnoseDataset(result.rows)
    setRows(result.rows)
    setLogs((prev) => [...prev, ...result.logs])
    setAppliedActions((prev) => [...prev, ...selected])
    setDiagnosis(nextDiagnosis)
    setSelectedActions(new Set(nextDiagnosis.issues.flatMap((i) => i.action?.autoSelected ? [i.action.id] : [])))
    setPreview(null)
    setHasApplied(true)
    setActiveView('export')
  }

  const undo = () => {
    const snapshot = history.at(-1)
    if (!snapshot) return
    setRows(snapshot.rows)
    setDiagnosis(snapshot.diagnosis)
    setLogs(snapshot.logs)
    setAppliedActions(snapshot.appliedActions)
    setHistory((prev) => prev.slice(0, -1))
    setHasApplied(snapshot.logs.length > 0)
    setSelectedActions(new Set(snapshot.diagnosis.issues.flatMap((i) => i.action?.autoSelected ? [i.action.id] : [])))
  }

  const restoreOriginal = () => {
    if (!meta || !rawRows.length) return
    loadDataset(rawRows, meta)
  }

  if (!meta || !diagnosis) {
    return (
      <Landing
        loading={loading}
        error={error}
        onDemo={() => loadDemo()}
        onFile={handleFile}
        inputRef={inputRef}
      />
    )
  }

  return (
    <div className="app-shell">
      <WorkspaceTopbar
        meta={meta}
        score={diagnosis.score.total}
        canUndo={history.length > 0}
        onUndo={undo}
        onRestore={restoreOriginal}
      />
      <div className="workspace-layout">
        <Sidebar
          active={activeView}
          onChange={setActiveView}
          counts={counts}
          selectedCount={selected.length}
          meta={meta}
        />
        <main className="workspace-main">
          {activeView === 'overview' && <Overview rows={rows} meta={meta} diagnosis={diagnosis} />}
          {activeView === 'issues' && (
            <Issues
              issues={diagnosis.issues}
              filter={issueFilter}
              setFilter={setIssueFilter}
              selectedActions={selectedActions}
              toggleAction={toggleAction}
              onPreview={(action) => showPreview([action])}
            />
          )}
          {activeView === 'cleaning' && (
            <CleaningPlan
              actions={allActions}
              selectedActions={selectedActions}
              toggleAction={toggleAction}
              onPreview={() => showPreview()}
            />
          )}
          {activeView === 'history' && <HistoryView logs={logs} onUndo={undo} canUndo={history.length > 0} />}
          {activeView === 'export' && (
            <ExportView
              rows={rows}
              logs={logs}
              actions={appliedActions}
              initial={initialDiagnosis}
              current={diagnosis}
              hasApplied={hasApplied}
              onBack={() => setActiveView('cleaning')}
            />
          )}
        </main>
      </div>
      {preview && (
        <PreviewModal
          preview={preview}
          onClose={() => setPreview(null)}
          onExecute={executeCleaning}
          allowExecute={preview.actions.every((a) => selectedActions.has(a.id)) && preview.actions.length === selected.length}
          onAddAndClose={() => {
            setSelectedActions((prev) => new Set([...prev, ...preview.actions.map((a) => a.id)]))
            setPreview(null)
          }}
        />
      )}
    </div>
  )
}

function Landing({
  loading,
  error,
  onDemo,
  onFile,
  inputRef,
}: {
  loading: boolean
  error: string
  onDemo: () => void
  onFile: (file?: File) => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div className="landing">
      <header className="landing-topbar">
        <div className="landing-topbar-inner">
          <a className="brand" href="./">
            <img src="./logo-mark.svg" alt="DataReady" />
            <span>DataReady</span>
          </a>
          <div className="nav-actions">
            <a className="btn btn-ghost btn-small" href="#how">它怎么工作</a>
            <a className="btn btn-small" href="https://github.com/Henry369-0" target="_blank" rel="noreferrer">
              <Github size={16} /> GitHub
            </a>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> ANALYSIS PREFLIGHT</div>
          <h1>在分析之前，<span>先确认数据是否准备好。</span></h1>
          <p className="hero-sub">
            自动检查 Excel / CSV 中的缺失、重复、类型、类别、异常和业务逻辑问题，生成一份<strong>可审查、可撤销、可复现</strong>的清洗方案。
          </p>
          <div className="hero-points">
            <span><Lock size={15} /> 浏览器本地处理</span>
            <span><ShieldCheck size={15} /> 不覆盖原始数据</span>
            <span><Code2 size={15} /> 自动生成 Python</span>
          </div>
        </div>

        <div
          className={cn('upload-card', dragging && 'dragging')}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            onFile(e.dataTransfer.files[0])
          }}
        >
          <div className="upload-icon"><Upload size={25} /></div>
          <h2>把数据拖到这里</h2>
          <p>支持 CSV / XLSX / XLS，数据默认只在当前浏览器中解析。</p>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button className="btn btn-primary upload-main-btn" onClick={() => inputRef.current?.click()} disabled={loading}>
            {loading ? <Loader2 size={17} className="spin" /> : <FileSpreadsheet size={17} />}
            选择数据文件
          </button>
          <button className="demo-link" onClick={onDemo} disabled={loading}>
            没有文件？<strong>体验示例经营数据</strong> <ArrowRight size={14} />
          </button>
          {error && <div className="inline-error"><AlertCircle size={15} /> {error}</div>}
        </div>
      </section>

      <section className="trust-strip">
        <div className="trust-inner">
          <span>一个很小但完整的数据准备工作流</span>
          <div className="trust-points">
            <span><CheckCircle2 size={16} /> 先体检，再清洗</span>
            <span><CheckCircle2 size={16} /> 高风险操作不自动执行</span>
            <span><CheckCircle2 size={16} /> 修改过程可追踪</span>
          </div>
        </div>
      </section>

      <section className="section landing-story" id="how">
        <div className="section-kicker">HOW IT WORKS</div>
        <h2>不是再做一个 Excel 编辑器，而是把分析前最容易忽略的一步做完整。</h2>
        <div className="how-grid">
          <div className="how-card">
            <div className="how-num">01</div><SearchCheck size={23} />
            <h3>自动体检</h3><p>先理解字段和分布，再检查缺失、重复、格式、异常和逻辑问题。</p>
          </div>
          <div className="how-card">
            <div className="how-num">02</div><ClipboardCheck size={23} />
            <h3>生成方案</h3><p>安全操作可以默认勾选，语义合并、异常处理等保留给用户决定。</p>
          </div>
          <div className="how-card">
            <div className="how-num">03</div><Table2 size={23} />
            <h3>预览修改</h3><p>先看 Before / After 和受影响记录，再执行；原始文件永远不被覆盖。</p>
          </div>
          <div className="how-card">
            <div className="how-num">04</div><Code2 size={23} />
            <h3>留下过程</h3><p>导出清洗后数据、Cleaning Log、Python Script 和可复用 Recipe。</p>
          </div>
        </div>
      </section>

      <section className="section before-after-section">
        <div className="ba-copy">
          <div className="section-kicker">A SMALL PROMISE</div>
          <h2>最后回答的不是“改了多少格”，而是：现在可以开始分析了吗？</h2>
          <p>数据准备度只是一个入口，真正的判断来自每一条可解释的问题和处理记录。</p>
        </div>
        <div className="ba-card">
          <div className="ba-side muted-side"><span>处理前</span><strong>72</strong><small>3 必须处理 · 5 建议检查</small></div>
          <div className="ba-arrow"><ArrowRight size={21} /></div>
          <div className="ba-side ready-side"><span>处理后</span><strong>94</strong><small>0 必须处理 · 2 建议检查</small></div>
        </div>
      </section>

      <footer className="footer"><span>DataReady · Local-first data preparation</span><span>MIT License · 2026</span></footer>
    </div>
  )
}

function WorkspaceTopbar({ meta, score, canUndo, onUndo, onRestore }: {
  meta: DatasetMeta
  score: number
  canUndo: boolean
  onUndo: () => void
  onRestore: () => void
}) {
  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar-left">
        <a className="brand brand-compact" href="./"><img src="./logo-mark.svg" alt="" /><span>DataReady</span></a>
        <span className="topbar-divider" />
        <div className="dataset-title"><strong>{meta.fileName}</strong><span>{meta.rowCount.toLocaleString()} 行 · {meta.columnCount} 列</span></div>
      </div>
      <div className="workspace-actions">
        <div className={cn('score-pill', score >= 90 && 'good', score < 75 && 'needs-work')}><span>数据准备度</span><strong>{score}</strong></div>
        <button className="btn btn-small" disabled={!canUndo} onClick={onUndo}><RotateCcw size={15} /> 撤销</button>
        <button className="btn btn-ghost btn-small" onClick={onRestore}>恢复原始数据</button>
      </div>
    </header>
  )
}

function Sidebar({ active, onChange, counts, selectedCount, meta }: {
  active: View
  onChange: (v: View) => void
  counts: { critical: number; warning: number; suggestion: number }
  selectedCount: number
  meta: DatasetMeta
}) {
  const items: Array<{ id: View; icon: typeof LayoutDashboard; badge?: number }> = [
    { id: 'overview', icon: LayoutDashboard },
    { id: 'issues', icon: AlertCircle, badge: counts.critical + counts.warning + counts.suggestion },
    { id: 'cleaning', icon: ListChecks, badge: selectedCount },
    { id: 'history', icon: History },
    { id: 'export', icon: Download },
  ]
  return (
    <aside className="sidebar">
      <nav className="side-nav">
        <div className="side-label">DATASET</div>
        {items.map(({ id, icon: Icon, badge }) => (
          <button key={id} className={cn('side-item', active === id && 'active')} onClick={() => onChange(id)}>
            <Icon size={17} /><span>{viewLabels[id]}</span>{badge ? <em>{badge}</em> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-file">
        <FileSpreadsheet size={18} />
        <div><strong>{meta.fileName}</strong><span>{meta.sheetName ? `Sheet · ${meta.sheetName}` : '本地数据集'}</span></div>
      </div>
    </aside>
  )
}

function PageHeader({ kicker, title, lead, right }: { kicker: string; title: string; lead: string; right?: ReactNode }) {
  return (
    <div className="page-header">
      <div><div className="page-kicker">{kicker}</div><h1>{title}</h1><p>{lead}</p></div>
      {right && <div>{right}</div>}
    </div>
  )
}

function Overview({ rows, meta, diagnosis }: { rows: DataRow[]; meta: DatasetMeta; diagnosis: DiagnosisResult }) {
  const missing = diagnosis.profiles.reduce((sum, p) => sum + p.missingCount, 0)
  const duplicate = diagnosis.issues.find((i) => i.type === 'duplicate')?.affectedRows ?? 0
  return (
    <div className="page-wrap">
      <PageHeader kicker="OVERVIEW" title="先理解这份数据，再决定怎么处理。" lead="DataReady 已完成字段识别和第一轮体检。数据准备度用于快速定位风险，具体结论请以问题明细为准。" />
      <div className="overview-grid">
        <ScoreCard diagnosis={diagnosis} />
        <div className="stat-grid">
          <StatCard label="数据行数" value={meta.rowCount.toLocaleString()} note="当前分析副本" />
          <StatCard label="字段数" value={meta.columnCount.toString()} note="首个工作表" />
          <StatCard label="缺失单元格" value={missing.toLocaleString()} note="含常见缺失编码" />
          <StatCard label="完全重复行" value={duplicate.toLocaleString()} note={duplicate ? '建议优先处理' : '未发现'} />
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading"><div><h2>字段概览</h2><p>推断类型、缺失和唯一值只是辅助判断，不会修改原字段。</p></div><span className="panel-meta">{diagnosis.profiles.length} columns</span></div>
        <div className="table-scroll">
          <table className="data-table profile-table">
            <thead><tr><th>字段</th><th>推断类型</th><th>缺失</th><th>唯一值</th><th>示例</th></tr></thead>
            <tbody>{diagnosis.profiles.map((p) => (
              <tr key={p.name}>
                <td><code>{p.name}</code></td>
                <td><span className="type-pill">{typeLabel(p.kind)}</span></td>
                <td>{p.missingCount.toLocaleString()} <span className="muted">({(p.missingRate * 100).toFixed(1)}%)</span></td>
                <td>{p.uniqueCount.toLocaleString()}</td>
                <td className="examples-cell">{p.examples.slice(0, 3).map(displayValue).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h2>数据预览</h2><p>仅展示前 8 行，完整数据始终保留在浏览器内存中。</p></div></div>
        <DatasetPreview rows={rows.slice(0, 8)} />
      </section>
    </div>
  )
}

function ScoreCard({ diagnosis }: { diagnosis: DiagnosisResult }) {
  const { score } = diagnosis
  const dimensions = [
    ['完整性', score.completeness], ['有效性', score.validity], ['一致性', score.consistency], ['唯一性', score.uniqueness], ['逻辑合理性', score.logic],
  ] as const
  const critical = diagnosis.issues.filter((i) => i.severity === 'critical').length
  return (
    <div className="score-card panel">
      <div className="score-card-top"><div><span>DATA READINESS</span><h2>数据准备度</h2></div><div className={cn('score-number', score.total >= 90 && 'good')}>{score.total}</div></div>
      <p className="score-summary">{critical ? `当前仍有 ${critical} 个可能直接影响分析结果的问题，建议处理后再开始分析。` : '未发现必须处理的问题，可以结合剩余 Warning 决定是否进入分析。'}</p>
      <div className="dimension-list">{dimensions.map(([label, value]) => (
        <div className="dimension" key={label}><div><span>{label}</span><strong>{value}</strong></div><div className="progress"><i style={{ width: `${value}%` }} /></div></div>
      ))}</div>
      <div className="score-note"><Info size={14} /> 该分数基于当前内置规则，用于比较清洗前后状态，并非绝对的数据质量认证。</div>
    </div>
  )
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="stat-card panel"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function Issues({ issues, filter, setFilter, selectedActions, toggleAction, onPreview }: {
  issues: DataIssue[]
  filter: 'all' | IssueSeverity
  setFilter: (v: 'all' | IssueSeverity) => void
  selectedActions: Set<string>
  toggleAction: (id: string) => void
  onPreview: (action: CleaningAction) => void
}) {
  const filtered = filter === 'all' ? issues : issues.filter((i) => i.severity === filter)
  return (
    <div className="page-wrap">
      <PageHeader kicker="DIAGNOSE" title="这些问题值得在分析前看一眼。" lead="DataReady 区分“发现问题”和“修改数据”。每一条建议都说明为什么值得处理，以及系统到底准备做什么。" />
      <div className="filter-tabs">
        {(['all', 'critical', 'warning', 'suggestion'] as const).map((v) => {
          const count = v === 'all' ? issues.length : issues.filter((i) => i.severity === v).length
          const label = v === 'all' ? '全部' : severityMeta[v].label
          return <button key={v} className={cn(filter === v && 'active')} onClick={() => setFilter(v)}>{label}<em>{count}</em></button>
        })}
      </div>
      <div className="issues-list">
        {filtered.length ? filtered.map((issue) => (
          <IssueCard key={issue.id} issue={issue} selected={!!issue.action && selectedActions.has(issue.action.id)} toggleAction={toggleAction} onPreview={onPreview} />
        )) : <EmptyState icon={CheckCircle2} title="这一类没有发现问题" text="你可以继续查看其他严重程度的问题。" />}
      </div>
    </div>
  )
}

function IssueCard({ issue, selected, toggleAction, onPreview }: {
  issue: DataIssue
  selected: boolean
  toggleAction: (id: string) => void
  onPreview: (action: CleaningAction) => void
}) {
  const SIcon = severityMeta[issue.severity].icon
  return (
    <article className={cn('issue-card', `severity-${issue.severity}`)}>
      <div className="issue-head">
        <div className="issue-title-wrap">
          <span className="severity-icon"><SIcon size={17} /></span>
          <div><div className="issue-badges"><span>{severityMeta[issue.severity].label}</span>{issue.column && <code>{issue.column}</code>}</div><h2>{issue.title}</h2></div>
        </div>
        <span className="affected">影响 {issue.affectedRows.toLocaleString()} 行</span>
      </div>
      <p className="issue-summary">{issue.summary}</p>
      {issue.evidence.length > 0 && <div className="evidence-grid">{issue.evidence.slice(0, 6).map((e, index) => (
        <div className="evidence" key={`${e.label}-${index}`}><span>{e.label}</span><strong>{e.value}</strong>{e.meta && <small>{e.meta}</small>}</div>
      ))}</div>}
      <div className="issue-explain-grid">
        <div><span className="mini-label">为什么值得处理</span><p>{issue.why}</p></div>
        <div><span className="mini-label">DataReady 建议</span><p>{issue.suggestion}</p></div>
      </div>
      <div className="issue-footer">
        <div className="detector"><Sparkles size={14} /><span>{issue.detector}</span>{issue.confidence && <b>置信度 {issue.confidence}%</b>}</div>
        {issue.action ? <div className="issue-actions">
          <button className="btn btn-small" onClick={() => onPreview(issue.action!)}>预览修改</button>
          <button className={cn('btn btn-small', selected && 'btn-selected')} onClick={() => toggleAction(issue.action!.id)}>
            {selected ? <Check size={15} /> : <span className="empty-check" />} {selected ? '已加入方案' : '加入清洗方案'}
          </button>
        </div> : <span className="no-auto">仅提示 · 不自动修改</span>}
      </div>
    </article>
  )
}

function CleaningPlan({ actions, selectedActions, toggleAction, onPreview }: {
  actions: CleaningAction[]
  selectedActions: Set<string>
  toggleAction: (id: string) => void
  onPreview: () => void
}) {
  const selected = actions.filter((a) => selectedActions.has(a.id))
  const low = actions.filter((a) => a.risk === 'low')
  const review = actions.filter((a) => a.risk !== 'low')
  const estimated = selected.reduce((sum, a) => sum + (a.rowIndexes?.length ?? 0), 0)
  return (
    <div className="page-wrap cleaning-page">
      <PageHeader
        kicker="CLEANING PLAN"
        title="把零散建议，收成一份可审查的清洗方案。"
        lead="低风险、确定性的操作可以预选；涉及业务语义或数据删改的操作默认不勾选。执行前还能统一查看 Diff。"
        right={<div className="plan-summary"><span>已选择</span><strong>{selected.length}</strong><small>项操作</small></div>}
      />

      <ActionGroup title="安全操作" subtitle="规则明确、可逆，DataReady 可以默认选择。" actions={low} selectedActions={selectedActions} toggleAction={toggleAction} />
      <ActionGroup title="需要判断" subtitle="涉及语义、异常或字段删改，默认留给你决定。" actions={review} selectedActions={selectedActions} toggleAction={toggleAction} />

      <div className="plan-cta panel">
        <div><strong>{selected.length ? `准备执行 ${selected.length} 项修改` : '还没有选择任何操作'}</strong><span>{estimated ? `其中至少 ${estimated.toLocaleString()} 行来自显式记录定位。` : '预览会展示实际修改的 Before / After。'}</span></div>
        <button className="btn btn-primary" disabled={!selected.length} onClick={onPreview}><Table2 size={17} /> 预览全部修改 <ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

function ActionGroup({ title, subtitle, actions, selectedActions, toggleAction }: {
  title: string
  subtitle: string
  actions: CleaningAction[]
  selectedActions: Set<string>
  toggleAction: (id: string) => void
}) {
  if (!actions.length) return null
  return (
    <section className="panel action-group">
      <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="panel-meta">{actions.length} actions</span></div>
      <div className="action-list">{actions.map((a) => {
        const checked = selectedActions.has(a.id)
        return <button key={a.id} className={cn('action-row', checked && 'selected')} onClick={() => toggleAction(a.id)}>
          <span className={cn('checkbox', checked && 'checked')}>{checked && <Check size={14} />}</span>
          <div className="action-copy"><strong>{a.label}</strong><span>{a.description}</span></div>
          <span className={cn('risk-pill', `risk-${a.risk}`)}>{a.risk === 'low' ? '低风险' : a.risk === 'medium' ? '需确认' : '高风险'}</span>
        </button>
      })}</div>
    </section>
  )
}

function HistoryView({ logs, onUndo, canUndo }: { logs: ChangeLogEntry[]; onUndo: () => void; canUndo: boolean }) {
  return (
    <div className="page-wrap">
      <PageHeader kicker="CHANGE LOG" title="每一次修改，都应该说得清楚。" lead="DataReady 只记录已经执行的操作。你可以撤销最近一次批量执行，或导出完整 Cleaning Log。" right={<button className="btn btn-small" onClick={onUndo} disabled={!canUndo}><RotateCcw size={15} /> 撤销最近一次</button>} />
      {logs.length ? <section className="panel log-panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Step</th><th>操作</th><th>字段</th><th>影响行数</th><th>Before</th><th>After</th></tr></thead><tbody>{logs.map((l) => <tr key={`${l.step}-${l.actionId}`}><td>{l.step}</td><td>{l.action}</td><td>{l.column ? <code>{l.column}</code> : '—'}</td><td>{l.affectedRows.toLocaleString()}</td><td>{l.before ?? '—'}</td><td>{l.after ?? '—'}</td></tr>)}</tbody></table></div></section> : <EmptyState icon={History} title="还没有修改记录" text="先在“清洗方案”中预览并执行一组操作，日志会自动出现在这里。" />}
    </div>
  )
}

function ExportView({ rows, logs, actions, initial, current, hasApplied, onBack }: {
  rows: DataRow[]
  logs: ChangeLogEntry[]
  actions: CleaningAction[]
  initial: DiagnosisResult | null
  current: DiagnosisResult
  hasApplied: boolean
  onBack: () => void
}) {
  const before = initial?.score.total ?? current.score.total
  const beforeCritical = initial?.issues.filter((i) => i.severity === 'critical').length ?? 0
  const currentCritical = current.issues.filter((i) => i.severity === 'critical').length
  const currentWarning = current.issues.filter((i) => i.severity === 'warning').length
  const script = buildPythonScript(actions)

  if (!hasApplied) return <div className="page-wrap"><PageHeader kicker="EXPORT" title="先执行一次清洗，再导出结果。" lead="DataReady 不会生成一个“看起来更干净”的文件。只有经过你确认并执行的操作，才会进入导出结果。" /><EmptyState icon={Download} title="还没有可导出的清洗结果" text="前往“清洗方案”，选择并预览一组操作。" action={<button className="btn btn-primary" onClick={onBack}>前往清洗方案 <ArrowRight size={16} /></button>} /></div>

  return (
    <div className="page-wrap">
      <PageHeader kicker="READY" title="数据已经重新检查。" lead="下面的变化来自刚刚真实执行的规则。你仍然可以继续处理剩余 Warning，或者把当前版本作为分析副本导出。" />
      <div className="result-hero panel">
        <div className="result-side before"><span>处理前</span><strong>{before}</strong><small>{beforeCritical} 个必须处理</small></div>
        <div className="result-arrow"><ArrowRight size={22} /></div>
        <div className="result-side after"><span>处理后</span><strong>{current.score.total}</strong><small>{currentCritical} 个必须处理 · {currentWarning} 个建议检查</small></div>
        <div className="result-message"><CheckCircle2 size={22} /><div><strong>{currentCritical ? '仍有必须处理的问题' : '数据已基本准备好'}</strong><span>{currentCritical ? '建议继续核对剩余 Critical 后再进入正式分析。' : '可以进入分析阶段，同时保留剩余 Warning 作为核对项。'}</span></div></div>
      </div>

      <div className="export-grid">
        <ExportCard icon={FileSpreadsheet} title="清洗后的数据" filename="dataset_cleaned.xlsx" text="当前分析副本，原始文件不会被覆盖。" onClick={() => exportXlsx(rows)} />
        <ExportCard icon={History} title="修改记录" filename="cleaning_log.csv" text="每一步操作、字段和影响行数都可以追踪。" onClick={() => exportLog(logs)} />
        <ExportCard icon={Code2} title="可复现脚本" filename="cleaning_script.py" text="把已确认的 UI 操作转换成 pandas 代码。" onClick={() => exportPython(actions)} />
        <ExportCard icon={FileJson} title="清洗配方" filename="cleaning_recipe.json" text="保存机器可读规则，用于后续同结构数据。" onClick={() => exportRecipe(actions)} />
      </div>

      <section className="panel script-panel">
        <div className="panel-heading"><div><h2>Python Script Preview</h2><p>代码来自确定性的 Action 模板，不由模型临时“猜”出来。</p></div><Code2 size={19} /></div>
        <pre><code>{script}</code></pre>
      </section>
    </div>
  )
}

function ExportCard({ icon: Icon, title, filename, text, onClick }: { icon: typeof Download; title: string; filename: string; text: string; onClick: () => void }) {
  return <button className="export-card panel" onClick={onClick}><span className="export-icon"><Icon size={21} /></span><div><strong>{title}</strong><code>{filename}</code><p>{text}</p></div><Download size={17} className="export-download" /></button>
}

function PreviewModal({ preview, onClose, onExecute, allowExecute, onAddAndClose }: {
  preview: { actions: CleaningAction[]; changes: PreviewChange[] }
  onClose: () => void
  onExecute: () => void
  allowExecute: boolean
  onAddAndClose: () => void
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose() }}>
      <div className="modal">
        <div className="modal-head"><div><span className="page-kicker">PREVIEW</span><h2>修改预览</h2><p>{preview.actions.length} 项操作 · 最多展示前 40 个单元格变化</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="modal-actions-summary">{preview.actions.map((a) => <span key={a.id}><Check size={13} /> {a.label}</span>)}</div>
        <div className="diff-table-wrap">
          {preview.changes.length ? <table className="data-table diff-table"><thead><tr><th>行</th><th>字段</th><th>Before</th><th>After</th></tr></thead><tbody>{preview.changes.map((c, i) => <tr key={`${c.row}-${c.column}-${i}`}><td>{c.row}</td><td><code>{c.column}</code></td><td><span className="diff-before">{c.before}</span></td><td><span className="diff-after">{c.after}</span></td></tr>)}</tbody></table> : <div className="no-diff"><Info size={18} /><p>这组操作不会直接改写单元格，或当前预览中没有可展示的值变化。它仍可能产生日志记录。</p></div>}
        </div>
        <div className="modal-foot"><div className="privacy-note"><ShieldCheck size={15} /> 原始数据不会被覆盖，执行后仍可撤销。</div>{allowExecute ? <button className="btn btn-primary" onClick={onExecute}><Check size={16} /> 确认执行 {preview.actions.length} 项</button> : <button className="btn btn-primary" onClick={onAddAndClose}><ListChecks size={16} /> 加入清洗方案</button>}</div>
      </div>
    </div>
  )
}

function DatasetPreview({ rows }: { rows: DataRow[] }) {
  const cols = rows.length ? Object.keys(rows[0]) : []
  return <div className="table-scroll preview-table-wrap"><table className="data-table preview-table"><thead><tr><th>#</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}><td className="row-num">{i + 2}</td>{cols.map((c) => <td key={c}>{displayValue(row[c])}</td>)}</tr>)}</tbody></table></div>
}

function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Info; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state panel"><span><Icon size={24} /></span><h2>{title}</h2><p>{text}</p>{action}</div>
}

function typeLabel(kind: string) {
  return ({ id: 'ID', numeric: '数值', category: '类别', date: '日期', datetime: '日期时间', text: '文本', boolean: '布尔', percentage: '比例', currency: '金额', unknown: '待确认' } as Record<string, string>)[kind] ?? kind
}

export default App
