import Decimal from 'decimal.js'

export type FormulaReferenceType = 'parameter' | 'line'

export interface FormulaReference {
  type: FormulaReferenceType
  code: string
}

export type FormulaNode =
  | { type: 'number'; value: string }
  | { type: 'reference'; reference: FormulaReference }
  | { type: 'unary'; operator: '-'; operand: FormulaNode }
  | {
      type: 'binary'
      operator: '+' | '-' | '*' | '/'
      left: FormulaNode
      right: FormulaNode
    }

export interface ParsedFormula {
  ast: FormulaNode
  references: FormulaReference[]
}

interface Token {
  type:
    | 'number'
    | 'identifier'
    | 'string'
    | 'operator'
    | 'leftParen'
    | 'rightParen'
    | 'eof'
  value: string
  position: number
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const character = expression[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '(') {
      tokens.push({ type: 'leftParen', value: character, position: index++ })
      continue
    }
    if (character === ')') {
      tokens.push({ type: 'rightParen', value: character, position: index++ })
      continue
    }
    if ('+-*/×÷'.includes(character)) {
      tokens.push({
        type: 'operator',
        value: character === '×' ? '*' : character === '÷' ? '/' : character,
        position: index++,
      })
      continue
    }
    if (character === '"') {
      const start = index
      index += 1
      let value = ''
      while (index < expression.length && expression[index] !== '"') {
        value += expression[index]
        index += 1
      }
      if (expression[index] !== '"') {
        throw new Error(`公式第 ${start + 1} 个字符后的引用编码缺少结束引号`)
      }
      index += 1
      tokens.push({ type: 'string', value, position: start })
      continue
    }
    if (/[0-9.]/.test(character)) {
      const start = index
      let value = ''
      while (index < expression.length && /[0-9.]/.test(expression[index])) {
        value += expression[index]
        index += 1
      }
      if ((value.match(/\./g) ?? []).length > 1 || value === '.') {
        throw new Error(`公式第 ${start + 1} 个字符附近的数字格式错误`)
      }
      if (expression[index] === '%') {
        value = new Decimal(value).div(100).toString()
        index += 1
      }
      tokens.push({ type: 'number', value, position: start })
      continue
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index
      let value = ''
      while (
        index < expression.length &&
        /[A-Za-z0-9_-]/.test(expression[index])
      ) {
        value += expression[index]
        index += 1
      }
      tokens.push({
        type: 'identifier',
        value: value.toUpperCase(),
        position: start,
      })
      continue
    }
    throw new Error(`公式第 ${index + 1} 个字符“${character}”无法识别`)
  }
  tokens.push({ type: 'eof', value: '', position: expression.length })
  return tokens
}

class Parser {
  private index = 0
  private readonly references = new Map<string, FormulaReference>()

  constructor(private readonly tokens: Token[]) {}

  parse(): ParsedFormula {
    const ast = this.parseExpression()
    if (this.current().type !== 'eof') {
      throw new Error(`公式第 ${this.current().position + 1} 个字符附近存在多余内容`)
    }
    return { ast, references: Array.from(this.references.values()) }
  }

  private current(): Token {
    return this.tokens[this.index]
  }

  private consume(type?: Token['type']): Token {
    const token = this.current()
    if (type && token.type !== type) {
      throw new Error(`公式第 ${token.position + 1} 个字符附近格式错误`)
    }
    this.index += 1
    return token
  }

  private parseExpression(): FormulaNode {
    let node = this.parseTerm()
    while (
      this.current().type === 'operator' &&
      ['+', '-'].includes(this.current().value)
    ) {
      const operator = this.consume('operator').value as '+' | '-'
      node = {
        type: 'binary',
        operator,
        left: node,
        right: this.parseTerm(),
      }
    }
    return node
  }

  private parseTerm(): FormulaNode {
    let node = this.parseUnary()
    while (
      this.current().type === 'operator' &&
      ['*', '/'].includes(this.current().value)
    ) {
      const operator = this.consume('operator').value as '*' | '/'
      node = {
        type: 'binary',
        operator,
        left: node,
        right: this.parseUnary(),
      }
    }
    return node
  }

  private parseUnary(): FormulaNode {
    if (
      this.current().type === 'operator' &&
      this.current().value === '-'
    ) {
      this.consume('operator')
      return {
        type: 'unary',
        operator: '-',
        operand: this.parseUnary(),
      }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): FormulaNode {
    const token = this.current()
    if (token.type === 'number') {
      this.consume('number')
      return { type: 'number', value: token.value }
    }
    if (token.type === 'leftParen') {
      this.consume('leftParen')
      const node = this.parseExpression()
      this.consume('rightParen')
      return node
    }
    if (token.type === 'identifier') {
      return this.parseReference()
    }
    throw new Error(`公式第 ${token.position + 1} 个字符附近缺少数字或引用`)
  }

  private parseReference(): FormulaNode {
    const identifier = this.consume('identifier')
    if (!['PARAM', 'LINE'].includes(identifier.value)) {
      throw new Error(`公式不支持“${identifier.value}”函数`)
    }
    this.consume('leftParen')
    const code = this.consume('string').value.trim().toUpperCase()
    this.consume('rightParen')
    if (!code) throw new Error('公式引用编码不能为空')
    const reference: FormulaReference = {
      type: identifier.value === 'PARAM' ? 'parameter' : 'line',
      code,
    }
    this.references.set(`${reference.type}:${reference.code}`, reference)
    return { type: 'reference', reference }
  }
}

export function parseFormula(expression: string): ParsedFormula {
  if (!expression.trim()) throw new Error('公式不能为空')
  return new Parser(tokenize(expression)).parse()
}

export function evaluateFormula(
  parsed: ParsedFormula,
  resolve: (reference: FormulaReference) => Decimal | undefined,
): Decimal {
  function evaluate(node: FormulaNode): Decimal {
    if (node.type === 'number') return new Decimal(node.value)
    if (node.type === 'reference') {
      const value = resolve(node.reference)
      if (!value) {
        throw new Error(
          `${node.reference.type === 'parameter' ? '参数' : '行项目'}“${node.reference.code}”没有可用值`,
        )
      }
      return value
    }
    if (node.type === 'unary') return evaluate(node.operand).negated()
    const left = evaluate(node.left)
    const right = evaluate(node.right)
    if (node.operator === '+') return left.plus(right)
    if (node.operator === '-') return left.minus(right)
    if (node.operator === '*') return left.times(right)
    if (right.isZero()) throw new Error('公式发生除零')
    return left.div(right)
  }
  return evaluate(parsed.ast)
}

export function humanizeFormula(
  expression: string,
  parameterNames: Map<string, string>,
  lineNames: Map<string, string>,
): string {
  return expression
    .replace(
      /PARAM\(\s*"([^"]+)"\s*\)/gi,
      (_, code: string) => parameterNames.get(code.toUpperCase()) ?? code,
    )
    .replace(
      /LINE\(\s*"([^"]+)"\s*\)/gi,
      (_, code: string) => lineNames.get(code.toUpperCase()) ?? code,
    )
    .replaceAll('*', ' × ')
    .replaceAll('/', ' ÷ ')
    .replace(/\s+/g, ' ')
    .trim()
}
