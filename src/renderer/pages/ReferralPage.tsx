import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCopy, IconCheck, IconUsers, IconAlert } from '../components/Icons';

interface Props {
  licenseKey: string;
}

interface ReferralInfo {
  friendCode: string;
  referralCount: number;
  referralBalance: number;
}

interface ReferralItem {
  referred_license_key: string;
  status: string;
  bonus_amount: number;
  created_at: string;
}

interface RedemptionItem {
  id: string;
  amount: number;
  status: string;
  pix_key: string;
  created_at: string;
  paid_at: string | null;
}

const PIX_KEY_TYPES = [
  { value: 'cpf', label: 'CPF' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Celular' },
  { value: 'random', label: 'Chave aleatória' },
];

const ReferralPage: React.FC<Props> = ({ licenseKey }) => {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [list, setList] = useState<ReferralItem[]>([]);
  const [available, setAvailable] = useState(0);
  const [history, setHistory] = useState<RedemptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Modal de resgate
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState('cpf');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function reload() {
    const r = await window.electron.referralGetInfo(licenseKey);
    if (r.success && r.friendCode) {
      const i: ReferralInfo = {
        friendCode: r.friendCode,
        referralCount: r.referralCount || 0,
        referralBalance: Number(r.referralBalance || 0),
      };
      setInfo(i);
      const lr = await window.electron.referralList(r.friendCode);
      if (lr.success) setList(lr.list);
    }
    const ri = await window.electron.redemptionInfo(licenseKey);
    if (ri.success) {
      setAvailable(ri.available || 0);
      setHistory(ri.history || []);
    }
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    reload().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseKey]);

  function copyCode() {
    if (!info) return;
    navigator.clipboard.writeText(info.friendCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function submitRedeem() {
    if (!pixKey.trim() || pixKey.trim().length < 5) {
      setRedeemMsg({ type: 'error', text: 'Informe sua chave PIX' });
      return;
    }
    setRedeeming(true);
    setRedeemMsg(null);
    const r = await window.electron.redemptionRequest({
      licenseKey,
      pixKey: pixKey.trim(),
      pixKeyType,
    });
    setRedeeming(false);
    if (!r.success) {
      setRedeemMsg({ type: 'error', text: r.error || 'Falha no resgate' });
      return;
    }
    setRedeemMsg({ type: 'success', text: 'Solicitação enviada! O pagamento será processado em até 2 dias úteis.' });
    setPixKey('');
    await reload();
    setTimeout(() => { setRedeemOpen(false); setRedeemMsg(null); }, 2500);
  }

  const canRedeem = available >= 4;
  const progress = Math.min(100, (available / 4) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 20 }}
    >
      {/* Hero — código de amigo */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '22px 24px', marginBottom: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 6px' }}>
          Seu código de amigo
        </p>
        {loading ? (
          <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner" style={{ width: 16, height: 16 } as React.CSSProperties} />
          </div>
        ) : info ? (
          <>
            <div
              onClick={copyCode}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 12,
                padding: '8px 18px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer',
                transition: 'border-color .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', letterSpacing: '0.08em' }}>
                {info.friendCode}
              </span>
              <span style={{ color: copied ? '#4ade80' : 'var(--text-muted)', display: 'flex' }}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>
              {copied ? 'Copiado!' : 'Clique para copiar'}
            </p>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Código indisponível</p>
        )}
      </div>

      {/* Progresso até o resgate */}
      {info && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 18px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: 0, fontWeight: 600 }}>
                Próximo resgate
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0 0' }}>
                R$ 50,00 a cada 4 indicações
              </p>
            </div>
            <span style={{ fontSize: 13, color: canRedeem ? '#4ade80' : 'var(--text-secondary)', fontWeight: 600 }}>
              {available}/4 disponíveis
            </span>
          </div>

          {/* Barra de progresso */}
          <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{
                height: '100%',
                background: canRedeem ? 'linear-gradient(90deg, #4ade80, #22c55e)' : 'linear-gradient(90deg, var(--accent), #ff4d8a)',
                borderRadius: 3,
              }}
            />
          </div>

          <button
            onClick={() => { setRedeemOpen(true); setRedeemMsg(null); }}
            disabled={!canRedeem}
            style={{
              width: '100%', padding: '11px 14px',
              background: canRedeem ? 'linear-gradient(135deg, #4ade80, #22c55e)' : 'rgba(255,255,255,0.04)',
              border: canRedeem ? 'none' : '1px solid var(--border)',
              borderRadius: 8,
              color: canRedeem ? '#062b15' : 'var(--text-muted)',
              fontSize: 12.5, fontWeight: 700, cursor: canRedeem ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', letterSpacing: '0.02em',
              boxShadow: canRedeem ? '0 4px 16px rgba(74,222,128,0.30)' : 'none',
            }}
          >
            {canRedeem ? '💸 Resgatar R$ 50,00 via PIX' : `Faltam ${Math.max(0, 4 - available)} ${(4 - available) === 1 ? 'indicação' : 'indicações'}`}
          </button>
        </div>
      )}

      {/* Estatísticas */}
      {info && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          <Stat label="Total indicado" value={info.referralCount.toString()} />
          <Stat label="Resgates feitos" value={history.filter(h => h.status === 'paid').length.toString()} />
        </div>
      )}

      {/* Como funciona */}
      <section style={{ marginBottom: 18 }}>
        <h3 style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, margin: '0 0 8px' }}>
          Como funciona
        </h3>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { n: '1', t: 'Compartilhe seu código de amigo' },
            { n: '2', t: 'Seu amigo digita o código no cadastro do TitanForge' },
            { n: '3', t: 'A cada 4 amigos que adquirirem licença, você resgata R$ 50,00 via PIX' },
          ].map((s, i, arr) => (
            <div key={s.n} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'rgba(124,92,252,0.10)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {s.n}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{s.t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Histórico de indicações */}
      <section style={{ marginBottom: 18 }}>
        <h3 style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, margin: '0 0 8px' }}>
          Suas indicações
        </h3>
        {list.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 16px', textAlign: 'center' }}>
            <span style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <IconUsers size={20} />
            </span>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Você ainda não indicou ninguém.</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>Compartilhe seu código para começar.</p>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {list.map((it, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto',
                gap: 10, alignItems: 'center', padding: '10px 14px',
                borderBottom: i < list.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-primary)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.referred_license_key}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                  {new Date(it.created_at).toLocaleDateString('pt-BR')}
                </span>
                <span style={{
                  fontSize: 10, padding: '3px 8px',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
                }}>
                  Registrado
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Histórico de resgates */}
      {history.length > 0 && (
        <section>
          <h3 style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, margin: '0 0 8px' }}>
            Seus resgates
          </h3>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {history.map((h, i) => (
              <div key={h.id} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto auto',
                gap: 10, alignItems: 'center', padding: '10px 14px',
                borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>
                  R$ {Number(h.amount).toFixed(2).replace('.', ',')}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.pix_key}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                  {new Date(h.created_at).toLocaleDateString('pt-BR')}
                </span>
                <span style={{
                  fontSize: 10, padding: '3px 8px',
                  background: h.status === 'paid' ? 'rgba(74,222,128,0.10)' : 'rgba(251,191,36,0.10)',
                  color: h.status === 'paid' ? '#4ade80' : '#fbbf24',
                  border: '1px solid',
                  borderColor: h.status === 'paid' ? 'rgba(74,222,128,0.20)' : 'rgba(251,191,36,0.20)',
                  borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
                }}>
                  {h.status === 'paid' ? 'Pago' : h.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modal de resgate */}
      <AnimatePresence>
        {redeemOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => { if (!redeeming) setRedeemOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '22px 24px',
                width: 420, maxWidth: '100%',
                boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              }}
            >
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px', fontWeight: 600 }}>
                Resgate
              </p>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                R$ 50,00 via PIX
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
                Informe a sua chave PIX para receber o pagamento. Este resgate consome 4 indicações.
              </p>

              <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
                Tipo da chave
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {PIX_KEY_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setPixKeyType(t.value)}
                    disabled={redeeming}
                    style={{
                      padding: '6px 12px', fontSize: 11,
                      background: pixKeyType === t.value ? 'rgba(124,92,252,0.10)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${pixKeyType === t.value ? 'rgba(124,92,252,0.30)' : 'var(--border)'}`,
                      color: pixKeyType === t.value ? 'var(--accent)' : 'var(--text-secondary)',
                      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      fontWeight: 500,
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
                Sua chave PIX
              </label>
              <input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder="Digite sua chave PIX"
                className="input"
                style={{ width: '100%', boxSizing: 'border-box' }}
                disabled={redeeming}
              />

              {redeemMsg && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, marginTop: 10,
                  color: redeemMsg.type === 'success' ? '#4ade80' : '#ff4d8a',
                  padding: '8px 10px',
                  background: redeemMsg.type === 'success' ? 'rgba(74,222,128,0.06)' : 'rgba(255,77,138,0.06)',
                  border: `1px solid ${redeemMsg.type === 'success' ? 'rgba(74,222,128,0.20)' : 'rgba(255,77,138,0.20)'}`,
                  borderRadius: 7,
                }}>
                  {redeemMsg.type === 'success' ? <IconCheck size={11} /> : <IconAlert size={11} />}
                  {redeemMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setRedeemOpen(false)} disabled={redeeming} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px' }}>
                  Cancelar
                </button>
                <button
                  onClick={submitRedeem}
                  disabled={redeeming || !pixKey.trim()}
                  style={{
                    flex: 2, padding: '10px',
                    background: 'linear-gradient(135deg, #4ade80, #22c55e)',
                    border: 'none', borderRadius: 8, color: '#062b15',
                    fontSize: 12.5, fontWeight: 700, cursor: redeeming ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: redeeming || !pixKey.trim() ? 0.6 : 1,
                  }}
                >
                  {redeeming ? 'Enviando...' : 'Solicitar resgate'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
    <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, margin: '0 0 4px' }}>
      {label}
    </p>
    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
      {value}
    </p>
  </div>
);

export default ReferralPage;
