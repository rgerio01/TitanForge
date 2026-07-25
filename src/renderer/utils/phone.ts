/**
 * Formata um telefone brasileiro celular para o formato (DD) 9 XXXX-XXXX.
 * Aceita qualquer entrada e formata até onde for possível.
 *
 * Exemplos:
 *   "" → ""
 *   "4" → "(4"
 *   "41" → "(41) "
 *   "419" → "(41) 9 "
 *   "4199" → "(41) 9 9"
 *   "41991197816" → "(41) 9 9119-7816"
 */
export function formatPhone(input: string): string {
  if (!input) return '';
  const d = input.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length === 1) return `(${d}`;
  if (d.length === 2) return `(${d}) `;
  // 3+ dígitos: começa o "9" + número
  if (d.length === 3) return `(${d.slice(0, 2)}) ${d[2]} `;
  if (d.length <= 7) {
    return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3)}`;
  }
  // 8 a 11 dígitos: insere o hífen antes dos últimos 4
  const ddd = d.slice(0, 2);
  const nine = d[2];
  const rest = d.slice(3);
  if (rest.length <= 4) return `(${ddd}) ${nine} ${rest}`;
  const split = rest.length - 4;
  return `(${ddd}) ${nine} ${rest.slice(0, split)}-${rest.slice(split)}`;
}

export function phoneDigits(input: string): string {
  return (input || '').replace(/\D/g, '');
}
