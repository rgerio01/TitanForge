import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconCopy, IconAlert } from './Icons';
import { formatCardNumber, formatExpiry, formatCpf, formatCep, detectBrand, brandLabel, parseExpiry, isValidCpf, digits, type CardBrand } from '../utils/card';
import { formatPhone, phoneDigits } from '../utils/phone';
import { tokenizeCard } from '../utils/efiTokenize';

interface ProductInfo {
  type: string;
  name: string;
  price: number;
  description?: string;
}

interface Props {
  product: ProductInfo;
  productRef?: string;
  licenseKey: string;
  licenseName?: string | null;
  licenseEmail?: string | null;
  licensePhone?: string | null;
  onClose: () => void;
  onPaid?: (txid: string) => void;
}

type Tab = 'pix' | 'card';
type Stage =
  | { kind: 'checkout' }
  | { kind: 'qrcode'; order: any }
  | { kind: 'paid'; method: 'pix' | 'card' | 'free' };

const PaymentModal: React.FC<Props> = ({ product, productRef, licenseKey, licenseName, licenseEmail, licensePhone, onClose, onPaid }) => {
  const [tab, setTab] = useState<Tab>('pix');
  const [stage, setStage] = useState<Stage>({ kind: 'checkout' });

  const [serverPrice, setServerPrice] = useState<number>(product.price);
  const [serverName, setServerName] = useState<string>(product.name);
  const [loadingPrice, setLoadingPrice] = useState(true);

  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    message?: string;
    discountedPrice?: number;
    free?: boolean;
  }>({ status: 'idle' });

  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingPrice(true);
    window.electron.productsList()
      .then((r) => {
        if (!active) return;
        if (r.success && r.products) {
          const p = r.products.find((x) => x.type === product.type);
          if (p) { setServerPrice(Number(p.price)); setServerName(p.name); }
        }
      })
      .finally(() => { if (active) setLoadingPrice(false); });
    return () => { active = false; };
  }, [product.type]);

  const basePrice = serverPrice;
  const finalPrice = couponState.discountedPrice ?? basePrice;
  const isFree = couponState.free === true;

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code) { setCouponState({ status: 'idle' }); return; }
    setCouponState({ status: 'checking' });
    const r = await window.electron.couponValidate(code, product.type);
    if (!r.success || !r.discount_type || r.discount_value == null) {
      setCouponState({ status: 'invalid', message: r.message || 'Cupom inválido' });
      return;
    }
    const discount = Number(r.discount_value);
    const raw = r.discount_type === 'percent'
      ? basePrice * (1 - discount / 100)
      : basePrice - discount;
    if (raw <= 0) {
      setCouponState({ status: 'valid', message: 'Cupom 100%! Liberado direto.', discountedPrice: 0, free: true });
    } else {
      setCouponState({
        status: 'valid',
        message: r.discount_type === 'percent' ? `-${discount}%` : `-R$ ${discount.toFixed(2)}`,
        discountedPrice: Math.max(0.01, +raw.toFixed(2)),
        free: false,
      });
    }
  }

  async function confirmPix() {
    setProcessing(true); setError(null);
    const r = await window.electron.pixCreateOrder({
      licenseKey,
      licenseName: licenseName || undefined,
      productType: product.type,
      productRef,
      couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
    });
    setProcessing(false);
    if (!r.success || !r.order) { setError(r.error || 'Falha'); return; }
    if ((r as any).free === true) {
      setStage({ kind: 'paid', method: 'free' });
      onPaid?.(r.order.txid);
      return;
    }
    setStage({ kind: 'qrcode', order: r.order });
  }

  useEffect(() => {
    if (stage.kind !== 'qrcode') return;
    let active = true;
    const txid = stage.order.txid;
    const poll = async () => {
      const r = await window.electron.pixCheckStatus(txid);
      if (!active) return;
      if (r.success && r.paid) {
        setStage({ kind: 'paid', method: 'pix' });
        onPaid?.(txid);
      }
    };
    const id = setInterval(poll, 5000);
    poll();
    return () => { active = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind]);

  function copyPix() {
    if (stage.kind !== 'qrcode') return;
    navigator.clipboard.writeText(stage.order.qrCodeText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  // Largura adapta — cartão usa mais espaço
  const modalWidth = stage.kind === 'checkout' && tab === 'card' ? 760 : 460;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0, width: modalWidth }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          style={{
            position: 'relative',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            maxWidth: '96vw',
            maxHeight: '92vh',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          }}
        >
          <CloseX onClose={onClose} disabled={processing} />
          {stage.kind === 'paid' ? (
            <PaidView method={stage.method} productType={product.type} onClose={onClose} />
          ) : stage.kind === 'qrcode' ? (
            <QrView order={stage.order} productName={serverName} copied={copied} onCopy={copyPix} onClose={onClose} />
          ) : (
            <CheckoutView
              tab={tab}
              setTab={setTab}
              productName={serverName}
              productDescription={product.description}
              basePrice={basePrice}
              finalPrice={finalPrice}
              loadingPrice={loadingPrice}
              isFree={isFree}
              coupon={coupon}
              setCoupon={(v) => { setCoupon(v); setCouponState({ status: 'idle' }); }}
              applyCoupon={applyCoupon}
              couponState={couponState}
              error={error}
              processing={processing}
              productType={product.type}
              productRef={productRef}
              couponCode={couponState.status === 'valid' ? coupon.trim() : undefined}
              licenseKey={licenseKey}
              licenseName={licenseName}
              licenseEmail={licenseEmail}
              licensePhone={licensePhone}
              onClose={onClose}
              onConfirmPix={confirmPix}
              onPaid={(txid) => { setStage({ kind: 'paid', method: 'card' }); onPaid?.(txid); }}
              setError={setError}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────
// CLOSE X (canto inferior direito)
// ─────────────────────────────────────────

const CloseX: React.FC<{ onClose: () => void; disabled?: boolean }> = ({ onClose, disabled }) => (
  <button
    onClick={onClose}
    disabled={disabled}
    title="Fechar"
    style={{
      position: 'absolute',
      top: 10,
      right: 10,
      zIndex: 10,
      width: 28,
      height: 28,
      borderRadius: '50%',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid var(--border)',
      backdropFilter: 'blur(4px)',
      color: 'var(--text-secondary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 16,
      lineHeight: 1,
      transition: 'all 0.15s',
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = 'rgba(255,77,138,0.12)';
      e.currentTarget.style.color = '#ff4d8a';
      e.currentTarget.style.borderColor = 'rgba(255,77,138,0.3)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'rgba(0,0,0,0.55)';
      e.currentTarget.style.color = 'var(--text-secondary)';
      e.currentTarget.style.borderColor = 'var(--border)';
    }}
  >
    ×
  </button>
);

// ─────────────────────────────────────────
// CHECKOUT VIEW (com tabs)
// ─────────────────────────────────────────

interface CheckoutViewProps {
  tab: Tab;
  setTab: (t: Tab) => void;
  productName: string;
  productDescription?: string;
  basePrice: number;
  finalPrice: number;
  loadingPrice: boolean;
  isFree: boolean;
  coupon: string;
  setCoupon: (v: string) => void;
  applyCoupon: () => void;
  couponState: any;
  error: string | null;
  processing: boolean;
  productType: string;
  productRef?: string;
  couponCode?: string;
  licenseKey: string;
  licenseName?: string | null;
  licenseEmail?: string | null;
  licensePhone?: string | null;
  onClose: () => void;
  onConfirmPix: () => void;
  onPaid: (txid: string) => void;
  setError: (s: string | null) => void;
}

const CheckoutView: React.FC<CheckoutViewProps> = (p) => (
  <>
    {/* Header */}
    <div style={{ padding: '20px 26px 14px', borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px', fontWeight: 600 }}>Checkout</p>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', fontFamily: 'Syne, sans-serif' }}>{p.productName}</h3>
      {p.productDescription && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{p.productDescription}</p>}
    </div>

    {/* Tabs */}
    <div style={{ display: 'flex', padding: '14px 26px 0', gap: 6 }}>
      <TabButton active={p.tab === 'pix'} onClick={() => p.setTab('pix')} icon="⚡">PIX</TabButton>
      <TabButton active={p.tab === 'card'} onClick={() => p.setTab('card')} icon="💳">Cartão (até 12x)</TabButton>
    </div>

    {/* Body */}
    {p.tab === 'pix' ? (
      <div style={{ padding: '14px 26px 18px' }}>
        <CouponField coupon={p.coupon} setCoupon={p.setCoupon} apply={p.applyCoupon} state={p.couponState} disabled={p.processing} />
        <Summary base={p.basePrice} final={p.finalPrice} loading={p.loadingPrice} couponValid={p.couponState.status === 'valid'} free={p.isFree} />
        {p.error && <ErrorBanner text={p.error} />}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={p.onClose} disabled={p.processing} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '11px' }}>Cancelar</button>
          <button onClick={p.onConfirmPix} disabled={p.processing || p.loadingPrice} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '11px' }}>
            {p.loadingPrice ? 'Carregando...' : p.processing ? 'Processando...' : p.isFree ? 'Resgatar grátis' : 'Gerar PIX'}
          </button>
        </div>
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', minHeight: 0 }}>
        {/* Coluna esquerda: form */}
        <div className="custom-scrollbar" style={{ overflowY: 'auto', padding: '14px 8px 14px 26px', maxHeight: '70vh' }}>
          <CardForm
            productType={p.productType}
            productRef={p.productRef}
            couponCode={p.couponCode}
            licenseKey={p.licenseKey}
            licenseName={p.licenseName}
            licenseEmail={p.licenseEmail}
            licensePhone={p.licensePhone}
            isFree={p.isFree}
            onCancel={p.onClose}
            onPaid={p.onPaid}
            onError={p.setError}
            error={p.error}
          />
        </div>

        {/* Coluna direita: resumo fixo */}
        <div style={{
          background: 'rgba(124,92,252,0.03)',
          borderLeft: '1px solid var(--border)',
          padding: '14px 22px 18px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <CouponField coupon={p.coupon} setCoupon={p.setCoupon} apply={p.applyCoupon} state={p.couponState} disabled={p.processing} compact />
          <Summary base={p.basePrice} final={p.finalPrice} loading={p.loadingPrice} couponValid={p.couponState.status === 'valid'} free={p.isFree} />

          <div style={{
            background: 'rgba(74,222,128,0.05)',
            border: '1px solid rgba(74,222,128,0.18)',
            borderRadius: 8, padding: '10px 12px',
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>🛡️</span>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Pagamento seguro</strong> com antifraude. Os dados do cartão são tokenizados pela EFI Bank — não passam pelos nossos servidores.
            </p>
          </div>

          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 12px',
          }}>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
              Bandeiras aceitas
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: 0 }}>
              Visa · Master · Elo · Amex · Hipercard · Diners
            </p>
          </div>
        </div>
      </div>
    )}
  </>
);

