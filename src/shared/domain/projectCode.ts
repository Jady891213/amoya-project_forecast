export function nextProjectCode(codes: Array<string | undefined>, year = new Date().getFullYear()): string {
  const prefix = `PRJ-${year}-`
  const maxNumber = codes.reduce((maximum, code) => {
    if (!code?.startsWith(prefix)) return maximum
    const suffix = code.slice(prefix.length)
    return /^\d+$/.test(suffix) ? Math.max(maximum, Number(suffix)) : maximum
  }, 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}
