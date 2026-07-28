import Decimal from 'decimal.js'
import { generatePeriods } from '../domain/periods'
import type {
  ForecastCategory,
  ForecastLineDraft,
} from '../domain/types'

interface HistoricalProjectConfig {
  projectId: string
  lines: ForecastLineDraft[]
  sourceWorkbook: string
  sourceSheets: string[]
}

function yuanFromWan(value: Decimal.Value): string {
  return new Decimal(value).times(10_000).toDecimalPlaces(6).toString()
}

function monthlyValues(
  periods: string[],
  valuesInWan: Decimal.Value[],
): Record<string, string> {
  return Object.fromEntries(
    periods.map((period, index) => [
      period,
      yuanFromWan(valuesInWan[index] ?? 0),
    ]),
  )
}

function fixedLine(
  projectId: string,
  sequence: number,
  name: string,
  category: ForecastCategory,
  moduleId: string,
  startPeriod: string,
  endPeriod: string,
  monthlyAmountInWan: Decimal.Value,
  assumption: string,
): ForecastLineDraft {
  return {
    id: `historical-line:${projectId}:${sequence}`,
    code: `LINE-${String(sequence).padStart(3, '0')}`,
    name,
    category,
    businessModuleId: moduleId,
    forecastMethod: 'fixed_monthly',
    startPeriod,
    endPeriod,
    fixedMonthlyValue: yuanFromWan(monthlyAmountInWan),
    assumption,
    sortOrder: sequence,
    monthlyValues: {},
  }
}

function monthlyLine(
  projectId: string,
  sequence: number,
  name: string,
  category: ForecastCategory,
  moduleId: string,
  periods: string[],
  valuesInWan: Decimal.Value[],
  assumption: string,
): ForecastLineDraft {
  return {
    id: `historical-line:${projectId}:${sequence}`,
    code: `LINE-${String(sequence).padStart(3, '0')}`,
    name,
    category,
    businessModuleId: moduleId,
    forecastMethod: 'monthly_input',
    startPeriod: periods[0],
    endPeriod: periods[periods.length - 1],
    assumption,
    sortOrder: sequence,
    monthlyValues: monthlyValues(periods, valuesInWan),
  }
}

function hebeiCable(): HistoricalProjectConfig {
  const projectId = 'project-hebei-cable-iptv'
  const moduleId = 'module-hebei-cable-iptv-iptv'
  const start = '2026-08'
  const end = '2026-12'
  const monthlyRevenue = new Decimal(24).times(2642).div(1.06).div(10_000)
  const wechatFee = monthlyRevenue.times(0.01)
  const channelShare = monthlyRevenue.minus(wechatFee).times(0.3)
  const cdn = new Decimal(1.34).times(2642).div(1.06).div(10_000)
  return {
    projectId,
    sourceWorkbook: '河北有线互联网电视项目测算20260721.xlsx',
    sourceSheets: ['总表', 'CDN明细'],
    lines: [
      fixedLine(
        projectId, 1, '互联网电视会员收入', 'revenue', moduleId, start, end,
        monthlyRevenue,
        '24元/月 × 2,642户 ÷ 1.06；来源：总表第16行。',
      ),
      fixedLine(
        projectId, 2, '微信支付手续费', 'cost', moduleId, start, end,
        wechatFee,
        '不含税收入的1%；来源：总表第18行。',
      ),
      fixedLine(
        projectId, 3, '河北有线收入分成', 'cost', moduleId, start, end,
        channelShare,
        '扣除微信手续费后的收入 × 30%；来源：总表第19行。',
      ),
      fixedLine(
        projectId, 4, '当贝收入分成', 'cost', moduleId, start, end,
        channelShare,
        '扣除微信手续费后的收入 × 30%；来源：总表第20行。',
      ),
      fixedLine(
        projectId, 5, 'CDN成本', 'cost', moduleId, start, end,
        cdn,
        '1.34元/户/月 × 2,642户 ÷ 1.06；来源：总表第21行和CDN明细。',
      ),
    ],
  }
}

