import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconCopy, IconAlert } from './Icons';

interface ProductInfo {
  type: string;
  name: string;
  price: number;        // pode ser fallback; será atualizado do servidor ao abrir
  description?: string;
}

interface Props {
  product: ProductInfo;
  productRef?: string;          // p/ denuvo: gameId
  licenseKey: string;
  licenseName?: string | null;
  onClose: () => void;
  onPaid?: (txid: string) => void;
}

type Stage =
  | { kind: 'checkout' }
  | { kind: 'qrcode'; order: NonNullable<Awaited<ReturnType<NonNullable<typeof window.electron.pixCreateOrder>>>['order']>; free?: boolean }
  | { kind: 'paid'; txid: string };

const PixPurchaseModal: React.FC<Props> = ({ product, productRef, licenseKey, licenseName, onClose, onPaid }) => {
  const [stage, setStage] = useState<Stage>({ kind: 'checkout' });
  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    message?: string;
    discountedPrice?: number;
    free?: boolean;
  }>({ status: 'idle' });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Preço sempre vem do servidor (products) na hora de abrir o modal — fonte da verdade
  const [serverPrice, setServerPrice] = useState<number>(product.price);
  const [serverName, setServerName] = useState<string>(product.name);
  const [loadingPrice, setLoadingPrice] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadingPrice(true);
    window.electron.productsList()
      .then((r) => {
        if (!active) return;
        if (r.success && r.products) {
          const p = r.products.find((x) => x.type === product.type);
          if (p) {
            setServerPrice(Number(p.price));
            setServerName(p.name);
          }
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
      setCouponState({
        status: 'valid',
        message: 'Cupom de 100%! Será liberado direto',
        discountedPrice: 0,
        free: true,
      });
    } else {
      setCouponState({
        status: 'valid',
        message: r.discount_type === 'percent' ? `-${discount}%` : `-R$ ${discount.toFixed(2)}`,
        discountedPrice: Math.max(0.01, +raw.toFixed(2)),
        free: false,
      });
    }
  }

  async function confirmPayment() {
    setProcessing(true);
    setError(null);
    const r = await window.electron.pixCreateOrder({
      licenseKey,
      licenseName: licenseName || undefined,
      productType: product.type,
      productRef,
      couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
    });
    setProcessing(false);
    if (!r.success || !r.order) {
      setError(r.error || 'Não foi possível processar sua compra');
      return;
    }
    if ((r as any).free === true) {
      // Cupom 100% off — já liberou
      setStage({ kind: 'paid', txid: r.order.txid });
      onPaid?.(r.order.txid);
      return;
    }
    setStage({ kind: 'qrcode', order: r.order });
  }

  // Polling quando está em qrcode
  useEffect(() => {
    if (stage.kind !== 'qrcode') return;
    let active = true;
    const txid = stage.order.txid;
    const poll = async () => {
      const r = await window.electron.pixCheckStatus(txid);
      if (!active) return;
      if (r.success && r.paid) {
        setStage({ kind: 'paid', txid });
        onPaid?.(txid);
      }
    };
    const id = setInterval(poll, 5000);
    poll();
    return () => { active = false; clearInterval(id); };
  }, [stage]);

  function copyCode() {
    if (stage.kind !== 'qrcode') return;
    navigator.clipboard.writeText(stage.order.qrCodeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          style={{
            position: 'relative',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            width: 440, maxWidth: '100%',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          }}
        >
          <PixCloseX onClose={onClose} disabled={processing} />
          {stage.kind === 'paid' ? (
            <div style={{ padding: '28px 24px', textAlign: 'center' }}>
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
                style={{ width: 64, height: 64, borderRadius: '50%', background: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#062b15' }}
              >
                <IconCheck size={30} />
              </motion.div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                {isFree ? 'Liberado com cupom!' : 'Pagamento confirmado!'}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 18px', lineHeight: 1.55 }}>
                {product.type === 'denuvo'
                  ? 'Recebemos seu pedido. Em até 2 dias úteis entraremos em contato.'
                  : 'Sua permissão foi liberada automaticamente. Pode usar agora!'}
              </p>
              <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
                Fechar
              </button>
            </div>
          ) : stage.kind === 'qrcode' ? (
            <div style={{ padding: '20px 22px 22px' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px' }}>
                Pagamento via PIX
              </p>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>{serverName}</h3>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' }}>
                R$ {stage.order.amount.toFixed(2).replace('.', ',')}
              </p>

              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ padding: 10, background: '#fff', borderRadius: 10 }}>
                  <img src={stage.order.qrCodeImage} alt="QR Code PIX" style={{ width: 180, height: 180, display: 'block' }} />
                </div>
              </div>

              <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
                Aponte a câmera do banco ou use o Pix Copia e Cola
              </p>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Pix Copia e Cola</span>
                  <button
                    onClick={copyCode}
                    className="btn-ghost"
                    style={{ padding: '5px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
                    {copied ? 'Copiado' : 'Copiar código'}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={stage.order.qrCodeText}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    width: '100%', height: 56, resize: 'none', boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '8px 10px', color: 'var(--text-secondary)', fontSize: 10.5,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.45,
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.4 }}>
                  Copie o código, abra o Pix no app do banco e cole na opção Pix Copia e Cola.
                </p>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                background: 'rgba(124,92,252,0.05)', border: '1px solid rgba(124,92,252,0.18)',
                borderRadius: 8, marginBottom: 12,
              }}>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 } as React.CSSProperties} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Aguardando confirmação...
                </span>
              </div>

              <button onClick={onClose} className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                Pagar mais tarde
              </button>
            </div>
          ) : (
            <div style={{ padding: '22px 24px 24px' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px' }}>
                Checkout
              </p>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                {serverName}
              </h3>
              {product.description && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                  {product.description}
                </p>
              )}

              {/* Cupom */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Cupom de desconto (opcional)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={coupon}
                    onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponState({ status: 'idle' }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyCoupon(); }}
                    placeholder="DIGITE O CUPOM"
                    className="input"
                    style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    disabled={processing}
                  />
                  <button
                    onClick={applyCoupon}
                    disabled={processing || couponState.status === 'checking' || !coupon.trim()}
                    className="btn-ghost"
                    style={{ padding: '0 14px', fontSize: 11 }}
                  >
                    {couponState.status === 'checking' ? '...' : 'Aplicar'}
                  </button>
                </div>
                {couponState.status === 'valid' && (
                  <p style={{ fontSize: 11, color: '#4ade80', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <IconCheck size={11} /> {couponState.message}
                  </p>
                )}
                {couponState.status === 'invalid' && (
                  <p style={{ fontSize: 11, color: '#ff4d8a', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <IconAlert size={11} /> {couponState.message}
                  </p>
                )}
              </div>

              {/* Resumo */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>Subtotal</span>
                  <span>{loadingPrice ? '...' : `R$ ${basePrice.toFixed(2).replace('.', ',')}`}</span>
                </div>
                {couponState.status === 'valid' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: '#4ade80' }}>
                    <span>Desconto</span>
                    <span>−R$ {(basePrice - finalPrice).toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
                <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>Total</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {loadingPrice ? '...' : isFree ? 'Grátis' : `R$ ${finalPrice.toFixed(2).replace('.', ',')}`}
                  </span>
                </div>
              </div>

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ff4d8a', marginBottom: 10, padding: '8px 10px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.20)', borderRadius: 7 }}>
                  <IconAlert size={11} /> {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} disabled={processing} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px' }}>
                  Cancelar
                </button>
                <button
                  onClick={confirmPayment}
                  disabled={processing || loadingPrice}
                  className="btn-primary"
                  style={{
                    flex: 2, justifyContent: 'center', padding: '10px',
                    cursor: processing || loadingPrice ? 'wait' : 'pointer',
                    opacity: processing || loadingPrice ? 0.7 : 1,
                  }}
                >
                  {loadingPrice ? 'Carregando...' : processing ? 'Processando...' : isFree ? 'Resgatar grátis' : 'Gerar PIX'}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const PixCloseX: React.FC<{ onClose: () => void; disabled?: boolean }> = ({ onClose, disabled }) => (
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

export default PixPurchaseModal;
