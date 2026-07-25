import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconAlert, IconCheck } from './Icons';
import { formatPhone, phoneDigits } from '../utils/phone';

interface Props {
  licenseKey: string;
  initial: { nome?: string | null; email?: string | null; numero?: string | null };
  onComplete: () => void;
}

const CompleteProfileModal: React.FC<Props> = ({ licenseKey, initial, onComplete }) => {
  const [nome, setNome] = useState(initial.nome || '');
  const [email, setEmail] = useState(initial.email || '');
  const [numero, setNumero] = useState(formatPhone(initial.numero || ''));
  const [numeroConfirm, setNumeroConfirm] = useState(formatPhone(initial.numero || ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsNome = !initial.nome;
  const needsEmail = !initial.email;
  const needsNumero = !initial.numero;

  useEffect(() => {
    setNome(initial.nome || '');
    setEmail(initial.email || '');
    setNumero(formatPhone(initial.numero || ''));
    setNumeroConfirm(formatPhone(initial.numero || ''));
  }, [initial.nome, initial.email, initial.numero]);

  function validate(): string | null {
    if (needsNome) {
      if (!nome.trim() || nome.trim().split(/\s+/).length < 2) return 'Informe seu nome completo';
    }
    if (needsEmail) {
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return 'E-mail inválido';
    }
    if (needsNumero) {
      if (phoneDigits(numero).length !== 11) return 'Telefone deve ter 11 dígitos: (DD) 9 XXXX-XXXX';
      if (phoneDigits(numero) !== phoneDigits(numeroConfirm)) return 'Os telefones não coincidem';
    }
    return null;
  }

  async function save() {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    const r = await window.electron.profileUpdate({
      licenseKey,
      nome: needsNome ? nome.trim() : undefined,
      email: needsEmail ? email.trim() : undefined,
      numero: needsNumero ? numero.trim() : undefined,
    });
    setSaving(false);
    if (!r.success) {
      setError(r.error || 'Não foi possível salvar');
      return;
    }
    onComplete();
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 14, padding: '22px 26px 20px',
            width: 460, maxWidth: '100%',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ color: 'var(--accent)', display: 'flex', flexShrink: 0 }}>
              <IconAlert size={18} />
            </span>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: 0, fontWeight: 600 }}>
                Complete seu perfil
              </p>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0 0' }}>
                Faltam algumas informações
              </h3>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
            Para usar todos os recursos do TitanForge, precisamos completar alguns dados da sua licença. Isso é feito apenas uma vez.
          </p>

          {needsNome && (
            <Field label="Nome completo" value={nome} onChange={setNome} placeholder="João Silva" />
          )}
          {needsEmail && (
            <Field label="E-mail" value={email} onChange={setEmail} placeholder="seu@email.com" type="email" />
          )}
          {needsNumero && (
            <>
              <Field label="Telefone celular" value={numero} onChange={(v) => setNumero(formatPhone(v))} placeholder="(41) 9 9119-7816" />
              <Field label="Confirme o telefone" value={numeroConfirm} onChange={(v) => setNumeroConfirm(formatPhone(v))} placeholder="Digite o mesmo telefone" />
              {numero && numeroConfirm && phoneDigits(numero) === phoneDigits(numeroConfirm) && phoneDigits(numero).length === 11 && (
                <p style={{ fontSize: 11, color: '#4ade80', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <IconCheck size={11} /> Telefones conferem
                </p>
              )}
            </>
          )}

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: '#ff4d8a',
              padding: '8px 10px',
              background: 'rgba(255,45,120,0.06)',
              border: '1px solid rgba(255,45,120,0.18)',
              borderRadius: 7,
              marginBottom: 12, marginTop: 4,
            }}>
              <IconAlert size={11} /> {error}
            </div>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px', marginTop: 6 }}
          >
            {saving ? 'Salvando...' : 'Salvar e continuar'}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }> = ({ label, value, onChange, placeholder, type }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
      {label}
    </label>
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      type={type || 'text'}
      className="input"
      style={{ width: '100%', boxSizing: 'border-box' }}
    />
  </div>
);

export default CompleteProfileModal;