function chongqingMobile(): HistoricalProjectConfig {
  const projectId = 'project-chongqing-mobile-screen'
  const moduleId = 'module-chongqing-mobile-screen-medium_screen'
  const periods = generatePeriods('2026-07', 12)
  const registeredUsers = [
    0.41, 0.82, 1.23, 1.64, 2.06, 2.48,
    2.9, 3.32, 3.74, 4.16, 4.58, 5,
  ]
  const revenue = registeredUsers.map((users) =>
    new Decimal(users).times(6.5).div(1.06),
  )
  return {
    projectId,
    sourceWorkbook: '重庆移动中屏0717.xlsx',
    sourceSheets: ['总表'],
    lines: [
      monthlyLine(
        projectId, 1, '中屏业务收入', 'revenue', moduleId, periods, revenue,
        '注册用户 × 6.5元 ÷ 1.06；注册用户逐月取自总表第26行。',
      ),
      fixedLine(
        projectId, 2, '爱奇艺APK成本', 'cost', moduleId, periods[0], periods[11],
        new Decimal(87.8).div(12),
        '源表只给出年度87.8万元，按12个月均匀展开。',
      ),
      fixedLine(
        projectId, 3, '专线成本', 'cost', moduleId, periods[0], periods[11],
        new Decimal(56.6).div(12),
        '源表年度56.6万元，按12个月均匀展开。',
      ),
      fixedLine(
        projectId, 4, '服务器成本', 'cost', moduleId, periods[0], periods[11],
        new Decimal(3.89).div(12),
        '源表年度3.89万元，按12个月均匀展开。',
      ),
      fixedLine(
        projectId, 5, '频道成本', 'cost', moduleId, periods[0], periods[11],
        new Decimal(19.4).div(12),
        '源表年度19.4万元，按12个月均匀展开。',
      ),
      fixedLine(
        projectId, 6, 'FAST云成本', 'cost', moduleId, periods[0], periods[11],
        new Decimal(8.56).div(12),
        '源表年度8.56万元，按12个月均匀展开。',
      ),
    ],
  }
}

function hebeiUnicom(): HistoricalProjectConfig {
  const projectId = 'project-hebei-unicom-cloud'
  const cloudModule = 'module-hebei-unicom-cloud-cloud_game'
  const ultraModule = 'module-hebei-unicom-cloud-ultra_hd'
  const periods = generatePeriods('2026-08', 20)
  const profitPeriods = periods.slice(0, 17)
  const server = [
    3.253529, 3.246333, 3.239122, 3.231896, 3.224653, 3.217395,
    3.210122, 3.202832, 3.195527, 3.188206, 3.18087, 3.173517,
    3.166149, 3.158764, 3.151364, 3.143948, 3.136182,
  ]
  const totalCloudCost = [
    11.8944423200623, 11.8872463200623, 10.075058904968,
    10.067832904968, 10.060589904968, 10.053331904968,
    10.046058904968, 10.038768904968, 10.031463904968,
    10.024142904968, 10.016806904968, 10.009453904968,
    10.002085904968, 9.99470090496798, 9.98730090496798,
    9.97988490496798, 9.97211890496798,
  ]
  const tech = new Decimal(0.566037735849057)
  const idc = new Decimal(1.88679245283019)
  const line100m = new Decimal(0.275229357798165)
  const cpShare = totalCloudCost.map((total, index) =>
    new Decimal(total)
      .minus(server[index])
      .minus(tech)
      .minus(idc)
      .minus(line100m),
  )
  const cashReceipts = periods.map((_, index) => index < 3 ? 0 : 25)
  const cashPayments = [
    11.5, 4.505, 17.04025, 4.505, 18.305, 17.56805, 4.505,
    4.505, 17.56805, 4.505, 18.305, 17.56805, 4.505, 4.505,
    17.56805, 4.505, 4.505, 17.56805, 0, 0,
  ]
  return {
    projectId,
    sourceWorkbook: '河北联通云游戏+超高清项目测算20260707.xlsx',
    sourceSheets: ['总表', '云游戏分月测算明细'],
    lines: [
      fixedLine(
        projectId, 1, '云游戏收入', 'revenue', cloudModule,
        profitPeriods[0], profitPeriods[16], new Decimal(20).div(1.06),
        '20万元/月（含税）÷1.06；来源：总表和云游戏分月测算明细。',
      ),
      fixedLine(
        projectId, 2, '超高清收入', 'revenue', ultraModule,
        profitPeriods[0], profitPeriods[16], new Decimal(5).div(1.06),
        '5万元/月（含税）÷1.06；来源：总表。',
      ),
      monthlyLine(
        projectId, 3, '服务器租赁（利息费用+折旧）', 'cost',
        cloudModule, profitPeriods, server,
        '逐月取自云游戏分月测算明细第5行。',
      ),
      fixedLine(
        projectId, 4, '云游戏技术服务费', 'cost', cloudModule,
        profitPeriods[0], profitPeriods[16], tech,
        '7.2万元/年 ÷ 12 ÷ 1.06。',
      ),
      fixedLine(
        projectId, 5, 'IDC机柜租赁费', 'cost', cloudModule,
        profitPeriods[0], profitPeriods[16], idc,
        '2万元/月（含税）÷1.06。',
      ),
      fixedLine(
        projectId, 6, '100M专线费', 'cost', cloudModule,
        profitPeriods[0], profitPeriods[16], line100m,
        '0.3万元/月（含税）÷1.09。',
      ),
      monthlyLine(
        projectId, 7, '游戏CP分成（包盘收入口径）', 'cost',
        cloudModule, profitPeriods, cpShare,
        '按源表基准口径逐月回放；5000用户保底口径留待多场景阶段。',
      ),
      monthlyLine(
        projectId, 8, '项目收款', 'cash_inflow',
        'module-hebei-unicom-cloud-public', periods, cashReceipts,
        '含税现金流，前三个月账期无回款，其后17个月每月25万元。',
      ),
      monthlyLine(
        projectId, 9, '项目付款', 'cash_outflow',
        'module-hebei-unicom-cloud-public', periods, cashPayments,
        '逐月取自包盘收入场景现金流“付款”行。',
      ),
    ],
  }
}

