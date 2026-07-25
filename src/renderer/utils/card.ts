/**
 * Utilitários para formulário de cartão de crédito.
 * Os dados do cartão **nunca** são salvos — apenas tokenizados na hora da cobrança.
 */

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'hipercard' | 'diners' | 'unknown';

const BRAND_PATTERNS: Array<{ brand: CardBrand; regex: RegExp }> = [
  { brand: 'visa',       regex: /^4/ },
  { brand: 'mastercard', regex: /^(5[1-5]|2[2-7])/ },
  { brand: 'amex',       regex: /^3[47]/ },
  { brand: 'diners',     regex: /^3(?:0[0-5]|[68])/ },
  { brand: 'elo',        regex: /^(4011|4312|4389|4514|4573|5041|5066|5067|5090|6277|6362|6363|6504|6505|6509|6516|6550)/ },
  { brand: 'hipercard',  regex: /^(606282|3841)/ },
];

export function detectBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '');
  for (const { brand, regex } of BRAND_PATTERNS) {
    if (regex.test(digits)) return brand;
  }
  return 'unknown';
}

export function brandLabel(b: CardBrand): string {
  return ({
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    elo: 'Elo',
    hipercard: 'Hipercard',
    diners: 'Diners',
    unknown: 'Cartão',
  })[b];
}

export function formatCardNumber(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 19);
  if (!d) return '';
  // Amex: 4-6-5
  if (/^3[47]/.test(d)) {
    return d.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
  }
  // Outros: 4-4-4-4
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function formatExpiry(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export function formatCpf(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCep(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let r = 11 - (sum % 11);
  if (r >= 10) r = 0;
  if (r !== parseInt(d[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  r = 11 - (sum % 11);
  if (r >= 10) r = 0;
  return r === parseInt(d[10], 10);
}

export function parseExpiry(input: string): { mm: string; yyyy: string } | null {
  const m = input.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const mm = m[1];
  const monthNum = parseInt(mm, 10);
  if (monthNum < 1 || monthNum > 12) return null;
  const yyyy = '20' + m[2];
  return { mm, yyyy };
}

export function digits(s: string): string {
  return (s || '').replace(/\D/g, '');
}
