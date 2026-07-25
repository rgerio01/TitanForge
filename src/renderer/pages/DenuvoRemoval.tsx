import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconLock, IconAlert, IconCheck, IconCopy, IconSearch } from '../components/Icons';
import { listDenuvoGames, validateCoupon, createDenuvoOrder, checkOrderStatus, type DenuvoGameWithThumb } from '../services/denuvo';

interface DenuvoRemovalProps {
  licenseKey: string;
  licenseName?: string | null;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'terms'; game: DenuvoGameWithThumb }
  | { kind: 'checkout'; game: DenuvoGameWithThumb }
  | { kind: 'qrcode'; game: DenuvoGameWithThumb; order: NonNullable<Awaited<ReturnType<typeof createDenuvoOrder>>['order']> };

const TERMS = [
  'A remoção da proteção Denuvo pode ser concluída em até 2 dias úteis (na maioria dos casos é entregue no mesmo dia).',
  'O jogo funciona apenas no modo offline. Recursos online não estarão disponíveis.',
  'Após a confirmação do pagamento não há possibilidade de estorno ou troca por outros conteúdos do Umbra Launcher.',
  'O jogo é entregue como uma cópia validada por um sistema de licenciamento oficial alternativo.',
];

const TIPS = [
  'O launcher pode pausar atualizações automáticas do Windows enquanto a licença estiver ativa.',
  'Inicie o jogo sempre como administrador, executando diretamente o .exe na pasta do jogo. Não inicie pela Steam para evitar verificação de arquivos.',
  'Não atualize o jogo caso a Steam solicite — atualizações podem invalidar a licença.',
  'Evite trocar componentes da máquina (GPU, CPU, RAM, placa-mãe) antes de concluir o jogo.',
];

