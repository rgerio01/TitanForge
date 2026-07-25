import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconCopy, IconAlert } from './Icons';
import { formatPhone, phoneDigits } from '../utils/phone';
import { formatCardNumber, formatExpiry, formatCpf, formatCep, detectBrand, brandLabel, parseExpiry, isValidCpf, digits, type CardBrand } from '../utils/card';
import { tokenizeCard } from '../utils/efiTokenize';

interface Props {
  onClose: () => void;
  onLicenseCreated: (licenseKey: string) => void;
}

type Tab = 'pix' | 'card';
type Stage = 'form' | 'qrcode' | 'success';

interface OrderInfo {
  txid: string;
  amount: number;
  originalAmount: number;
  qrCodeText: string;
  qrCodeImage: string;
  expiresAt: string;
  couponCode: string | null;
}

const SignupModal: React.FC<Props> = ({ onClose, onLicenseCreated }) => {
  const [tab, setTab] = useState<Tab>('pix');
  const [stage, setStage] = useState<Stage>('form');

  // Dados pessoais (compartilhados)
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [numero, setNumero] = useState('');
  const [numeroConfirm, setNumeroConfirm] = useState('');
  const [coupon, setCoupon] = useState('');
  const [referral, setReferral] = useState('');
  const [referralStatus, setReferralStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [referrerName, setReferrerName] = useState('');
  const [couponState, setCouponState] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    message?: string;
    discountedPrice?: number;
    free?: boolean;
  }>({ status: 'idle' });

  // PIX result
  const [order, setOrder] = useState<OrderInfo | null>(null);

  // Cartão
  const [cardNumber, setCardNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cpf, setCpf] = useState('');
  const [cep, setCep] = useState('');
  const [num, setNum] = useState('');
  const [complement, setComplement] = useState('');
  const [street, setStreet] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepFound, setCepFound] = useState(false);
  const [installments, setInstallments] = useState<number>(1);
  const [installmentOptions, setInstallmentOptions] = useState<Array<{ installments: number; total_value_cents: number; installment_value_cents: number; has_interest: boolean }>>([]);
  const [loadingInst, setLoadingInst] = useState(false);

  // Estado geral
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Preço
  const [priceBase, setPriceBase] = useState<number>(0);
  const [loadingPrice, setLoadingPrice] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadingPrice(true);
    window.electron.productsList()
      .then((r) => {
        if (!active) return;
        if (r.success && r.products) {
          const p = r.products.find((x) => x.type === 'licenca_vitalicia');
          if (p) setPriceBase(Number(p.price));
        }
      })
      .finally(() => { if (active) setLoadingPrice(false); });
    return () => { active = false; };
  }, []);

  const finalPrice = couponState.discountedPrice ?? priceBase;
  const isFree = couponState.free === true;
  const brand = useMemo<CardBrand>(() => detectBrand(cardNumber), [cardNumber]);
  const cardDigits = digits(cardNumber);
  const cardOk = cardDigits.length >= 13 && cardDigits.length <= 19 && brand !== 'unknown';

  // Auto-busca CEP
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
          setStreet(r.street || ''); setNeighborhood(r.neighborhood || '');
          setCity(r.city || ''); setState(r.state || '');
          setCepFound(true);
        }
      })
      .finally(() => { if (active) setCepLoading(false); });
    return () => { active = false; };
  }, [cep]);

  // Parcelas (cartão)
  useEffect(() => {
    if (tab !== 'card' || !cardOk || isFree) { setInstallmentOptions([]); return; }
    let active = true;
    setLoadingInst(true);
    window.electron.cardInstallments({
      productType: 'licenca_vitalicia',
      couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
      brand,
    }).then((r) => {
      if (!active) return;
      if (r.success && r.options) setInstallmentOptions(r.options);
      else setInstallmentOptions([]);
    }).finally(() => { if (active) setLoadingInst(false); });
    return () => { active = false; };
  }, [tab, brand, cardOk, isFree, couponState.status, coupon]);

  async function checkReferral() {
    const code = referral.trim().toUpperCase();
    if (!code) { setReferralStatus('idle'); return; }
    const r = await window.electron.referralValidateCode(code);
    if (r.success) { setReferralStatus('valid'); setReferrerName(r.referrerName || 'amigo'); }
    else setReferralStatus('invalid');
  }

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code) { setCouponState({ status: 'idle' }); return; }
    setCouponState({ status: 'checking' });
    const r = await window.electron.couponValidate(code, 'licenca_vitalicia');
    if (!r.success || !r.discount_type || r.discount_value == null) {
      setCouponState({ status: 'invalid', message: r.message || 'Cupom inválido' });
      return;
    }
    const discount = Number(r.discount_value);
    const raw = r.discount_type === 'percent' ? priceBase * (1 - discount / 100) : priceBase - discount;
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

  function validateCommonFields(): string | null {
    if (!nome.trim() || nome.trim().split(/\s+/).length < 2) return 'Informe seu nome completo';
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return 'E-mail inválido';
    if (phoneDigits(numero).length !== 11) return 'Telefone deve ter 11 dígitos';
    if (phoneDigits(numero) !== phoneDigits(numeroConfirm)) return 'Os telefones não coincidem';
    return null;
  }

  function validateCardFields(): string | null {
    if (!cardOk) return 'Número do cartão inválido';
    if (!holder.trim() || holder.trim().split(/\s+/).length < 2) return 'Nome impresso completo';
    const ex = parseExpiry(expiry);
    if (!ex) return 'Validade inválida (MM/AA)';
    const now = new Date();
    const expY = parseInt(ex.yyyy, 10), expM = parseInt(ex.mm, 10);
    if (expY < now.getFullYear() || (expY === now.getFullYear() && expM < now.getMonth() + 1)) return 'Cartão vencido';
    const cvvLen = brand === 'amex' ? 4 : 3;
    if (cvv.replace(/\D/g, '').length !== cvvLen) return `CVV deve ter ${cvvLen} dígitos`;
    if (!isValidCpf(cpf)) return 'CPF inválido';
    if (digits(cep).length !== 8) return 'CEP inválido';
    if (!num.trim()) return 'Número do endereço';
    if (!street || !neighborhood || !city || !state) return 'Endereço incompleto (verifique o CEP)';
    if (!installments) return 'Escolha o parcelamento';
    return null;
  }

  async function submitPix() {
    const v = validateCommonFields();
    if (v) { setError(v); return; }
    setError(null);
    setProcessing(true);
    const r = await window.electron.signupCreatePix({
      nome: nome.trim(), email: email.trim(), numero: numero.trim(),
      referredBy: referralStatus === 'valid' ? referral.trim().toUpperCase() : undefined,
      couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
    });
    setProcessing(false);
    if (!r.success) { setError(r.error || 'Falha'); return; }
    if (r.free && r.licenseKey) { setLicenseKey(r.licenseKey); setStage('success'); return; }
    if (r.order) { setOrder(r.order); setStage('qrcode'); }
  }

  async function submitCard() {
    const c = validateCommonFields();
    if (c) { setError(c); return; }
    const cd = validateCardFields();
    if (cd) { setError(cd); return; }
    setError(null);
    setProcessing(true);
    try {
      const ex = parseExpiry(expiry)!;
      const token = await tokenizeCard({
        brand, number: cardDigits, cvv: cvv.replace(/\D/g, ''),
        expiration_month: ex.mm, expiration_year: ex.yyyy, holder_name: holder.trim(),
      });
      const r = await window.electron.signupCreateCard({
        nome: nome.trim(), email: email.trim(), numero: numero.trim(),
        referredBy: referralStatus === 'valid' ? referral.trim().toUpperCase() : undefined,
        couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
        installments,
        brand,
        paymentToken: token.token,
        cpf: digits(cpf),
        billingAddress: {
          street, number: num.trim(), neighborhood,
          zipcode: digits(cep), city, state,
          ...(complement.trim() ? { complement: complement.trim() } : {}),
        },
      });
      setProcessing(false);
      if (!r.success || !r.licenseKey) { setError(r.error || 'Pagamento recusado'); return; }
      setLicenseKey(r.licenseKey);
      setStage('success');
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message || 'Falha ao validar o cartão');
    }
  }

  // Polling do PIX
  useEffect(() => {
    if (stage !== 'qrcode' || !order) return;
    let active = true;
    const poll = async () => {
      const r = await window.electron.signupCheckStatus(order.txid);
      if (!active) return;
      if (r.success && r.paid && r.licenseKey) { setLicenseKey(r.licenseKey); setStage('success'); }
    };
    const id = setInterval(poll, 5000);
    poll();
    return () => { active = false; clearInterval(id); };
  }, [stage, order]);

  function copyKey() {
    if (!licenseKey) return;
    navigator.clipboard.writeText(licenseKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  function copyPix() {
    if (!order) return;
    navigator.clipboard.writeText(order.qrCodeText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const modalWidth = stage === 'form' && tab === 'card' ? 760 : 460;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0, width: modalWidth }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          style={{
            position: 'relative',
            background: '#0d0d12',
            border: '1px solid rgba(124,92,252,0.22)',
            borderRadius: 14,
            maxWidth: '96vw',
            maxHeight: '94vh',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,0.65)',
          }}
        >
          {stage !== 'success' && <SignupCloseX onClose={onClose} disabled={processing} />}
          {stage === 'success' && licenseKey ? (
            <SuccessView licenseKey={licenseKey} copied={copied} onCopy={copyKey} onEnter={() => onLicenseCreated(licenseKey)} />
          ) : stage === 'qrcode' && order ? (
            <PixView order={order} copied={copied} onCopy={copyPix} onClose={onClose} />
          ) : (
            <FormView
              tab={tab} setTab={setTab}
              nome={nome} setNome={setNome}
              email={email} setEmail={setEmail}
              numero={numero} setNumero={setNumero}
              numeroConfirm={numeroConfirm} setNumeroConfirm={setNumeroConfirm}
              coupon={coupon} setCoupon={(v: string) => { setCoupon(v); setCouponState({ status: 'idle' }); }}
              applyCoupon={applyCoupon}
              couponState={couponState}
              referral={referral} setReferral={setReferral}
              referralStatus={referralStatus} setReferralStatus={setReferralStatus}
              referrerName={referrerName}
              checkReferral={checkReferral}
              loadingPrice={loadingPrice}
              priceBase={priceBase}
              finalPrice={finalPrice}
              isFree={isFree}
              error={error}
              processing={processing}
              onClose={onClose}
              onSubmitPix={submitPix}
              onSubmitCard={submitCard}
              // Campos do cartão
              cardNumber={cardNumber} setCardNumber={setCardNumber}
              brand={brand}
              holder={holder} setHolder={setHolder}
              expiry={expiry} setExpiry={setExpiry}
              cvv={cvv} setCvv={setCvv}
              cpf={cpf} setCpf={setCpf}
              cep={cep} setCep={setCep}
              num={num} setNum={setNum}
              complement={complement} setComplement={setComplement}
              street={street} neighborhood={neighborhood} city={city} state={state}
              cepLoading={cepLoading} cepFound={cepFound}
              installments={installments} setInstallments={setInstallments}
              installmentOptions={installmentOptions}
              loadingInst={loadingInst}
              cardOk={cardOk}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ────── CLOSE X (canto inferior direito) ──────

const SignupCloseX: React.FC<{ onClose: () => void; disabled?: boolean }> = ({ onClose, disabled }) => (
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
      border: '1px solid rgba(124,92,252,0.22)',
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
      e.currentTarget.style.borderColor = 'rgba(124,92,252,0.22)';
    }}
  >
    ×
  </button>
);

// ────── SUBVIEWS ──────

const SuccessView: React.FC<{ licenseKey: string; copied: boolean; onCopy: () => void; onEnter: () => void }> = ({ licenseKey, copied, onCopy, onEnter }) => (
  <div style={{ padding: '28px 26px', textAlign: 'center' }}>
    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
      style={{ width: 64, height: 64, borderRadius: '50%', background: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#062b15' }}>
      <IconCheck size={30} />
    </motion.div>
    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>Bem-vindo ao Umbra!</h3>
    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: '0 0 18px', lineHeight: 1.55 }}>
      Sua licença foi criada. Use a chave abaixo para fazer login.
    </p>
    <div style={{ background: 'rgba(124,92,252,0.05)', border: '1px solid rgba(124,92,252,0.22)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ flex: 1, fontSize: 13, color: '#fff', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{licenseKey}</span>
      <button onClick={onCopy} style={{ padding: '6px 10px', background: copied ? 'rgba(74,222,128,0.10)' : 'rgba(124,92,252,0.14)', border: `1px solid ${copied ? 'rgba(74,222,128,0.32)' : 'rgba(124,92,252,0.32)'}`, borderRadius: 6, color: copied ? '#4ade80' : '#c084fc', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        {copied ? <IconCheck size={10} /> : <IconCopy size={10} />} {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
    <button onClick={onEnter} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif', boxShadow: '0 4px 20px rgba(124,92,252,0.30)' }}>
      Entrar com esta licença
    </button>
  </div>
);

const PixView: React.FC<{ order: OrderInfo; copied: boolean; onCopy: () => void; onClose: () => void }> = ({ order, copied, onCopy, onClose }) => (
  <div style={{ padding: '20px 24px 22px' }}>
    <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px', fontWeight: 700 }}>Pagamento via PIX</p>
    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 4px' }}>Licença Vitalícia Umbra</h3>
    <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 14px' }}>R$ {order.amount.toFixed(2).replace('.', ',')}</p>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
      <div style={{ padding: 10, background: '#fff', borderRadius: 10 }}>
        <img src={order.qrCodeImage} alt="QR Code PIX" style={{ width: 180, height: 180, display: 'block' }} />
      </div>
    </div>
    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'center', margin: '0 0 10px' }}>
      Aponte a câmera do banco ou use o Pix Copia e Cola
    </p>
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pix Copia e Cola</span>
        <button onClick={onCopy} className="btn-ghost" style={{ padding: '5px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
          {copied ? <IconCheck size={10} /> : <IconCopy size={10} />} {copied ? 'Copiado' : 'Copiar código'}
        </button>
      </div>
      <textarea
        readOnly
        value={order.qrCodeText}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: '100%', height: 56, resize: 'none', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, padding: '8px 10px', color: 'rgba(255,255,255,0.65)', fontSize: 10.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.45,
          outline: 'none',
        }}
      />
      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.40)', margin: '6px 0 0', lineHeight: 1.4 }}>
        Copie o código, abra o Pix no app do banco e cole na opção Pix Copia e Cola.
      </p>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(124,92,252,0.06)', border: '1px solid rgba(124,92,252,0.18)', borderRadius: 8, marginBottom: 10 }}>
      <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 } as React.CSSProperties} />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', flex: 1 }}>Aguardando pagamento... sua licença será gerada automaticamente</span>
    </div>
    <button onClick={onClose} className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Fechar</button>
  </div>
);

// ────── FORM VIEW (com tabs) ──────

const FormView: React.FC<any> = (p) => (
  <>
    <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, margin: 0 }}>Novo cadastro</p>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '2px 0 0', fontFamily: 'Syne, sans-serif' }}>Adquira sua licença vitalícia</h3>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', margin: '4px 0 0' }}>Pagamento seguro · Licença gerada automaticamente</p>
    </div>

    {/* Tabs */}
    <div style={{ display: 'flex', padding: '12px 24px 0', gap: 6 }}>
      <TabButton active={p.tab === 'pix'} onClick={() => p.setTab('pix')} icon="⚡">PIX</TabButton>
      <TabButton active={p.tab === 'card'} onClick={() => p.setTab('card')} icon="💳">Cartão (até 12x)</TabButton>
    </div>

    {p.tab === 'pix' ? (
      <div className="custom-scrollbar" style={{ overflowY: 'auto', padding: '14px 24px 0' }}>
        <PersonalFields {...p} />
        <CouponBlock {...p} />
        <ReferralBlock {...p} />
        <SummaryBlock {...p} />
        {p.error && <ErrorBlock text={p.error} />}
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', minHeight: 0 }}>
        <div className="custom-scrollbar" style={{ overflowY: 'auto', padding: '14px 6px 14px 24px', maxHeight: '70vh' }}>
          <PersonalFields {...p} />
          <CardFields {...p} />
          <AddressFields {...p} />
          {p.error && <ErrorBlock text={p.error} />}
        </div>
        <div style={{ background: 'rgba(124,92,252,0.03)', borderLeft: '1px solid rgba(255,255,255,0.05)', padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CouponBlock {...p} />
          <ReferralBlock {...p} />
          <SummaryBlock {...p} />
          <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.18)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🛡️</span>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: '#fff' }}>Pagamento seguro</strong> com antifraude. Cartão tokenizado pela EFI Bank.
            </p>
          </div>
        </div>
      </div>
    )}

    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '14px 24px 16px', display: 'flex', gap: 8 }}>
      <button onClick={p.onClose} disabled={p.processing} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px' }}>Cancelar</button>
      <button
        onClick={p.tab === 'pix' ? p.onSubmitPix : p.onSubmitCard}
        disabled={p.processing || p.loadingPrice}
        style={{
          flex: 2, padding: '10px',
          background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)',
          border: 'none', borderRadius: 10, color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: p.processing || p.loadingPrice ? 'wait' : 'pointer',
          fontFamily: 'Syne, sans-serif',
          boxShadow: '0 4px 20px rgba(124,92,252,0.30)',
          opacity: p.processing || p.loadingPrice ? 0.7 : 1,
        }}
      >
        {p.loadingPrice ? 'Carregando...' : p.processing ? 'Processando...' : p.isFree ? 'Resgatar grátis' : p.tab === 'pix' ? 'Gerar PIX' : 'Pagar com cartão'}
      </button>
    </div>
  </>
);

