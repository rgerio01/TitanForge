import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios, { AxiosRequestConfig } from 'axios';

/**
 * Backend EFI Pay (PIX) — main process do Electron
 * Usa API REST oficial da EFI com mTLS via certificado .p12
 * Documentação: https://dev.efipay.com.br/docs/api-pix
 */

const EFI_BASE_PROD = 'https://pix.api.efipay.com.br';

// Endpoint separado para cobranças (cartão / billet / one-step)
// PIX usa /v2/cob, cartão usa /v1/charge — base diferente
const EFI_CHARGE_BASE_PROD = 'https://cobrancas.api.efipay.com.br';

interface EfiConfig {
  clientId: string;
  clientSecret: string;
  pixKey: string;
  certificate: Buffer;
  baseUrl: string;
}

let cachedConfig: EfiConfig | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadEfiConfig(): EfiConfig {
  if (cachedConfig) return cachedConfig;

  // Tenta múltiplos paths possíveis (dev, prod empacotado)
  const candidates = [
    path.join(process.cwd(), '.env.efi'),
    path.join(process.resourcesPath || '', '.env.efi'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', '.env.efi'),
    path.join(__dirname, '../../.env.efi'),
  ];

  let envContent = '';
  let envPath = '';
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      envContent = fs.readFileSync(p, 'utf-8');
      envPath = p;
      break;
    }
  }
  if (!envContent) {
    throw new Error('.env.efi não encontrado');
  }

  const env: Record<string, string> = {};
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }

  const certPath = env.CERT_PATH || 'certificado.p12';
  const baseDir = path.dirname(envPath);
  const certCandidates = [
    path.join(baseDir, certPath),
    path.join(process.cwd(), certPath),
    path.join(process.resourcesPath || '', certPath),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', certPath),
    path.join(__dirname, '../..', certPath),
  ];

  let certBuffer: Buffer | null = null;
  for (const cp of certCandidates) {
    if (cp && fs.existsSync(cp)) {
      certBuffer = fs.readFileSync(cp);
      break;
    }
  }
  if (!certBuffer) {
    throw new Error('Certificado .p12 não encontrado');
  }

  cachedConfig = {
    clientId: env.CLIENT_ID,
    clientSecret: env.CHAVE_SECRET,
    pixKey: env.CHAVE_PIX,
    certificate: certBuffer,
    baseUrl: EFI_BASE_PROD,
  };

  return cachedConfig;
}

function buildAgent(cfg: EfiConfig): https.Agent {
  return new https.Agent({
    pfx: cfg.certificate,
    passphrase: '',
    keepAlive: true,
  });
}

async function getAccessToken(): Promise<string> {
  const cfg = loadEfiConfig();
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const agent = buildAgent(cfg);

  const response = await axios.post(
    `${cfg.baseUrl}/oauth/token`,
    { grant_type: 'client_credentials' },
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      httpsAgent: agent,
      timeout: 15000,
    }
  );

  const token = response.data.access_token as string;
  const expiresIn = (response.data.expires_in as number) || 3600;
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

function generateTxid(): string {
  // 26-35 chars alfanuméricos, sem hífen — exigência da EFI
  return crypto.randomBytes(16).toString('hex'); // 32 chars
}

export interface CreatePixChargeInput {
  amount: number; // valor em reais (ex: 49.90)
  payerName?: string;
  payerCpf?: string;
  description: string; // solicitacaoPagador
  expirationSeconds?: number; // default 3600
}

export interface PixChargeResult {
  txid: string;
  locId: number;
  qrCodeText: string; // Pix Copia e Cola
  qrCodeImage: string; // data URI base64 PNG
  expiresAt: string;
}

async function efiRequest<T>(opts: AxiosRequestConfig): Promise<T> {
  const cfg = loadEfiConfig();
  const token = await getAccessToken();
  const agent = buildAgent(cfg);

  const res = await axios.request<T>({
    ...opts,
    baseURL: cfg.baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    httpsAgent: agent,
    timeout: opts.timeout || 20000,
  });
  return res.data;
}