// ─────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; icon?: string }> = ({ active, onClick, children, icon }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1, padding: '11px 14px', fontSize: 13,
      background: active ? 'rgba(124,92,252,0.10)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${active ? 'rgba(124,92,252,0.40)' : 'var(--border)'}`,
      borderRadius: 8, color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 700 : 500,
      transition: 'all .15s',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}
  >
    {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
    {children}
  </button>
);

const CouponField: React.FC<{ coupon: string; setCoupon: (v: string) => void; apply: () => void; state: any; disabled?: boolean; compact?: boolean }> = ({ coupon, setCoupon, apply, state, disabled, compact }) => (
  <div style={{ marginBottom: compact ? 0 : 10 }}>
    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
      Cupom (opcional)
    </label>
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        value={coupon}
        onChange={(e) => setCoupon(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        placeholder="DIGITE O CUPOM"
        className="input"
        style={{ flex: 1, textTransform: 'uppercase', fontSize: 12 }}
        disabled={disabled}
      />
      <button onClick={apply} disabled={disabled || !coupon.trim() || state.status === 'checking'} className="btn-ghost" style={{ padding: '0 12px', fontSize: 11 }}>
        {state.status === 'checking' ? '...' : 'Aplicar'}
      </button>
    </div>
    {state.status === 'valid' && (
      <p style={{ fontSize: 11, color: '#4ade80', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconCheck size={11} /> {state.message}
      </p>
    )}
    {state.status === 'invalid' && (
      <p style={{ fontSize: 11, color: '#ff4d8a', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconAlert size={11} /> {state.message}
      </p>
    )}
  </div>
);

const Summary: React.FC<{ base: number; final: number; loading: boolean; couponValid: boolean; free: boolean }> = ({ base, final, loading, couponValid, free }) => (
  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
      <span>Subtotal</span>
      <span>{loading ? '...' : `R$ ${base.toFixed(2).replace('.', ',')}`}</span>
    </div>
    {couponValid && (
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#4ade80' }}>
        <span>Desconto</span>
        <span>−R$ {(base - final).toFixed(2).replace('.', ',')}</span>
      </div>
    )}
    <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>Total</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Syne, sans-serif' }}>
        {loading ? '...' : free ? 'Grátis' : `R$ ${final.toFixed(2).replace('.', ',')}`}
      </span>
    </div>
  </div>
);

const ErrorBanner: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ff4d8a', marginBottom: 10, padding: '8px 10px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.20)', borderRadius: 7 }}>
    <IconAlert size={11} /> {text}
  </div>
);

const PaidView: React.FC<{ method: 'pix' | 'card' | 'free'; productType: string; onClose: () => void }> = ({ method, productType, onClose }) => (
  <div style={{ padding: '32px 28px', textAlign: 'center' }}>
    <motion.div
      initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
      style={{ width: 72, height: 72, borderRadius: '50%', background: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#062b15' }}
    >
      <IconCheck size={34} />
    </motion.div>
    <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>
      {method === 'free' ? 'Liberado com cupom!' : method === 'card' ? 'Pagamento aprovado!' : 'Pagamento confirmado!'}
    </h3>
    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 22px', lineHeight: 1.55 }}>
      {productType === 'denuvo' ? 'Recebemos seu pedido. Em até 2 dias úteis entraremos em contato.' : 'Sua permissão foi liberada automaticamente. Pode usar agora!'}
    </p>
    <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>Fechar</button>
  </div>
);

const QrView: React.FC<{ order: any; productName: string; copied: boolean; onCopy: () => void; onClose: () => void }> = ({ order, productName, copied, onCopy, onClose }) => (
  <div style={{ padding: '24px 26px' }}>
    <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px' }}>Pagamento via PIX</p>
    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>{productName}</h3>
    <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px', fontFamily: 'Syne, sans-serif' }}>R$ {order.amount.toFixed(2).replace('.', ',')}</p>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
      <div style={{ padding: 12, background: '#fff', borderRadius: 12 }}>
        <img src={order.qrCodeImage} alt="QR Code PIX" style={{ width: 200, height: 200, display: 'block' }} />
      </div>
    </div>
    <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 12 }}>Aponte a câmera do banco ou use o Pix Copia e Cola</p>
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Pix Copia e Cola</span>
        <button onClick={onCopy} className="btn-ghost" style={{ padding: '5px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
          {copied ? <IconCheck size={10} /> : <IconCopy size={10} />} {copied ? 'Copiado' : 'Copiar código'}
        </button>
      </div>
      <textarea
        readOnly
        value={order.qrCodeText}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: '100%', height: 58, resize: 'none', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 10px', color: 'var(--text-secondary)', fontSize: 10.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.45,
          outline: 'none',
        }}
      />
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.4 }}>
        Copie o código, abra o Pix no app do banco e cole na opção Pix Copia e Cola.
      </p>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(124,92,252,0.05)', border: '1px solid rgba(124,92,252,0.18)', borderRadius: 8, marginBottom: 14 }}>
      <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 } as React.CSSProperties} />
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Aguardando confirmação...</span>
    </div>
    <button onClick={onClose} className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Pagar mais tarde</button>
  </div>
);

