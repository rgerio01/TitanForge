/**
 * Tokenização do cartão via SDK JS oficial da EFI Pay.
 * Carrega o script dinamicamente no Electron renderer (Chromium suporta normalmente).
 *
 * Os dados do cartão **nunca saem desta função em texto puro** — o SDK envia
 * direto pra EFI e devolve apenas o `payment_token`, que aí sim é seguro de
 * trafegar para o nosso main process.
 *
 * Pré-requisito: o `EFI_PAYEE_CODE` precisa estar configurado no .env.efi.
 *   (no painel da EFI: Aplicações → seu app → "Identificador do Pagador").
 *
 * Se o Payee Code não estiver configurado, a tokenização falha com mensagem clara.
 */

declare global {
  interface Window {
    EfiPay?: any;
    $gn?: any;
  }
}

let scriptLoaded = false;
let loadingPromise: Promise<void> | null = null;

async function fetchPayeeCode(): Promise<string | null> {
  // O main expõe via env (carregado no startup)
  // Como não queremos um IPC só pra isso, expomos via process.env (DefinePlugin no webpack injeta)
  const code = (window as any).__EFI_PAYEE_CODE__ || (process as any).env?.EFI_PAYEE_CODE;
  return code || null;
}

function loadEfiScript(payeeCode: string): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const v = Date.now();
    const url = `https://api.efipay.com.br/v1/cdn/${payeeCode}/${v}`;
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = url;
    tag.onload = () => { scriptLoaded = true; resolve(); };
    tag.onerror = () => reject(new Error('Falha ao carregar SDK de pagamento'));
    document.head.appendChild(tag);

    // Inicializa $gn que o SDK espera
    (window as any).$gn = {
      validForm: true, processed: false, done: {},
      ready: function (fn: any) { (window as any).$gn.done = fn; },
    };
  });

  return loadingPromise;
}

export interface TokenizeInput {
  brand: string;
  number: string;          // só dígitos
  cvv: string;
  expiration_month: string; // MM
  expiration_year: string;  // YYYY
  holder_name: string;
}

export interface TokenizeResult {
  token: string;
  card_mask: string;
}

export async function tokenizeCard(input: TokenizeInput): Promise<TokenizeResult> {
  const payeeCode = await fetchPayeeCode();
  if (!payeeCode) {
    throw new Error('Pagamento por cartão indisponível no momento. Tente PIX.');
  }
  await loadEfiScript(payeeCode);

  return new Promise((resolve, reject) => {
    try {
      const $gn = (window as any).$gn;
      $gn.ready(function (checkout: any) {
        checkout.getPaymentToken(
          {
            brand: input.brand,
            number: input.number,
            cvv: input.cvv,
            expiration_month: input.expiration_month,
            expiration_year: input.expiration_year,
          },
          function (error: any, response: any) {
            if (error) {
              reject(new Error(error?.error_description || error?.message || 'Falha ao validar cartão'));
              return;
            }
            const data = response?.data || response;
            if (!data?.payment_token) {
              reject(new Error('Token não retornado'));
              return;
            }
            resolve({
              token: data.payment_token,
              card_mask: data.card_mask || '',
            });
          }
        );
      });
    } catch (e: any) {
      reject(new Error('SDK de pagamento indisponível. Use PIX.'));
    }
  });
}