export async function createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
  const cfg = loadEfiConfig();
  const txid = generateTxid();
  const expiration = input.expirationSeconds || 3600;

  const body: any = {
    calendario: { expiracao: expiration },
    valor: { original: input.amount.toFixed(2) },
    chave: cfg.pixKey,
    solicitacaoPagador: input.description.slice(0, 140),
  };

  if (input.payerName && input.payerCpf) {
    body.devedor = { cpf: input.payerCpf, nome: input.payerName };
  }

  // 1. Cria cobrança
  const cob = await efiRequest<any>({
    method: 'PUT',
    url: `/v2/cob/${txid}`,
    data: body,
  });

  const locId = cob?.loc?.id;
  if (!locId) throw new Error('Falha ao criar cobrança PIX');

  // 2. Gera QR Code
  const qr = await efiRequest<any>({
    method: 'GET',
    url: `/v2/loc/${locId}/qrcode`,
  });

  return {
    txid,
    locId,
    qrCodeText: qr.qrcode,
    qrCodeImage: qr.imagemQrcode, // já vem como data:image/png;base64,...
    expiresAt: new Date(Date.now() + expiration * 1000).toISOString(),
  };
}

export interface ChargeStatus {
  txid: string;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';
  paid: boolean;
  paidAt?: string;
  amount?: string;
}

export async function getChargeStatus(txid: string): Promise<ChargeStatus> {
  const data = await efiRequest<any>({
    method: 'GET',
    url: `/v2/cob/${txid}`,
  });

  const status = data.status as ChargeStatus['status'];
  const paid = status === 'CONCLUIDA';
  const pix = Array.isArray(data.pix) && data.pix.length > 0 ? data.pix[0] : null;

  return {
    txid: data.txid,
    status,
    paid,
    paidAt: pix?.horario,
    amount: pix?.valor,
  };
}

// ============================================
// CARTÃO DE CRÉDITO + ANTI-FRAUDE + CHARGEBACK
// ============================================

let cachedChargeToken: { token: string; expiresAt: number } | null = null;

/**
 * OAuth para o endpoint /v1/charge (cobrancas.api.efipay.com.br) — token separado do PIX
 */
