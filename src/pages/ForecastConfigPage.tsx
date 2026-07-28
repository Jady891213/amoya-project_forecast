import Decimal from 'decimal.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  CircleAlert,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { generatePeriods } from '../domain/periods'
import type {
  CalculationIssue,
  ForecastCategory,
  ForecastLineDraft,
  ForecastProjectState,
  Project,
  Department,
  ProjectInput,
  ProjectModule,
} from '../domain/types'
import type { DatabaseClient } from '../storage/types'
import { CalculationService } from '../services/calculationService'
import { formatWan } from '../ui/formatters'
import { ProjectInformationEditor } from '../ui/ProjectInformationEditor'

interface Props {
  database: DatabaseClient
  project: Project
  departments: Department[]
  modules: ProjectModule[]
  onProjectSave: (input: ProjectInput) => Promise<void>
  onCalculated: () => Promise<void>
}

const categoryLabels: Record<ForecastCategory, string> = {
  revenue: '收入',
  cost: '成本',
  cash_inflow: '收款',
  cash_outflow: '付款',
}

const categoryPlaceholders: Record<ForecastCategory, string> = {
  revenue: '例如：云游戏收入',
  cost: '例如：服务器租赁费',
  cash_inflow: '例如：项目回款',
  cash_outflow: '例如：供应商付款',
}

function toDrafts(state: ForecastProjectState): ForecastLineDraft[] {
  const valuesByLine = new Map<string, Record<string, string>>()
  state.values.forEach((value) => {
    const values = valuesByLine.get(value.lineId) ?? {}
    values[value.period] = value.value
    valuesByLine.set(value.lineId, values)
  })
  return state.lines.map((line) => ({
    id: line.id,
    code: line.code,
    name: line.name,
    category: line.category,
    businessModuleId: line.businessModuleId,
    forecastMethod: line.forecastMethod,
    startPeriod: line.startPeriod,
    endPeriod: line.endPeriod,
    fixedMonthlyValue: line.fixedMonthlyValue ?? '',
    assumption: line.assumption,
    sortOrder: line.sortOrder,
    monthlyValues: valuesByLine.get(line.id) ?? {},
  }))
}

function totalValue(
  draft: ForecastLineDraft,
  projectPeriods: string[],
): string {
  const start = projectPeriods.indexOf(draft.startPeriod)
  const end = projectPeriods.indexOf(draft.endPeriod)
  if (start < 0 || end < start) return '0'
  try {
    if (draft.forecastMethod === 'fixed_monthly') {
      if (!draft.fixedMonthlyValue?.trim()) return '0'
      return new Decimal(draft.fixedMonthlyValue)
        .times(end - start + 1)
        .toString()
    }
    return projectPeriods
      .slice(start, end + 1)
      .reduce((sum, period) => {
        const rawValue = draft.monthlyValues[period]?.trim()
        return rawValue ? sum.plus(rawValue) : sum
      }, new Decimal(0))
      .toString()
  } catch {
    return '0'
  }
}

function methodSummary(
  draft: ForecastLineDraft,
  projectPeriods: string[],
): string {
  if (draft.forecastMethod === 'fixed_monthly') {
    try {
      return draft.fixedMonthlyValue?.trim()
        ? `${formatWan(draft.fixedMonthlyValue)} 万元/月`
        : '未填写固定月金额'
    } catch {
      return '固定月金额格式错误'
    }
  }
  const start = projectPeriods.indexOf(draft.startPeriod)
  const end = projectPeriods.indexOf(draft.endPeriod)
  const active = start >= 0 && end >= start
    ? projectPeriods.slice(start, end + 1)
    : []
  const filled = active.filter(
    (period) => draft.monthlyValues[period]?.trim(),
  ).length
  return `${active.length}个月已填写 ${filled}个月`
}

