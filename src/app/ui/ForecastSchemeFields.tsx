import type { ForecastCalculationConfig, ForecastLineDraft, ProjectParameterDraft } from '../../shared/domain/types'

export type ForecastScheme =
  | 'fixed_monthly'
  | 'monthly_input'
  | 'price_quantity'
  | 'revenue_ratio'
  | 'custom_formula'

const priceQuantityPattern = /^\s*PARAM\(\s*"([^"]+)"\s*\)\s*\*\s*PARAM\(\s*"([^"]+)"\s*\)\s*$/i
const revenueRatioPattern = /^\s*LINE\(\s*"([^"]+)"\s*\)\s*\*\s*PARAM\(\s*"([^"]+)"\s*\)\s*$/i
const literalPriceQuantityPattern = /^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*\*\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/
const literalRevenueRatioPattern = /^\s*LINE\(\s*"([^"]+)"\s*\)\s*\*\s*\(?\s*(-?[0-9]+(?:\.[0-9]+)?)%\s*\)?\s*$/i

export function forecastScheme(line: ForecastLineDraft): ForecastScheme {
  if (line.forecastMethod !== 'formula') return line.forecastMethod
  if (line.calculationPreset === 'price_quantity') return 'price_quantity'
  if (line.calculationPreset === 'revenue_ratio') return 'revenue_ratio'
  if (line.calculationPreset === 'custom_formula') return 'custom_formula'
  if (literalPriceQuantityPattern.test(line.formulaExpression ?? '')) return 'price_quantity'
  if (line.category === 'cost' && literalRevenueRatioPattern.test(line.formulaExpression ?? '')) return 'revenue_ratio'
  if (priceQuantityPattern.test(line.formulaExpression ?? '')) return 'price_quantity'
  if (line.category === 'cost' && revenueRatioPattern.test(line.formulaExpression ?? '')) return 'revenue_ratio'
  return 'custom_formula'
}

export function forecastSchemeLabel(line: ForecastLineDraft) {
  const scheme = forecastScheme(line)
  if (scheme === 'fixed_monthly') return '固定月金额'
  if (scheme === 'monthly_input') return '逐月填写'
  if (scheme === 'price_quantity') return '单价 × 数量'
  if (scheme === 'revenue_ratio') return '按收入比例'
  return '自定义公式'
}

function inferredConfig(line: ForecastLineDraft): ForecastCalculationConfig {
  if (line.calculationConfig) return line.calculationConfig
  const priceQuantity = priceQuantityPattern.exec(line.formulaExpression ?? '')
  if (priceQuantity) return {
    priceParameterCode: priceQuantity[1],
    quantityParameterCode: priceQuantity[2],
  }
  const revenueRatio = revenueRatioPattern.exec(line.formulaExpression ?? '')
  if (revenueRatio) return {
    revenueLineCode: revenueRatio[1],
    ratioParameterCode: revenueRatio[2],
  }
  const literalPriceQuantity = literalPriceQuantityPattern.exec(line.formulaExpression ?? '')
  if (literalPriceQuantity) return {
    priceValue: literalPriceQuantity[1],
    quantityValue: literalPriceQuantity[2],
  }
  const literalRevenueRatio = literalRevenueRatioPattern.exec(line.formulaExpression ?? '')
  if (literalRevenueRatio) return {
    revenueLineCode: literalRevenueRatio[1],
    ratioValue: literalRevenueRatio[2],
  }
  return {}
}

function expressionFor(scheme: ForecastScheme, config: ForecastCalculationConfig) {
  if (scheme === 'price_quantity' && config.priceValue?.trim() && config.quantityValue?.trim()) {
    return `${config.priceValue.trim()} * ${config.quantityValue.trim()}`
  }
  if (scheme === 'revenue_ratio' && config.revenueLineCode && config.ratioValue?.trim()) {
    return `LINE("${config.revenueLineCode}") * ${config.ratioValue.trim()}%`
  }
  return ''
}

export function patchForForecastScheme(
  line: ForecastLineDraft,
  scheme: ForecastScheme,
  _parameters: ProjectParameterDraft[],
  lines: ForecastLineDraft[],
): Partial<ForecastLineDraft> {
  if (scheme === 'fixed_monthly' || scheme === 'monthly_input') {
    return {
      forecastMethod: scheme,
      calculationPreset: undefined,
      calculationConfig: undefined,
      formulaExpression: '',
    }
  }
  if (scheme === 'custom_formula') {
    return {
      forecastMethod: 'formula',
      calculationPreset: 'custom_formula',
      calculationConfig: undefined,
    }
  }
  const previous = forecastScheme(line) === scheme ? inferredConfig(line) : {}
  const config: ForecastCalculationConfig = scheme === 'price_quantity'
    ? {
        priceValue: previous.priceValue ?? '',
        quantityValue: previous.quantityValue ?? '',
      }
    : {
        revenueLineCode: previous.revenueLineCode
          ?? lines.find((item) => item.id !== line.id && item.category === 'revenue')?.code,
        ratioValue: previous.ratioValue ?? '',
      }
  return {
    forecastMethod: 'formula',
    calculationPreset: scheme,
    calculationConfig: config,
    formulaExpression: expressionFor(scheme, config),
  }
}

export function ForecastSchemeFields({ line, parameters: _parameters, lines, onPatch }: {
  line: ForecastLineDraft
  parameters: ProjectParameterDraft[]
  lines: ForecastLineDraft[]
  onPatch: (patch: Partial<ForecastLineDraft>) => void
}) {
  const scheme = forecastScheme(line)
  if (scheme !== 'price_quantity' && scheme !== 'revenue_ratio') return null
  const config = inferredConfig(line)
  const patchConfig = (next: ForecastCalculationConfig) => onPatch({
    forecastMethod: 'formula',
    calculationPreset: scheme,
    calculationConfig: next,
    formulaExpression: expressionFor(scheme, next),
  })

  if (scheme === 'price_quantity') {
    return <div className="forecast-preset-card full-field">
      <div className="forecast-preset-title"><b>单价 × 数量</b><span>直接填写常用测算条件，无需另建业务参数</span></div>
      <div className="forecast-preset-fields">
        <label>单价（元）<input type="number" step="any" value={config.priceValue ?? ''} placeholder="例如：24" onChange={(event) => patchConfig({ ...config, priceValue: event.target.value })} /></label>
        <span className="forecast-preset-operator">×</span>
        <label>数量<input type="number" step="any" value={config.quantityValue ?? ''} placeholder="例如：2642" onChange={(event) => patchConfig({ ...config, quantityValue: event.target.value })} /></label>
      </div>
      <small>在生效期间内，每月金额均按“单价 × 数量”计算。</small>
    </div>
  }

  const revenues = lines.filter((item) => item.id !== line.id && item.category === 'revenue')
  return <div className="forecast-preset-card full-field">
    <div className="forecast-preset-title"><b>按收入比例</b><span>选择收入并直接填写比例，成本按月联动</span></div>
    <div className="forecast-preset-fields">
      <label>收入基数<select value={config.revenueLineCode ?? ''} onChange={(event) => patchConfig({ ...config, revenueLineCode: event.target.value || undefined })}><option value="">请选择收入项目</option>{revenues.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <span className="forecast-preset-operator">×</span>
      <label>比例（%）<input type="number" step="any" value={config.ratioValue ?? ''} placeholder="例如：30" onChange={(event) => patchConfig({ ...config, ratioValue: event.target.value })} /></label>
    </div>
    {!revenues.length && <small>请先新增一条收入预测项。</small>}
  </div>
}
