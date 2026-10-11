import { PublicError } from "./errors";

// Small bounded base-10 arithmetic for money comparisons, not a dependency or
// a rounding tolerance. Numbers are interpreted by their decimal JSON spelling.
export type DecimalCost = { coefficient: bigint; scale: number };
const MAX_TEXT = 1024;
const MAX_SCALE = 1000;
const pow10 = (n: number) => 10n ** BigInt(n);
function normalized(coefficient: bigint, scale: number): DecimalCost {
  if (scale < 0) { coefficient *= pow10(-scale); scale = 0; }
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}

export function decimalCost(value: unknown): DecimalCost {
  if (typeof value !== "string" && typeof value !== "number") throw new PublicError("INVALID_RESPONSE");
  const text = String(value).trim();
  if (text.length > MAX_TEXT) throw new PublicError("INVALID_RESPONSE");
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  const number = Number(text);
  if (!match || !Number.isFinite(number)) throw new PublicError("INVALID_RESPONSE");
  const exponent = Number(match[3] ?? 0);
  const fraction = match[2].split('.')[1]?.length ?? 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_SCALE || fraction > MAX_SCALE) throw new PublicError("INVALID_RESPONSE");
  const digits = match[2].replace('.', '');
  const coefficient = BigInt(digits) * (match[1] === '-' ? -1n : 1n);
  if (coefficient !== 0n && number === 0) throw new PublicError("INVALID_RESPONSE");
  const scale = fraction - exponent;
  if (Math.abs(scale) > MAX_SCALE) throw new PublicError("INVALID_RESPONSE");
  return normalized(coefficient, scale);
}

export function addDecimalCost(a: DecimalCost, b: DecimalCost): DecimalCost {
  const scale = Math.max(a.scale, b.scale);
  return normalized(a.coefficient * pow10(scale - a.scale) + b.coefficient * pow10(scale - b.scale), scale);
}
export const subtractDecimalCost = (a: DecimalCost, b: DecimalCost) => addDecimalCost(a, { ...b, coefficient: -b.coefficient });
export const multiplyDecimalCost = (a: DecimalCost, b: DecimalCost): DecimalCost => normalized(a.coefficient * b.coefficient, a.scale + b.scale);
export function compareDecimalCost(a: DecimalCost, b: DecimalCost): number {
  const delta = subtractDecimalCost(a, b).coefficient;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function decimalCostNumber(value: DecimalCost): number {
  const number = Number(`${value.coefficient}e-${value.scale}`);
  if (!Number.isFinite(number) || (number === 0 && value.coefficient !== 0n)) throw new PublicError("INVALID_RESPONSE");
  return number;
}
export function sumDecimalCosts(values: unknown[]): DecimalCost {
  let sum = decimalCost(0);
  for (const value of values) {
    sum = addDecimalCost(sum, decimalCost(value));
    decimalCostNumber(sum); // Fail closed on underflow/overflow; never emit Infinity.
  }
  return sum;
}

/** Decimal long division for display only; threshold comparisons never divide. */
export function divideDecimalCostNumber(numerator: DecimalCost, denominator: DecimalCost): number {
  if (denominator.coefficient === 0n) throw new PublicError("INVALID_RESPONSE");
  const sign = (numerator.coefficient < 0n) !== (denominator.coefficient < 0n) ? '-' : '';
  let n = numerator.coefficient < 0n ? -numerator.coefficient : numerator.coefficient;
  let d = denominator.coefficient < 0n ? -denominator.coefficient : denominator.coefficient;
  n *= pow10(denominator.scale);
  d *= pow10(numerator.scale);
  const whole = n / d;
  let remainder = n % d, decimals = '';
  // 340 digits cover finite JavaScript subnormals and more than display precision.
  for (let i = 0; remainder !== 0n && i < 340; i++) {
    remainder *= 10n;
    decimals += String(remainder / d);
    remainder %= d;
  }
  const number = Number(`${sign}${whole}.${decimals || '0'}`);
  if (!Number.isFinite(number) || (number === 0 && numerator.coefficient !== 0n)) throw new PublicError("INVALID_RESPONSE");
  return number;
}