// ─────────────────────────────────────────
// CARD FORM (compacto, em 2 colunas)
// ─────────────────────────────────────────

const CardForm: React.FC<{
  productType: string;
  productRef?: string;
  couponCode?: string;
  licenseKey: string;
  licenseName?: string | null;
  licenseEmail?: string | null;
  licensePhone?: string | null;
  isFree: boolean;
  onCancel: () => void;
  onPaid: (txid: string) => void;
  onError: (msg: string | null) => void;
  error: string | null;
}> = ({ productType, productRef, couponCode, licenseKey, licenseName, licenseEmail, licensePhone, isFree, onCancel, onPaid, onError, error }) => {
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState((licenseName || '').toUpperCase());
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState(licensePhone ? formatPhone(licensePhone) : '');
  const [email, setEmail] = useState(licenseEmail || '');
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [num, setNum] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepFound, setCepFound] = useState(false);

  // Auto-busca CEP via ViaCEP
  useEffect(() => {
    const d = digits(cep);
    if (d.length !== 8) { setCepFound(false); return; }
    let active = true;
    setCepLoading(true);
    setCepFound(false);
    window.electron.lookupCep(d)
      .then((r) => {
        if (!active) return;
        if (r.success) {
          setStreet(r.street || '');
          setNeighborhood(r.neighborhood || '');
          setCity(r.city || '');
          setState(r.state || '');
          setCepFound(true);
        }
      })
      .finally(() => { if (active) setCepLoading(false); });
    return () => { active = false; };
  }, [cep]);

  const [installments, setInstallments] = useState<number>(1);
  const [installmentOptions, setInstallmentOptions] = useState<Array<{ installments: number; total_value_cents: number; installment_value_cents: number; has_interest: boolean }>>([]);
  const [loadingInst, setLoadingInst] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const brand = useMemo<CardBrand>(() => detectBrand(number), [number]);
  const cardDigits = digits(number);
  const cardOk = cardDigits.length >= 13 && cardDigits.length <= 19 && brand !== 'unknown';

  useEffect(() => {
    if (!cardOk || isFree) { setInstallmentOptions([]); return; }
    let active = true;
    setLoadingInst(true);
    window.electron.cardInstallments({ productType, productRef, couponCode, brand })
      .then((r) => {
        if (!active) return;
        if (r.success && r.options) setInstallmentOptions(r.options);
        else setInstallmentOptions([]);
      })
      .finally(() => { if (active) setLoadingInst(false); });
    return () => { active = false; };
  }, [brand, cardOk, productType, productRef, couponCode, isFree]);

  function validate(): string | null {
    if (!cardOk) return 'Número do cartão inválido';
    if (!holder.trim() || holder.trim().split(/\s+/).length < 2) return 'Nome impresso completo';
    const ex = parseExpiry(expiry);
    if (!ex) return 'Validade inválida (MM/AA)';
    const now = new Date();
    const expYear = parseInt(ex.yyyy, 10), expMonth = parseInt(ex.mm, 10);
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) return 'Cartão vencido';
    const cvvLen = brand === 'amex' ? 4 : 3;
    if (cvv.replace(/\D/g, '').length !== cvvLen) return `CVV deve ter ${cvvLen} dígitos`;
    if (!isValidCpf(cpf)) return 'CPF inválido';
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return 'E-mail inválido';
    if (phoneDigits(phone).length !== 11) return 'Telefone inválido';
    if (digits(cep).length !== 8) return 'CEP inválido';
    if (!street.trim()) return 'Informe a rua';
    if (!num.trim()) return 'Informe o número do endereço';
    if (!neighborhood.trim()) return 'Informe o bairro';
    if (!city.trim()) return 'Informe a cidade';
    if (state.trim().length !== 2) return 'UF inválido';
    if (!installments || installments < 1) return 'Escolha o parcelamento';
    return null;
  }

  async function pay() {
    const v = validate();
    if (v) { onError(v); return; }
    onError(null);
    setSubmitting(true);
    try {
      const ex = parseExpiry(expiry)!;
      const token = await tokenizeCard({
        brand, number: cardDigits, cvv: cvv.replace(/\D/g, ''),
        expiration_month: ex.mm, expiration_year: ex.yyyy, holder_name: holder.trim(),
      });
      const r = await window.electron.cardCreateOrder({
        licenseKey, productType, productRef, couponCode, installments, brand,
        paymentToken: token.token,
        customer: {
          name: holder.trim(), cpf: digits(cpf), phone_number: phoneDigits(phone),
          email: email.trim().toLowerCase(),
        },
        billingAddress: {
          street: street.trim(),
          number: num.trim(),
          neighborhood: neighborhood.trim(),
          zipcode: digits(cep),
          city: city.trim(),
          state: state.trim().toUpperCase(),
          ...(complement.trim() ? { complement: complement.trim() } : {}),
        } as any,
      });
      setSubmitting(false);
      if (!r.success || !r.order) { onError(r.error || 'Pagamento recusado'); return; }
      onPaid(r.order.txid);
    } catch (e: any) {
      setSubmitting(false);
      onError(e?.message || 'Falha ao validar o cartão');
    }
  }

  return (
    <div>
      {/* Cartão */}
      <SectionLabel>💳 Dados do cartão</SectionLabel>
      <Field label={`Número do cartão${brand !== 'unknown' ? ` · ${brandLabel(brand)}` : ''}`}>
        <input value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }} maxLength={23} autoComplete="cc-number" />
      </Field>
      <Field label="Nome impresso no cartão">
        <input value={holder} onChange={(e) => setHolder(e.target.value.toUpperCase())} placeholder="NOME COMPLETO" className="input" style={{ width: '100%', boxSizing: 'border-box', textTransform: 'uppercase' }} autoComplete="cc-name" />
      </Field>
      <Row3>
        <Field label="Validade">
          <input value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/AA" className="input" style={{ width: '100%', boxSizing: 'border-box' }} maxLength={5} autoComplete="cc-exp" />
        </Field>
        <Field label={`CVV (${brand === 'amex' ? '4' : '3'})`}>
          <input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, brand === 'amex' ? 4 : 3))} placeholder="123" className="input" style={{ width: '100%', boxSizing: 'border-box' }} type="password" autoComplete="cc-csc" />
        </Field>
        <Field label="Parcelas">
          {loadingInst ? (
            <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, height: 36 }}>
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 2 } as React.CSSProperties} />
            </div>
          ) : installmentOptions.length === 0 ? (
            <input className="input" disabled placeholder={cardOk ? 'Indisponível' : 'Digite o cartão'} style={{ width: '100%', boxSizing: 'border-box' }} />
          ) : (
            <select value={installments} onChange={(e) => setInstallments(parseInt(e.target.value, 10))} className="input" style={{ width: '100%', boxSizing: 'border-box' }}>
              {installmentOptions.map((opt) => {
                const each = opt.installment_value_cents / 100;
                return (
                  <option key={opt.installments} value={opt.installments}>
                    {opt.installments}x R$ {each.toFixed(2).replace('.', ',')} {opt.has_interest ? '(c/ juros)' : '(s/ juros)'}
                  </option>
                );
              })}
            </select>
          )}
        </Field>
      </Row3>

      {/* Titular */}
      <SectionLabel>👤 Dados do titular</SectionLabel>
      <Row2>
        <Field label="CPF">
          <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" className="input" style={{ width: '100%', boxSizing: 'border-box' }} maxLength={14} />
        </Field>
        <Field label="Telefone">
          <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(41) 9 9119-7816" className="input" style={{ width: '100%', boxSizing: 'border-box' }} />
        </Field>
      </Row2>
      <Field label="E-mail">
        <input value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} placeholder="seu@email.com" className="input" style={{ width: '100%', boxSizing: 'border-box' }} type="email" />
      </Field>

      {/* Endereço */}
      <SectionLabel>📍 Endereço de cobrança</SectionLabel>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '-2px 0 8px', lineHeight: 1.45 }}>
        Digite o CEP — o restante é preenchido automaticamente.
      </p>
      <Row2>
        <Field label={cepLoading ? 'CEP · buscando...' : cepFound ? 'CEP · encontrado ✓' : 'CEP'}>
          <input value={cep} onChange={(e) => setCep(formatCep(e.target.value))} placeholder="00000-000" className="input" style={{ width: '100%', boxSizing: 'border-box' }} maxLength={9} />
        </Field>
        <Field label="Número">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="123" className="input" style={{ width: '100%', boxSizing: 'border-box' }} />
        </Field>
      </Row2>
      <Field label="Complemento (opcional)">
        <input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, bloco, casa..." className="input" style={{ width: '100%', boxSizing: 'border-box' }} />
      </Field>

      {/* Endereço resolvido — exibido como info, não input */}
      {cepFound && (
        <div style={{
          background: 'rgba(74,222,128,0.04)',
          border: '1px solid rgba(74,222,128,0.18)',
          borderRadius: 8, padding: '8px 12px',
          fontSize: 11.5, color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: -4,
        }}>
          <span style={{ color: '#4ade80', flexShrink: 0 }}><IconCheck size={11} /></span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {street}, {neighborhood} — {city}/{state}
          </span>
        </div>
      )}

      {error && <div style={{ marginTop: 8 }}><ErrorBanner text={error} /></div>}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <button onClick={onCancel} disabled={submitting} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '11px' }}>Cancelar</button>
        <button onClick={pay} disabled={submitting} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '11px', fontWeight: 700 }}>
          {submitting ? 'Processando...' : isFree ? 'Resgatar grátis' : 'Pagar com cartão'}
        </button>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{
    fontSize: 11, color: 'var(--text-secondary)',
    fontWeight: 700,
    margin: '12px 0 8px',
    paddingBottom: 6,
    borderBottom: '1px solid var(--border)',
    letterSpacing: '0.02em',
  }}>
    {children}
  </p>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

const Row2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div>
);

const Row3: React.FC<{ children: React.ReactNode; cols?: string }> = ({ children, cols }) => (
  <div style={{ display: 'grid', gridTemplateColumns: cols || '1fr 1fr 1fr', gap: 8 }}>{children}</div>
);

export default PaymentModal;