export function ForecastConfigPage({
  database,
  project,
  departments,
  modules,
  onProjectSave,
  onCalculated,
}: Props) {
  const service = useMemo(() => new CalculationService(database), [database])
  const projectPeriods = useMemo(
    () => generatePeriods(project.startPeriod, project.durationMonths),
    [project.durationMonths, project.startPeriod],
  )
  const publicModule =
    modules.find((module) => module.isCommon) ?? modules[0]
  const [drafts, setDrafts] = useState<ForecastLineDraft[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<CalculationIssue[]>([])
  const [message, setMessage] = useState('')
  const [resultState, setResultState] = useState<ForecastProjectState>()

  const hydrate = useCallback((state: ForecastProjectState, selectedIndex = 0) => {
    const nextDrafts = toDrafts(state)
    setResultState(state)
    setDrafts(nextDrafts)
    setSelectedId(nextDrafts[selectedIndex]?.id ?? nextDrafts[0]?.id ?? '')
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const state = await service.getProjectState(project.id)
        if (!cancelled) hydrate(state)
      } catch (reason) {
        if (!cancelled) {
          setMessage(reason instanceof Error ? reason.message : '预测配置加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [hydrate, project.id, service])

  const selectedIndex = drafts.findIndex((draft) => draft.id === selectedId)
  const selected = selectedIndex >= 0 ? drafts[selectedIndex] : undefined

  function changeSelected(patch: Partial<ForecastLineDraft>) {
    if (selectedIndex < 0) return
    setDrafts((current) =>
      current.map((draft, index) =>
        index === selectedIndex ? { ...draft, ...patch } : draft,
      ),
    )
    setDirty(true)
    setIssues([])
    setMessage('')
  }

  function addLine(category: ForecastCategory) {
    if (!publicModule) {
      setMessage('当前项目缺少公共业务模块')
      return
    }
    const draft: ForecastLineDraft = {
      id: `draft-${crypto.randomUUID()}`,
      name: '',
      category,
      businessModuleId: publicModule.id,
      forecastMethod: 'fixed_monthly',
      startPeriod: projectPeriods[0],
      endPeriod: projectPeriods[projectPeriods.length - 1],
      fixedMonthlyValue: '',
      assumption: '',
      sortOrder: drafts.length + 1,
      monthlyValues: {},
    }
    setDrafts((current) => [...current, draft])
    setSelectedId(draft.id ?? '')
    setDirty(true)
    setIssues([])
  }

  function removeSelected() {
    if (selectedIndex < 0 || !selected) return
    if (!window.confirm(`确认删除行项目“${selected.name || '未命名行项目'}”？`)) {
      return
    }
    const next = drafts.filter((_, index) => index !== selectedIndex)
    setDrafts(next)
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? '')
    setDirty(true)
    setIssues([])
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex < 0) return
    const targetIndex = selectedIndex + direction
    if (targetIndex < 0 || targetIndex >= drafts.length) return
    const next = [...drafts]
    ;[next[selectedIndex], next[targetIndex]] = [
      next[targetIndex],
      next[selectedIndex],
    ]
    setDrafts(next.map((draft, index) => ({ ...draft, sortOrder: index + 1 })))
    setDirty(true)
  }

  async function saveDraftOnly() {
    setSaving(true)
    setIssues([])
    setMessage('')
    try {
      const selectedPosition = Math.max(selectedIndex, 0)
      const state = await service.saveDraft(project.id, drafts)
      hydrate(state, selectedPosition)
      setMessage('预测配置草稿已保存')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCalculate() {
    setSaving(true)
    setIssues([])
    setMessage('')
    try {
      const result = await service.saveAndCalculate(project.id, drafts)
      setIssues(result.issues)
      const state = await service.getProjectState(project.id)
      hydrate(state, Math.max(selectedIndex, 0))
      if (!result.success) {
        setMessage(`计算未通过：发现 ${result.run.issueCount} 个问题`)
        return
      }
      setMessage(
        `计算完成：批次 RUN-${String(result.run.runNumber).padStart(4, '0')}`,
      )
      await onCalculated()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '计算失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <section className="loading-card">正在读取预测配置…</section>
  }

  return (
    <div className="forecast-workspace">
      <ProjectInformationEditor
        project={project}
        departments={departments}
        modules={modules}
        onSave={onProjectSave}
      />
      <div className="forecast-toolbar">
        <div className="toolbar-title">
          <Calculator size={16} />
          <div>
            <b>预测配置</b>
            <span>维护损益与现金流行项目并生成分月计算结果</span>
          </div>
        </div>
        <div className="forecast-status">
          {dirty ? (
            <span className="status-warning"><CircleAlert size={13} />配置尚未保存</span>
          ) : resultState?.latestRun ? (
            <span className={resultState.isResultCurrent ? 'status-current' : 'status-warning'}>
              {resultState.isResultCurrent ? '结果与配置一致' : '结果需要重新计算'}
            </span>
          ) : (
            <span className="status-neutral">尚未计算</span>
          )}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => addLine('revenue')} disabled={saving}>
          <Plus size={14} />新增收入项
        </button>
        <button className="btn" onClick={() => addLine('cost')} disabled={saving}>
          <Plus size={14} />新增成本项
        </button>
        <button className="btn" onClick={() => addLine('cash_inflow')} disabled={saving}>
          <Plus size={14} />新增收款项
        </button>
        <button className="btn" onClick={() => addLine('cash_outflow')} disabled={saving}>
          <Plus size={14} />新增付款项
        </button>
        <button className="btn" onClick={() => void saveDraftOnly()} disabled={saving || !dirty}>
          <Save size={14} />保存草稿
        </button>
        <button className="btn primary" onClick={() => void saveAndCalculate()} disabled={saving}>
          <Calculator size={14} />保存并计算
        </button>
      </div>

      {(message || issues.length > 0) && (
        <div className={`forecast-message ${issues.some((issue) => issue.severity === 'error') ? 'error' : ''}`}>
          <span>{message}</span>
          {issues.slice(0, 3).map((issue, index) => (
            <span key={`${issue.lineId}-${issue.period}-${index}`}>
              {issue.severity === 'warning' ? '提示' : '错误'}：{issue.message}
            </span>
          ))}
          {issues.length > 3 && <span>另有 {issues.length - 3} 个问题</span>}
        </div>
      )}

      <div className={`forecast-editor ${selected ? 'panel-open' : ''}`}>
        <section className="forecast-table-panel">
          <table className="forecast-table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>分类</th>
                <th style={{ width: 190 }}>行项目名称</th>
                <th style={{ width: 130 }}>业务模块</th>
                <th style={{ width: 120 }}>预测方式</th>
                <th>主要配置</th>
                <th style={{ width: 145 }}>生效期间</th>
                <th style={{ width: 110 }}>预测合计</th>
                <th style={{ width: 90 }}>完整性</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const activeMonths =
                  projectPeriods.indexOf(draft.endPeriod) -
                  projectPeriods.indexOf(draft.startPeriod) +
                  1
                const filled =
                  draft.forecastMethod === 'fixed_monthly'
                    ? Boolean(draft.fixedMonthlyValue?.trim())
                    : projectPeriods
                        .filter(
                          (period) =>
                            period >= draft.startPeriod &&
                            period <= draft.endPeriod,
                        )
                        .filter((period) => draft.monthlyValues[period]?.trim())
                        .length
                return (
                  <tr
                    key={draft.id}
                    className={draft.id === selectedId ? 'selected' : ''}
                    onClick={() => setSelectedId(draft.id ?? '')}
                  >
                    <td><span className={`forecast-category ${draft.category}`}>{categoryLabels[draft.category]}</span></td>
                    <td><strong>{draft.name || '未命名行项目'}</strong><small>{draft.code || '保存后生成编码'}</small></td>
                    <td>{modules.find((module) => module.id === draft.businessModuleId)?.name ?? '—'}</td>
                    <td>{draft.forecastMethod === 'fixed_monthly' ? '固定月金额' : '逐月填写'}</td>
                    <td>{methodSummary(draft, projectPeriods)}</td>
                    <td>{draft.startPeriod}—{draft.endPeriod}</td>
                    <td className="number-cell">{formatWan(totalValue(draft, projectPeriods))}</td>
                    <td>
                      <span className={filled ? 'complete-mark' : 'incomplete-mark'}>
                        {draft.forecastMethod === 'monthly_input'
                          ? `${filled}/${Math.max(activeMonths, 0)}个月`
                          : filled ? '已填写' : '待填写'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {drafts.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    当前还没有预测行项目，请新增损益或现金流项目
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {selected && (
          <aside className="forecast-side-panel">
            <div className="forecast-panel-head">
              <div><b>行项目配置</b><span>{selected.code || '尚未保存'}</span></div>
              <button className="icon-button" aria-label="关闭配置面板" onClick={() => setSelectedId('')}><X size={16} /></button>
            </div>
            <div className="forecast-panel-body">
              <label>行项目名称
                <input
                  value={selected.name}
                  onChange={(event) => changeSelected({ name: event.target.value })}
                  placeholder={categoryPlaceholders[selected.category]}
                />
              </label>
              <div className="forecast-form-row">
                <label>系统分类
                  <select
                    value={selected.category}
                    onChange={(event) =>
                      changeSelected({ category: event.target.value as ForecastCategory })
                    }
                  >
                    <option value="revenue">收入</option>
                    <option value="cost">成本</option>
                    <option value="cash_inflow">收款</option>
                    <option value="cash_outflow">付款</option>
                  </select>
                </label>
                <label>业务模块
                  <select
                    value={selected.businessModuleId}
                    onChange={(event) => changeSelected({ businessModuleId: event.target.value })}
                  >
                    {modules.map((module) => <option value={module.id} key={module.id}>{module.name}</option>)}
                  </select>
                </label>
              </div>
              <label>预测方式
                <select
                  value={selected.forecastMethod}
                  onChange={(event) =>
                    changeSelected({
                      forecastMethod: event.target.value as ForecastLineDraft['forecastMethod'],
                    })
                  }
                >
                  <option value="fixed_monthly">固定月金额</option>
                  <option value="monthly_input">逐月填写</option>
                </select>
              </label>
              <div className="forecast-form-row">
                <label>开始期间
                  <select value={selected.startPeriod} onChange={(event) => changeSelected({ startPeriod: event.target.value })}>
                    {projectPeriods.map((period) => <option key={period}>{period}</option>)}
                  </select>
                </label>
                <label>结束期间
                  <select value={selected.endPeriod} onChange={(event) => changeSelected({ endPeriod: event.target.value })}>
                    {projectPeriods.map((period) => <option key={period}>{period}</option>)}
                  </select>
                </label>
              </div>
              {selected.forecastMethod === 'fixed_monthly' ? (
                <label>每月金额（元）
                  <input
                    type="number"
                    step="any"
                    value={selected.fixedMonthlyValue ?? ''}
                    onChange={(event) => changeSelected({ fixedMonthlyValue: event.target.value })}
                    placeholder="例如：200000"
                  />
                  <small>周期合计：{formatWan(totalValue(selected, projectPeriods))} 万元</small>
                </label>
              ) : (
                <div className="monthly-input-section">
                  <div className="monthly-input-head">
                    <b>逐月金额（元）</b>
                    <span>空白月份按0计算</span>
                  </div>
                  <div className="monthly-value-list">
                    {projectPeriods
                      .filter(
                        (period) =>
                          period >= selected.startPeriod &&
                          period <= selected.endPeriod,
                      )
                      .map((period) => (
                        <label key={period}>
                          <span>{period}</span>
                          <input
                            type="number"
                            step="any"
                            value={selected.monthlyValues[period] ?? ''}
                            placeholder="0"
                            onChange={(event) =>
                              changeSelected({
                                monthlyValues: {
                                  ...selected.monthlyValues,
                                  [period]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                  </div>
                </div>
              )}
              <label>假设说明
                <textarea
                  rows={4}
                  value={selected.assumption}
                  onChange={(event) => changeSelected({ assumption: event.target.value })}
                  placeholder="填写金额来源、业务假设或复核说明"
                />
              </label>
            </div>
            <div className="forecast-panel-actions">
              <div>
                <button className="icon-button" aria-label="上移行项目" title="上移" disabled={selectedIndex <= 0} onClick={() => moveSelected(-1)}><ArrowUp size={15} /></button>
                <button className="icon-button" aria-label="下移行项目" title="下移" disabled={selectedIndex >= drafts.length - 1} onClick={() => moveSelected(1)}><ArrowDown size={15} /></button>
              </div>
              <button className="btn danger" onClick={removeSelected}><Trash2 size={14} />删除行项目</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