function bestvCtv(): HistoricalProjectConfig {
  const projectId = 'project-bestv-ctv-ad'
  const moduleId = 'module-bestv-ctv-ad-programmatic_ad'
  const periods = generatePeriods('2026-07', 36)
  const advertisingCash = [
    0, 0, 0, 16.9811320754717, 33.9622641509434, 67.9245283018868,
    90.5660377358491, 113.207547169811, 130.188679245283,
    147.169811320755, 164.150943396226, 181.132075471698,
    280.188679245283, 288.679245283019, 297.169811320755,
    305.660377358491, 314.150943396226, 322.641509433962,
    331.132075471698, 339.622641509434, 348.11320754717,
    356.603773584906, 365.094339622641, 373.584905660377,
    543.396226415094, 701.88679245283, 860.377358490566,
    1018.8679245283, 1245.28301886792, 1471.69811320755,
    1698.11320754717, 1924.52830188679, 2150.94339622642,
    2377.35849056604, 2716.98113207547, 3421.1320754717,
  ]
  const innovationFunding = periods.map((_, index) =>
    index === 0 ? 1000 : index === 12 ? 1500 : index === 24 ? 1000 : 0,
  )
  const cashInflows = advertisingCash.map((value, index) =>
    new Decimal(value).plus(innovationFunding[index]),
  )
  const cashOutflows = [
    58.8839218740984, 58.8839218740984, 60.6527897986267,
    73.4876954590041, 88.0914690439097, 117.299016213721,
    137.100607293289, 156.572305406497, 173.53456955744,
    208.071519242975, 222.675292827881, 237.279066412786,
    331.34279975189, 338.72959220472, 346.11638465755,
    353.50317711038, 360.88996956321, 368.276762016041,
    375.663554468871, 383.050346921701, 390.437139374531,
    448.963868934279, 451.044057613525, 458.430850066355,
    688.648188938896, 784.082151203047, 921.968943655877,
    1059.85573610871, 1256.83686818418, 1524.57271724078,
    1650.79913233512, 1847.78026441059, 2044.76139648607,
    2308.29724554267, 2596.76422667474, 3237.67743422191,
  ]
  const netRevenue = advertisingCash.map((value) =>
    new Decimal(value).times(0.2),
  )
  const annualCosts = [
    836.781456125584,
    1471.92808647979,
    3840.83364019041,
  ]
  const monthlyCosts = annualCosts.flatMap((annual) =>
    Array.from({ length: 12 }, () => new Decimal(annual).div(12)),
  )
  return {
    projectId,
    sourceWorkbook: '百视通CTV程序化广告能力建设项目财务数据预估-20260520提交版.xlsx',
    sourceSheets: ['项目预算表', '月度资金计划'],
    lines: [
      monthlyLine(
        projectId, 1, '程序化广告平台净收入', 'revenue',
        moduleId, periods, netRevenue,
        '月度广告流水 × 20%平台交易佣金；月度流水来自月度资金计划。',
      ),
      monthlyLine(
        projectId, 2, '总成本费用', 'cost',
        moduleId, periods, monthlyCosts,
        '按项目预算表三年年度总成本平均展开到各年度月份；不替代源表上游驱动模型。',
      ),
      monthlyLine(
        projectId, 3, '月度资金流入', 'cash_inflow',
        moduleId, periods, cashInflows,
        '逐月取自月度资金计划“现金流入”口径（广告流入为不含税口径）。',
      ),
      monthlyLine(
        projectId, 4, '月度资金流出', 'cash_outflow',
        moduleId, periods, cashOutflows,
        '逐月取自月度资金计划“现金流出”行。',
      ),
    ],
  }
}

export const HISTORICAL_PROJECT_CONFIGS: HistoricalProjectConfig[] = [
  hebeiUnicom(),
  chongqingMobile(),
  hebeiCable(),
  bestvCtv(),
]