// ────── BLOCKS ──────

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; icon?: string }> = ({ active, onClick, children, icon }) => (
  <button onClick={onClick} style={{
    flex: 1, padding: '10px 12px', fontSize: 12.5,
    background: active ? 'rgba(124,92,252,0.10)' : 'rgba(255,255,255,0.02)',
    border: `1px solid ${active ? 'rgba(124,92,252,0.40)' : 'rgba(255,255,255,0.06)'}`,
    borderRadius: 8, color: active ? '#fff' : 'rgba(255,255,255,0.45)',
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 700 : 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }}>
    {icon && <span style={{ fontSize: 14 }}>{icon}</span>}{children}
  </button>
);

const PersonalFields: React.FC<any> = (p) => (
  <>
    <Field label="Nome completo" value={p.nome} onChange={p.setNome} placeholder="João Silva" />
    <Field label="E-mail" value={p.email} onChange={p.setEmail} placeholder="seu@email.com" type="email" />
    <Row2>
      <Field label="Telefone celular" value={p.numero} onChange={(v: string) => p.setNumero(formatPhone(v))} placeholder="(41) 9 9119-7816" />
      <Field label="Confirme o telefone" value={p.numeroConfirm} onChange={(v: string) => p.setNumeroConfirm(formatPhone(v))} placeholder="Digite novamente" />
    </Row2>
    {p.numero && p.numeroConfirm && phoneDigits(p.numero) === phoneDigits(p.numeroConfirm) && phoneDigits(p.numero).length === 11 && (
      <p style={{ fontSize: 11, color: '#4ade80', margin: '-4px 0 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconCheck size={11} /> Telefones conferem
      </p>
    )}
  </>
);

const CardFields: React.FC<any> = (p) => (
  <>
    <SectionLabel>💳 Dados do cartão</SectionLabel>
    <Field label={`Número do cartão${p.brand !== 'unknown' ? ` · ${brandLabel(p.brand)}` : ''}`} value={p.cardNumber} onChange={(v: string) => p.setCardNumber(formatCardNumber(v))} placeholder="0000 0000 0000 0000" maxLength={23} mono />
    <Field label="Nome impresso no cartão" value={p.holder} onChange={(v: string) => p.setHolder(v.toUpperCase())} placeholder="NOME COMPLETO" upper />
    <Row3>
      <Field label="Validade" value={p.expiry} onChange={(v: string) => p.setExpiry(formatExpiry(v))} placeholder="MM/AA" maxLength={5} />
      <Field label={`CVV (${p.brand === 'amex' ? '4' : '3'})`} value={p.cvv} onChange={(v: string) => p.setCvv(v.replace(/\D/g, '').slice(0, p.brand === 'amex' ? 4 : 3))} placeholder="123" type="password" />
      <Field label="Parcelas">
        {p.loadingInst ? (
          <div style={{ height: 36, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 2 } as React.CSSProperties} />
          </div>
        ) : p.installmentOptions.length === 0 ? (
          <input className="input" disabled placeholder={p.cardOk ? '...' : 'Cartão →'} style={{ width: '100%', boxSizing: 'border-box' }} />
        ) : (
          <select value={p.installments} onChange={(e: any) => p.setInstallments(parseInt(e.target.value, 10))} className="input" style={{ width: '100%', boxSizing: 'border-box' }}>
            {p.installmentOptions.map((opt: any) => {
              const each = opt.installment_value_cents / 100;
              return <option key={opt.installments} value={opt.installments}>{opt.installments}x R$ {each.toFixed(2).replace('.', ',')} {opt.has_interest ? '(c/ juros)' : ''}</option>;
            })}
          </select>
        )}
      </Field>
    </Row3>
  </>
);

const AddressFields: React.FC<any> = (p) => (
  <>
    <SectionLabel>📍 Endereço de cobrança</SectionLabel>
    <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.40)', margin: '-2px 0 8px' }}>Digite o CEP — o restante é preenchido automaticamente.</p>
    <Row3 cols="120px 1fr 110px">
      <Field label={p.cepLoading ? 'CEP · buscando' : p.cepFound ? 'CEP · ✓' : 'CEP'} value={p.cep} onChange={(v: string) => p.setCep(formatCep(v))} placeholder="00000-000" maxLength={9} />
      <Field label="Número" value={p.num} onChange={p.setNum} placeholder="123" />
      <Field label="CPF" value={p.cpf} onChange={(v: string) => p.setCpf(formatCpf(v))} placeholder="000.000.000-00" maxLength={14} />
    </Row3>
    <Field label="Complemento (opcional)" value={p.complement} onChange={p.setComplement} placeholder="Apto, bloco..." />
    {p.cepFound && (
      <div style={{ background: 'rgba(74,222,128,0.04)', border: '1px solid rgba(74,222,128,0.18)', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
        <span style={{ color: '#4ade80', flexShrink: 0 }}><IconCheck size={11} /></span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.street}, {p.neighborhood} — {p.city}/{p.state}</span>
      </div>
    )}
  </>
);

const CouponBlock: React.FC<any> = (p) => (
  <div>
    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Cupom (opcional)</label>
    <div style={{ display: 'flex', gap: 6 }}>
      <input value={p.coupon} onChange={(e) => p.setCoupon(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') p.applyCoupon(); }} placeholder="DIGITE O CUPOM" className="input" style={{ flex: 1, textTransform: 'uppercase' }} disabled={p.processing} />
      <button onClick={p.applyCoupon} disabled={!p.coupon.trim() || p.processing || p.couponState.status === 'checking'} className="btn-ghost" style={{ padding: '0 12px', fontSize: 11 }}>
        {p.couponState.status === 'checking' ? '...' : 'Aplicar'}
      </button>
    </div>
    {p.couponState.status === 'valid' && <p style={{ fontSize: 11, color: '#4ade80', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><IconCheck size={11} /> {p.couponState.message}</p>}
    {p.couponState.status === 'invalid' && <p style={{ fontSize: 11, color: '#ff4d8a', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><IconAlert size={11} /> {p.couponState.message}</p>}
  </div>
);

const ReferralBlock: React.FC<any> = (p) => (
  <div>
    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Código de amigo (opcional)</label>
    <input value={p.referral} onChange={(e) => { p.setReferral(e.target.value.toUpperCase()); p.setReferralStatus('idle'); }} onBlur={p.checkReferral} placeholder="ABCD1234" className="input" style={{ width: '100%', boxSizing: 'border-box', textTransform: 'uppercase' }} disabled={p.processing} />
    {p.referralStatus === 'valid' && <p style={{ fontSize: 11, color: '#4ade80', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><IconCheck size={11} /> Indicado por <strong>{p.referrerName}</strong></p>}
    {p.referralStatus === 'invalid' && <p style={{ fontSize: 11, color: '#ff4d8a', marginTop: 4 }}>Código não encontrado</p>}
  </div>
);

const SummaryBlock: React.FC<any> = (p) => (
  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
      <span>Subtotal</span><span>{p.loadingPrice ? '...' : `R$ ${p.priceBase.toFixed(2).replace('.', ',')}`}</span>
    </div>
    {p.couponState.status === 'valid' && (
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#4ade80', marginBottom: 4 }}>
        <span>Desconto</span><span>−R$ {(p.priceBase - p.finalPrice).toFixed(2).replace('.', ',')}</span>
      </div>
    )}
    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>Total</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: 'Syne, sans-serif' }}>
        {p.loadingPrice ? '...' : p.isFree ? 'Grátis' : `R$ ${p.finalPrice.toFixed(2).replace('.', ',')}`}
      </span>
    </div>
  </div>
);

const ErrorBlock: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ff4d8a', marginTop: 10, padding: '8px 10px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.20)', borderRadius: 7 }}>
    <IconAlert size={11} /> {text}
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700, margin: '12px 0 8px', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{children}</p>
);

const Field: React.FC<{ label: string; value?: string; onChange?: (v: string) => void; placeholder?: string; type?: string; maxLength?: number; mono?: boolean; upper?: boolean; children?: React.ReactNode }> = ({ label, value, onChange, placeholder, type, maxLength, mono, upper, children }) => (
  <div style={{ marginBottom: 9 }}>
    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>{label}</label>
    {children || (
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        type={type || 'text'}
        maxLength={maxLength}
        className="input"
        style={{
          width: '100%', boxSizing: 'border-box',
          ...(mono ? { fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' } : {}),
          ...(upper ? { textTransform: 'uppercase' as const } : {}),
        }}
      />
    )}
  </div>
);

const Row2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div>
);
const Row3: React.FC<{ children: React.ReactNode; cols?: string }> = ({ children, cols }) => (
  <div style={{ display: 'grid', gridTemplateColumns: cols || '1fr 1fr 1fr', gap: 8 }}>{children}</div>
);

export default SignupModal;
