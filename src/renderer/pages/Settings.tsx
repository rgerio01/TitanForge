import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { IconCopy, IconCheck, IconAlert } from '../components/Icons';
import type { License } from '../services/supabase';
import { formatPhone, phoneDigits } from '../utils/phone';

interface SettingsProps {
  licenseKey: string;
  hwid: string;
  licenseInfo: License | null;
  onLicenseInfoChanged?: () => void;
}

const Row: React.FC<{
  label: string;
  value: string | null | undefined;
  monospace?: boolean;
}> = ({ label, value, monospace }) => {
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value.length === 0;

  function copy() {
    if (isEmpty) return;
    navigator.clipboard.writeText(value!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr auto',
      alignItems: 'center', gap: 12,
      padding: '11px 14px',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{label}</span>
      <span style={{
        fontSize: 12.5,
        color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
        fontFamily: monospace ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
        fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={value || ''}>
        {isEmpty ? '—' : value}
      </span>
      <button
        onClick={copy}
        disabled={isEmpty}
        style={{
          padding: '4px 10px', background: 'transparent',
          border: '1px solid var(--border)', borderRadius: 5,
          color: copied ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 10.5, cursor: isEmpty ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: isEmpty ? 0.3 : 1,
          display: 'flex', alignItems: 'center', gap: 4,
          transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={e => { if (!isEmpty) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-secondary)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
      >
        {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
};

const EditableRow: React.FC<{
  label: string;
  value: string | null | undefined;
  field: 'email' | 'numero';
  onSave: (newValue: string) => Promise<{ success: boolean; error?: string }>;
  monospace?: boolean;
  withConfirm?: boolean;
}> = ({ label, value, field, onSave, withConfirm }) => {
  const isPhone = field === 'numero';
  const initial = isPhone ? formatPhone(value || '') : (value || '');
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial);
  const [valConfirm, setValConfirm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const v = isPhone ? formatPhone(value || '') : (value || '');
    setVal(v);
    setValConfirm(v);
  }, [value, isPhone]);

  async function save() {
    setError(null);
    if (isPhone) {
      if (phoneDigits(val).length !== 11) {
        setError('Telefone deve ter 11 dígitos: (DD) 9 XXXX-XXXX');
        return;
      }
      if (withConfirm && phoneDigits(val) !== phoneDigits(valConfirm)) {
        setError('Os telefones não coincidem');
        return;
      }
    } else if (withConfirm && val.trim() !== valConfirm.trim()) {
      setError('Os valores não coincidem');
      return;
    }
    setSaving(true);
    const r = await onSave(val.trim());
    setSaving(false);
    if (!r.success) {
      setError(r.error || 'Falha ao salvar');
      return;
    }
    setEditing(false);
  }

  const onChangeVal = (v: string) => setVal(isPhone ? formatPhone(v) : v);
  const onChangeValConfirm = (v: string) => setValConfirm(isPhone ? formatPhone(v) : v);

  if (!editing) {
    const isEmpty = !value;
    const display = isPhone && value ? formatPhone(value) : value;
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: '140px 1fr auto',
        alignItems: 'center', gap: 12, padding: '11px 14px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{
          fontSize: 12.5,
          color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={display || ''}>
          {isEmpty ? '—' : display}
        </span>
        <button
          onClick={() => { setEditing(true); setError(null); }}
          style={{
            padding: '4px 10px', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 5,
            color: 'var(--text-secondary)',
            fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
            transition: 'border-color .15s, color .15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-secondary)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
        >
          Editar
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(124,92,252,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 128 }}>{label}</span>
        <input
          value={val}
          onChange={e => onChangeVal(e.target.value)}
          className="input"
          style={{ flex: 1 }}
          placeholder={isPhone ? '(41) 9 9119-7816' : ''}
          autoFocus
        />
      </div>
      {withConfirm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 128 }}>Confirmar {label.toLowerCase()}</span>
          <input
            value={valConfirm}
            onChange={e => onChangeValConfirm(e.target.value)}
            placeholder="Digite o mesmo valor"
            className="input"
            style={{ flex: 1 }}
          />
        </div>
      )}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ff4d8a', marginTop: 8, padding: '6px 8px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.18)', borderRadius: 6 }}>
          <IconAlert size={11} /> {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => { setEditing(false); setVal(value || ''); setValConfirm(value || ''); setError(null); }} disabled={saving} className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
          Cancelar
        </button>
        <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '5px 14px', fontSize: 11 }}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section style={{ marginBottom: 22 }}>
    <h3 style={{
      fontSize: 10, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.10em',
      fontWeight: 600, margin: '0 0 8px', paddingLeft: 2,
    }}>
      {title}
    </h3>
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {children}
    </div>
  </section>
);

const Permission: React.FC<{ label: string; enabled: boolean }> = ({ label, enabled }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 12px', borderBottom: '1px solid var(--border)',
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? '#4ade80' : 'var(--text-muted)', flexShrink: 0 }} />
    <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{label}</span>
    <span style={{
      fontSize: 10, color: enabled ? '#4ade80' : 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {enabled ? 'Ativo' : 'Inativo'}
    </span>
  </div>
);

const Settings: React.FC<SettingsProps> = ({ licenseKey, hwid, licenseInfo, onLicenseInfoChanged }) => {
  const [publicIp, setPublicIp] = useState<string>('Carregando...');

  useEffect(() => {
    window.electron.getPublicIp()
      .then(r => setPublicIp(r.success ? r.ip : 'Indisponível'))
      .catch(() => setPublicIp('Indisponível'));
  }, []);

  const licenseTypeLabel =
    licenseInfo?.license_type === 1 ? 'Mensal' :
    licenseInfo?.license_type === 2 ? 'Vitalícia' :
    licenseInfo?.license_type === 3 ? 'Teste' : '—';

  const statusLabel =
    licenseInfo?.status === 'active' ? 'Ativa' :
    licenseInfo?.status === 'suspended' ? 'Suspensa' :
    licenseInfo?.status === 'inactive' ? 'Inativa' : '—';

  const expiresFormatted = licenseInfo?.expires_at
    ? new Date(licenseInfo.expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  async function updateField(field: 'email' | 'numero', value: string) {
    const r = await window.electron.profileUpdate({
      licenseKey,
      [field]: value,
    } as any);
    if (r.success) onLicenseInfoChanged?.();
    return r;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 20 }}
    >
      <Section title="Conta">
        <Row label="Nome" value={licenseInfo?.nome} />
        <EditableRow
          label="E-mail"
          value={licenseInfo?.email}
          field="email"
          onSave={(v) => updateField('email', v)}
        />
        <EditableRow
          label="Telefone"
          value={licenseInfo?.numero}
          field="numero"
          onSave={(v) => updateField('numero', v)}
          withConfirm
        />
      </Section>

      <Section title="Licença">
        <Row label="Chave" value={licenseKey} monospace />
        <Row label="Tipo" value={licenseTypeLabel} />
        <Row label="Status" value={statusLabel} />
        {expiresFormatted && <Row label="Expira em" value={expiresFormatted} />}
        {licenseInfo?.friend_code && (
          <Row label="Código de amigo" value={licenseInfo.friend_code} monospace />
        )}
      </Section>

      <Section title="Dispositivo">
        <Row label="HWID" value={hwid} monospace />
        <Row label="IP Público" value={publicIp} monospace />
      </Section>

      <Section title="Permissões">
        <Permission label="Adicionar jogos" enabled={licenseInfo?.add_games === 'enable'} />
        <Permission label="Bypass Premium" enabled={licenseInfo?.bypass === 'enable'} />
        <Permission label="Contas Oficiais" enabled={licenseInfo?.premiumaccounts === 'enable'} />
        <Permission label="Multiplayer" enabled={licenseInfo?.multiplayer === 'enable'} />
        <Permission label="Conteúdo +18" enabled={licenseInfo?.nsfw === 'enable'} />
      </Section>
    </motion.div>
  );
};

export default Settings;