const DenuvoRemoval: React.FC<DenuvoRemovalProps> = ({ licenseKey, licenseName }) => {
  const [games, setGames] = useState<DenuvoGameWithThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listDenuvoGames()
      .then((g) => { if (mounted) { setGames(g); setLoading(false); } })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return games;
    return games.filter(g => g.displayName.toLowerCase().includes(q) || g.game_id.includes(q));
  }, [games, filter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col"
    >
      {/* Hero / Banner */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(124,92,252,0.10) 0%, rgba(255,45,120,0.06) 100%)',
        border: '1px solid rgba(124,92,252,0.20)',
        borderRadius: '14px', padding: '18px 22px', marginBottom: '14px',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,92,252,0.20) 0%, transparent 70%)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 28px rgba(124,92,252,0.35)' }}>
            <IconLock size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 2, fontWeight: 700 }}>Remoção de Proteção</p>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>Remover Denuvo</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', margin: '3px 0 0' }}>
              Adquira uma licença alternativa para jogos com proteção Denuvo. Entrega rápida e segura.
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
            <IconSearch size={14} />
          </span>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Buscar jogos..."
            className="input"
            style={{ width: '100%', paddingLeft: 36 }}
          />
        </div>
        <span className="filter-pill" style={{ cursor: 'default' }}>
          <strong>{filtered.length}</strong> {filtered.length === 1 ? 'jogo' : 'jogos'}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {loading ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Carregando...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, opacity: 0.3 }}>
              <IconLock size={32} />
            </div>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Nenhum jogo disponível</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {filter ? 'Nenhum jogo corresponde à busca.' : 'Em breve adicionaremos novos jogos.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {filtered.map(g => (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                className="game-card group"
                style={{ position: 'relative' }}
              >
                <div className="badge badge-premium" style={{ position: 'absolute', top: 6, left: 6, zIndex: 2, background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', color: '#fff' }}>
                  DENUVO
                </div>

                <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden' }}>
                  <img src={g.thumbnail} alt={g.displayName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s ease' }}
                    className="group-hover:scale-[1.04]"
                    loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>

                <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.displayName}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>R$</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'Syne, sans-serif' }}>
                      {g.price.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                  <button
                    onClick={() => setModal({ kind: 'terms', game: g })}
                    style={{
                      width: '100%', padding: '8px 10px',
                      background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)',
                      border: 'none', borderRadius: 8, color: '#fff',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'Syne, sans-serif',
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                      boxShadow: '0 4px 16px rgba(124,92,252,0.30)',
                      transition: 'transform .15s, filter .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.10)'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                  >
                    Comprar
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal.kind === 'terms' && (
          <TermsModal
            game={modal.game}
            onClose={() => setModal({ kind: 'none' })}
            onAgree={() => setModal({ kind: 'checkout', game: modal.game })}
          />
        )}
        {modal.kind === 'checkout' && (
          <CheckoutModal
            game={modal.game}
            licenseKey={licenseKey}
            licenseName={licenseName || undefined}
            onClose={() => setModal({ kind: 'none' })}
            onPaymentReady={(order) => setModal({ kind: 'qrcode', game: modal.game, order })}
          />
        )}
        {modal.kind === 'qrcode' && (
          <QrCodeModal
            game={modal.game}
            order={modal.order}
            onClose={() => setModal({ kind: 'none' })}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ───────────────────────── TermsModal ─────────────────────────

interface TermsModalProps {
  game: DenuvoGameWithThumb;
  onClose: () => void;
  onAgree: () => void;
}
const TermsModal: React.FC<TermsModalProps> = ({ game, onClose, onAgree }) => {
  const TOTAL = 10;
  const [accepted, setAccepted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TOTAL);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const canClose = secondsLeft <= 0;
  const canConfirm = canClose && accepted;
  const progress = ((TOTAL - secondsLeft) / TOTAL) * 100;

  // SVG circle progress
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (secondsLeft / TOTAL);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(4,4,8,0.92)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        style={{
          position: 'relative',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          width: 520, maxWidth: '100%',
          maxHeight: '90vh', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Top progress bar — preenche conforme countdown */}
        <div style={{
          position: 'absolute', top: 0, left: 0, height: 2,
          width: `${progress}%`,
          background: canClose ? '#4ade80' : 'var(--accent)',
          transition: 'width 1s linear, background-color .4s ease',
          zIndex: 2,
        }} />

        {/* Header com countdown circular */}
        <div style={{ padding: '18px 22px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
            <svg width="52" height="52" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
              <circle cx="26" cy="26" r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth="3" fill="none" />
              <circle
                cx="26" cy="26" r={radius}
                stroke={canClose ? '#4ade80' : 'var(--accent)'}
                strokeWidth="3" fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke .4s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: canClose ? 11 : 18, fontWeight: 700,
              color: canClose ? '#4ade80' : 'var(--text-primary)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: canClose ? '0.04em' : '0',
              transition: 'all .25s ease',
            }}>
              {canClose ? 'OK' : secondsLeft}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 3px' }}>
              Antes de prosseguir
            </p>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {game.displayName}
            </h3>
          </div>
        </div>

        {/* Conteúdo scrollável */}
        <div className="custom-scrollbar" style={{ overflowY: 'auto', padding: '16px 22px' }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.6 }}>
            Reserve um momento para ler com atenção. Ao concordar, você declara estar ciente das condições abaixo.
          </p>

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, marginBottom: 8 }}>
              Termos
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {TERMS.map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>—</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.55 }}>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, marginBottom: 8 }}>
              Informações importantes
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {TIPS.map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>—</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer fixo com checkbox + ações */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 22px 16px', background: 'rgba(0,0,0,0.20)' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: canClose ? 'pointer' : 'not-allowed',
            padding: '8px 0', marginBottom: 12,
            opacity: canClose ? 1 : 0.5,
            transition: 'opacity .25s ease',
          }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={!canClose}
              style={{
                width: 15, height: 15,
                accentColor: 'var(--accent)',
                cursor: canClose ? 'pointer' : 'not-allowed',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Li e <strong>aceito os termos</strong> acima descritos
            </span>
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              disabled={!canClose}
              className="btn-ghost"
              style={{
                flex: 1, justifyContent: 'center', padding: '10px',
                opacity: canClose ? 1 : 0.5, cursor: canClose ? 'pointer' : 'not-allowed',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={onAgree}
              disabled={!canConfirm}
              className="btn-primary"
              style={{
                flex: 2, justifyContent: 'center', padding: '10px',
                opacity: canConfirm ? 1 : 0.4, cursor: canConfirm ? 'pointer' : 'not-allowed',
              }}
            >
              Concordar e prosseguir
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ───────────────────────── CheckoutModal ─────────────────────────

interface CheckoutModalProps {
  game: DenuvoGameWithThumb;
  licenseKey: string;
  licenseName?: string;
  onClose: () => void;
  onPaymentReady: (order: NonNullable<Awaited<ReturnType<typeof createDenuvoOrder>>['order']>) => void;
}
const CheckoutModal: React.FC<CheckoutModalProps> = ({ game, licenseKey, licenseName, onClose, onPaymentReady }) => {
  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    message?: string;
    discountedPrice?: number;
    discount_type?: 'percent' | 'fixed';
    discount_value?: number;
  }>({ status: 'idle' });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalPrice = couponState.discountedPrice ?? game.price;

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code) {
      setCouponState({ status: 'idle' });
      return;
    }
    setCouponState({ status: 'checking' });
    const r = await validateCoupon(code);
    if (!r.success || !r.discount_type || r.discount_value == null) {
      setCouponState({ status: 'invalid', message: r.message || 'Cupom inválido' });
      return;
    }
    const discount = Number(r.discount_value);
    const discounted = r.discount_type === 'percent'
      ? Math.max(0.01, +(game.price * (1 - discount / 100)).toFixed(2))
      : Math.max(0.01, +(game.price - discount).toFixed(2));
    setCouponState({
      status: 'valid',
      message: r.discount_type === 'percent' ? `-${discount}%` : `-R$ ${discount.toFixed(2)}`,
      discountedPrice: discounted,
      discount_type: r.discount_type,
      discount_value: discount,
    });
  }

  async function confirmPayment() {
    setProcessing(true);
    setError(null);
    const r = await createDenuvoOrder({
      licenseKey,
      licenseName,
      gameId: game.game_id,
      gameName: game.displayName,
      couponCode: couponState.status === 'valid' ? coupon.trim() : undefined,
    });
    setProcessing(false);
    if (!r.success || !r.order) {
      setError(r.error || 'Não foi possível processar sua compra');
      return;
    }
    onPaymentReady(r.order);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
        style={{
          background: 'linear-gradient(160deg, #0f0c18 0%, #0d0d14 100%)',
          border: '1px solid rgba(124,92,252,0.22)',
          borderRadius: 18, padding: 28, width: 480, maxWidth: '100%',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 24px 80px rgba(0,0,0,0.9)',
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginBottom: 4 }}>Checkout</p>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>{game.displayName}</h3>
        </div>

        {/* Cupom */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>
            Cupom de desconto (opcional)
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={coupon}
              onChange={e => { setCoupon(e.target.value.toUpperCase()); setCouponState({ status: 'idle' }); }}
              onKeyDown={e => { if (e.key === 'Enter') applyCoupon(); }}
              placeholder="DIGITE SEU CUPOM"
              className="input"
              style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              disabled={processing}
            />
            <button
              onClick={applyCoupon}
              disabled={processing || couponState.status === 'checking' || !coupon.trim()}
              style={{
                padding: '0 16px',
                background: 'rgba(124,92,252,0.12)',
                border: '1px solid rgba(124,92,252,0.30)',
                borderRadius: 8, color: '#c084fc',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              {couponState.status === 'checking' ? '...' : 'Aplicar'}
            </button>
          </div>
          {couponState.status === 'valid' && (
            <p style={{ fontSize: 11, color: '#4ade80', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconCheck size={11} /> Cupom aplicado: <strong>{couponState.message}</strong>
            </p>
          )}
          {couponState.status === 'invalid' && (
            <p style={{ fontSize: 11, color: '#ff4d8a', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconAlert size={11} /> {couponState.message}
            </p>
          )}
        </div>

        {/* Resumo */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)' }}>Subtotal</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>R$ {game.price.toFixed(2).replace('.', ',')}</span>
          </div>
          {couponState.status === 'valid' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#4ade80' }}>Desconto</span>
              <span style={{ fontSize: 12, color: '#4ade80' }}>−R$ {(game.price - finalPrice).toFixed(2).replace('.', ',')}</span>
            </div>
          )}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: 'Syne, sans-serif' }}>
              R$ {finalPrice.toFixed(2).replace('.', ',')}
            </span>
          </div>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ff4d8a', marginBottom: 12, padding: '8px 10px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.20)', borderRadius: 7 }}>
            <IconAlert size={11} /> {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={processing} className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
            Cancelar
          </button>
          <button
            onClick={confirmPayment}
            disabled={processing}
            style={{
              flex: 2, padding: 12,
              background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)',
              border: 'none', borderRadius: 10, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: processing ? 'wait' : 'pointer',
              fontFamily: 'Syne, sans-serif', letterSpacing: '0.04em',
              boxShadow: '0 4px 20px rgba(124,92,252,0.35)',
              opacity: processing ? 0.7 : 1,
            }}
          >
            {processing ? 'Gerando PIX...' : 'Gerar PIX'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ───────────────────────── QrCodeModal ─────────────────────────

interface QrCodeModalProps {
  game: DenuvoGameWithThumb;
  order: NonNullable<Awaited<ReturnType<typeof createDenuvoOrder>>['order']>;
  onClose: () => void;
}
const QrCodeModal: React.FC<QrCodeModalProps> = ({ game, order, onClose }) => {
  const [paid, setPaid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secondsToExpire, setSecondsToExpire] = useState(() => {
    const ms = new Date(order.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  });

  // Polling de pagamento (a cada 5s)
  useEffect(() => {
    if (paid) return;
    let mounted = true;
    const poll = async () => {
      const r = await checkOrderStatus(order.txid);
      if (!mounted) return;
      if (r.success && r.paid) setPaid(true);
    };
    const i = setInterval(poll, 5000);
    poll();
    return () => { mounted = false; clearInterval(i); };
  }, [order.txid, paid]);

  // Countdown de expiração
  useEffect(() => {
    if (secondsToExpire <= 0 || paid) return;
    const t = setTimeout(() => setSecondsToExpire(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsToExpire, paid]);

  function copyCode() {
    navigator.clipboard.writeText(order.qrCodeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const expMin = Math.floor(secondsToExpire / 60);
  const expSec = secondsToExpire % 60;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
        style={{
          background: 'linear-gradient(160deg, #0f0c18 0%, #0d0d14 100%)',
          border: paid ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(124,92,252,0.22)',
          borderRadius: 18, padding: 28, width: 460, maxWidth: '100%',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 24px 80px rgba(0,0,0,0.9)',
        }}
      >
        {paid ? (
          <div style={{ textAlign: 'center', padding: '14px 4px' }}>
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
              style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #4ade80, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 0 60px rgba(74,222,128,0.45)', color: '#062b15' }}
            >
              <IconCheck size={36} />
            </motion.div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>Pagamento confirmado!</h3>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 18px' }}>
              Recebemos o seu pagamento. Em até <strong style={{ color: '#c084fc' }}>2 dias úteis</strong> entraremos em contato com as instruções de instalação.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg, #4ade80, #22c55e)', border: 'none', borderRadius: 10, color: '#062b15', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 16, textAlign: 'center' }}>
              <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginBottom: 4 }}>Pagamento via PIX</p>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>{game.displayName}</h3>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '6px 0 0', fontFamily: 'Syne, sans-serif' }}>R$ {order.amount.toFixed(2).replace('.', ',')}</p>
            </div>

            {/* QR Code */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{ padding: 12, background: '#fff', borderRadius: 12 }}>
                <img src={order.qrCodeImage} alt="QR Code PIX" style={{ width: 200, height: 200, display: 'block' }} />
              </div>
            </div>

            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 12 }}>
              Aponte a câmera do banco ou use o Pix Copia e Cola
            </p>

            {/* Pix Copia e Cola */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pix Copia e Cola</span>
                <button
                  onClick={copyCode}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '6px 10px',
                    background: copied ? 'rgba(74,222,128,0.12)' : 'rgba(124,92,252,0.14)',
                    border: `1px solid ${copied ? 'rgba(74,222,128,0.32)' : 'rgba(124,92,252,0.32)'}`,
                    borderRadius: 6, color: copied ? '#4ade80' : '#c084fc',
                    fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif', letterSpacing: '0.04em', textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
                  {copied ? 'Copiado' : 'Copiar código'}
                </button>
              </div>
              <textarea
                readOnly
                value={order.qrCodeText}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%', height: 58, resize: 'none', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10, padding: '10px 12px', color: 'rgba(255,255,255,0.65)', fontSize: 10.5,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.45,
                  outline: 'none',
                }}
              />
              <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.40)', margin: '6px 0 0', lineHeight: 1.4 }}>
                Copie o código, abra o Pix no app do banco e cole na opção Pix Copia e Cola.
              </p>
            </div>

            {/* Status */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              background: 'rgba(124,92,252,0.06)',
              border: '1px solid rgba(124,92,252,0.18)',
              borderRadius: 8, marginBottom: 14,
            }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 } as React.CSSProperties} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', flex: 1 }}>
                Aguardando confirmação do pagamento...
              </span>
              {secondsToExpire > 0 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>
                  Expira em {expMin}:{String(expSec).padStart(2, '0')}
                </span>
              )}
            </div>

            <button onClick={onClose} className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
              Pagar mais tarde
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};

export default DenuvoRemoval;
