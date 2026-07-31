import type { ForecastLine } from '../domain/types'
import { parseFormula } from './formulaEngine'

export interface FormulaDependencyResult {
  orderedLines: ForecastLine[]
  dependencies: Map<string, string[]>
  errors: Map<string, string>
}

export function resolveFormulaDependencies(
  lines: ForecastLine[],
): FormulaDependencyResult {
  const formulaLines = lines.filter((line) => line.forecastMethod === 'formula')
  const lineByCode = new Map(lines.map((line) => [line.code, line]))
  const formulaByCode = new Map(formulaLines.map((line) => [line.code, line]))
  const dependencies = new Map<string, string[]>()
  const errors = new Map<string, string>()

  formulaLines.forEach((line) => {
    try {
      const parsed = parseFormula(line.formulaExpression ?? '')
      const lineReferences = parsed.references
        .filter((reference) => reference.type === 'line')
        .map((reference) => reference.code)
      const missing = lineReferences.find((code) => !lineByCode.has(code))
      if (missing) {
        errors.set(line.id, `引用的行项目“${missing}”不存在`)
        return
      }
      dependencies.set(
        line.code,
        lineReferences.filter((code) => formulaByCode.has(code)),
      )
    } catch (reason) {
      errors.set(
        line.id,
        reason instanceof Error ? reason.message : '公式格式错误',
      )
    }
  })

  const orderedLines: ForecastLine[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(code: string, path: string[]) {
    if (visited.has(code)) return
    if (visiting.has(code)) {
      const cycleStart = path.indexOf(code)
      const cycle = [...path.slice(cycleStart), code].join(' → ')
      path.forEach((pathCode) => {
        const line = formulaByCode.get(pathCode)
        if (line) errors.set(line.id, `公式存在循环引用：${cycle}`)
      })
      return
    }
    visiting.add(code)
    const nextPath = [...path, code]
    ;(dependencies.get(code) ?? []).forEach((dependency) =>
      visit(dependency, nextPath),
    )
    visiting.delete(code)
    visited.add(code)
    const line = formulaByCode.get(code)
    if (line && !errors.has(line.id)) orderedLines.push(line)
  }

  formulaLines.forEach((line) => visit(line.code, []))
  return { orderedLines, dependencies, errors }
}