async function getChargeAccessToken(): Promise<string> {
  const cfg = loadEfiConfig();
  const now = Date.now();
  if (cachedChargeToken && cachedChargeToken.expiresAt > now + 30_000) return cachedChargeToken.token;

  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const agent = buildAgent(cfg);
  const r = await axios.post(
    `${EFI_CHARGE_BASE_PROD}/oauth/token`,
    { grant_type: 'client_credentials' },
    {
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
      httpsAgent: agent,
      timeout: 15000,
    }
  );
  const token = r.data.access_token as string;
  const expiresIn = (r.data.expires_in as number) || 3600;
  cachedChargeToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function chargeRequest<T>(opts: AxiosRequestConfig): Promise<T> {
  const cfg = loadEfiConfig();
  const token = await getChargeAccessToken();
  const agent = buildAgent(cfg);
  const res = await axios.request<T>({
    ...opts,
    baseURL: EFI_CHARGE_BASE_PROD,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    httpsAgent: agent,
    timeout: opts.timeout || 30000,
  });
  return res.data;
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'hipercard' | 'diners' | 'discover';

export interface CardInstallmentOption {
  installments: number;
  has_interest: boolean;
  installment_value: number;       // em centavos
  total_value: number;             // em centavos
  rate: string;                    // taxa aplicada
}

export async function getCardInstallments(amountCents: number, brand: CardBrand): Promise<CardInstallmentOption[]> {
  // EFI espera total em centavos como string
  const data = await chargeRequest<any>({
    method: 'GET',
    url: '/v1/installments',
    params: { total: String(amountCents), brand },
  });

  const list = (data?.data?.installments || data?.installments || []) as any[];
  return list
    .filter((it: any) => Number(it.installment) >= 1 && Number(it.installment) <= 12)
    .map((it: any) => ({
      installments: Number(it.installment),
      has_interest: !!it.has_interest,
      installment_value: Number(it.value || it.installment_value || 0),
      total_value: Number(it.total || it.installment_total_value || 0) || amountCents,
      rate: String(it.rate || ''),
    }));
}

export interface CardCustomer {
  name: string;
  cpf: string;             // só dígitos
  phone_number: string;    // só dígitos com DDD: 41991197816
  email: string;
  birth?: string;          // YYYY-MM-DD
}

export interface CardBillingAddress {
  street: string;
  number: string | number;
  neighborhood: string;
  zipcode: string;         // só dígitos
  city: string;
  state: string;           // 2 letras
}

export interface CreateCardChargeInput {
  amountCents: number;            // valor TOTAL bruto em centavos (sem juros)
  installments: number;           // 1..12
  paymentToken: string;           // token gerado via SDK JS ou tokenize endpoint
  customer: CardCustomer;
  billingAddress: CardBillingAddress;
  description: string;
  metadataCustomId?: string;      // pra correlacionar com pix_orders.id
}

export interface CardChargeResult {
  chargeId: number;
  status: string;            // waiting | new | paid | approved | unpaid | refunded | contested | settled | canceled | identified
  totalCents: number;        // total final cobrado (com juros se aplicável)
  installmentValueCents: number;
  installments: number;
}

/**
 * Cria cobrança one-step de cartão de crédito.
 * O antifraude (se ativo no painel da EFI) é aplicado automaticamente pela própria API.
 * O cliente cobre o juros das parcelas (modalidade "with_interest" — pass-through).
 */
export async function createCardCharge(input: CreateCardChargeInput): Promise<CardChargeResult> {
  if (input.installments < 1 || input.installments > 12) {
    throw new Error('Parcelas devem estar entre 1 e 12');
  }

  const items = [
    {
      name: input.description.slice(0, 80),
      amount: 1,
      value: input.amountCents,
    },
  ];

  const body: any = {
    items,
    payment: {
      credit_card: {
        installments: input.installments,
        payment_token: input.paymentToken,
        customer: input.customer,
        billing_address: input.billingAddress,
        message: 'Umbra Launcher',
      },
    },
  };

  if (input.metadataCustomId) {
    body.metadata = { custom_id: input.metadataCustomId };
  }

  const data = await chargeRequest<any>({
    method: 'POST',
    url: '/v1/charge/one-step',
    data: body,
  });

  const d = data?.data || data;
  return {
    chargeId: Number(d.charge_id),
    status: String(d.status || 'unknown'),
    totalCents: Number(d.total || input.amountCents),
    installmentValueCents: Number(d.installments?.value || d.installment_value || 0),
    installments: Number(d.installments?.installments || input.installments),
  };
}

export interface CardChargeDetailStatus {
  chargeId: number;
  status: string;     // pode ser: new, waiting, identified, approved, paid, unpaid, refunded, contested, settled, canceled
  paid: boolean;
  refunded: boolean;
  contested: boolean;
  raw: any;
}

export async function getCardChargeStatus(chargeId: number): Promise<CardChargeDetailStatus> {
  const data = await chargeRequest<any>({
    method: 'GET',
    url: `/v1/charge/${chargeId}`,
  });
  const d = data?.data || data;
  const status = String(d.status || 'unknown').toLowerCase();
  return {
    chargeId,
    status,
    paid: status === 'paid' || status === 'approved' || status === 'settled',
    refunded: status === 'refunded',
    // EFI marca chargeback como 'contested' (em disputa) ou 'unpaid' depois de revertido
    contested: status === 'contested' || status === 'unpaid' || status === 'canceled',
    raw: d,
  };
}
