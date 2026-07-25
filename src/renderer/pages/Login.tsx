import React, { useState, useEffect } from 'react';
import { validateLicense, saveLicenseLocally, getSavedLicense } from '../services/license';
import { IconAlert } from '../components/Icons';
import SignupModal from '../components/SignupModal';

interface LoginProps {
  onLoginSuccess: (licenseKey: string) => void;
  hwid: string;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess, hwid }) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; errorCode?: string } | null>(null);
  const [showSuspendedModal, setShowSuspendedModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const saved = getSavedLicense();
    if (saved) setLicenseKey(saved.toUpperCase());
  }, []);

  const handleValidate = async () => {
    if (!licenseKey.trim()) {
      setMessage({ type: 'error', text: 'Por favor, insira uma chave de licença' });
      return;
    }
    if (!hwid) {
      setMessage({ type: 'error', text: 'Erro ao obter HWID da máquina' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const result = await validateLicense(licenseKey.trim(), hwid);
      if (result.success) {
        setMessage({ type: 'success', text: result.message });
        saveLicenseLocally(licenseKey.trim().toUpperCase());
        try { await window.electron.enableHidDll(); } catch {}
        setTimeout(() => onLoginSuccess(licenseKey.trim().toUpperCase()), 900);
      } else {
        if (result.isSuspended) setShowSuspendedModal(true);
        setMessage({ type: 'error', text: result.message, errorCode: result.errorCode });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Não foi possível validar sua licença' });
    } finally {
      setIsLoading(false);
    }
  };

  const hasInput = licenseKey.trim().length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#07070a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Syne, sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Noise texture overlay ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
        backgroundSize: '200px 200px',
      }} />

      {/* ── Radial vignette / glow ── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse 70% 70% at 50% 42%, rgba(80,44,180,0.13) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse 40% 40% at 50% 42%, rgba(124,92,252,0.07) 0%, transparent 60%)' }} />

      {/* ── Decorative grid lines ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
        backgroundSize: '44px 44px',
        maskImage: 'radial-gradient(ellipse 65% 65% at 50% 42%, black 30%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse 65% 65% at 50% 42%, black 30%, transparent 80%)',
      }} />

      {/* ── Titlebar drag region ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '44px', zIndex: 50, WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* ── Window controls ── */}
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: '2px', padding: '9px 10px', zIndex: 60, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {([
          { t: 'Minimizar', i: '−', a: () => window.electron.minimizeApp(), d: false },
          { t: 'Maximizar', i: '□', a: () => window.electron.maximizeApp(), d: false },
          { t: 'Fechar',    i: '×', a: () => window.electron.closeApp(),    d: true  },
        ] as const).map(b => (
          <button key={b.t} onClick={b.a} title={b.t} style={{
            width: '26px', height: '26px', padding: 0, background: 'transparent', border: 'none',
            borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: b.d ? 'rgba(255,80,100,0.55)' : 'rgba(255,255,255,0.18)',
            fontSize: b.i === '×' ? '18px' : b.i === '□' ? '11px' : '16px',
            cursor: 'pointer', lineHeight: 1, transition: 'color .15s, background .15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = b.d ? '#ff5064' : 'rgba(255,255,255,0.65)';
            (e.currentTarget as HTMLElement).style.background = b.d ? 'rgba(255,50,70,0.10)' : 'rgba(255,255,255,0.06)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = b.d ? 'rgba(255,80,100,0.55)' : 'rgba(255,255,255,0.18)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
          >{b.i}</button>
        ))}
      </div>

      {/* ════════════════════════════════════
          CARD CENTRAL
      ════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 10,
        width: '100%', maxWidth: '380px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        animation: 'loginFadeIn .5s ease',
      }}>

        {/* Logo + identity */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <img
              src="assets/logo.png"
              alt="TitanForge"
              style={{ width: '60px', height: '60px', display: 'block', filter: 'drop-shadow(0 0 22px rgba(124,92,252,0.50))', animation: 'logoPulse 4s ease-in-out infinite' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            {/* Ring decoration */}
            <div style={{ position: 'absolute', inset: '-8px', borderRadius: '50%', border: '1px solid rgba(124,92,252,0.18)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: '-16px', borderRadius: '50%', border: '1px solid rgba(124,92,252,0.07)', pointerEvents: 'none' }} />
          </div>
          <div style={{ fontSize: '10px', letterSpacing: '0.22em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: '8px' }}>
            TitanForge Launcher
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', textAlign: 'center', lineHeight: 1.2, margin: 0 }}>
            Bem-vindo de volta
          </h1>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.28)', marginTop: '6px', textAlign: 'center' }}>
            Insira sua chave de licença para acessar
          </p>
        </div>

        {/* Form glass panel */}
        <div style={{
          width: '100%',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '16px',
          padding: '24px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(124,92,252,0.06)',
        }}>

          {/* Input label */}
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Chave de Licença
          </label>

          {/* Input */}
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <input
              value={licenseKey}
              onChange={e => { setLicenseKey(e.target.value.toUpperCase()); setMessage(null); }}
              onKeyPress={e => { if (e.key === 'Enter' && !isLoading) handleValidate(); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="XXXX-XXXX-XXXX"
              disabled={isLoading}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: message?.type === 'error'
                  ? 'rgba(255,45,120,0.04)'
                  : focused
                  ? 'rgba(124,92,252,0.06)'
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${message?.type === 'error' ? 'rgba(255,45,120,0.55)' : focused ? 'rgba(124,92,252,0.60)' : 'rgba(255,255,255,0.09)'}`,
                boxShadow: focused
                  ? '0 0 0 3px rgba(124,92,252,0.10), 0 0 18px rgba(124,92,252,0.08) inset'
                  : 'none',
                borderRadius: '10px', padding: '13px 16px',
                fontSize: '14px', fontWeight: 600,
                fontFamily: '"Syne", sans-serif',
                color: focused || licenseKey ? 'rgba(200,180,255,0.95)' : 'rgba(255,255,255,0.35)',
                textAlign: 'center', letterSpacing: '0.20em',
                textTransform: 'uppercase',
                outline: 'none',
                transition: 'border-color .2s, box-shadow .2s, background .2s, color .2s',
              }}
            />
          </div>

          {/* Feedback */}
          {message?.type === 'error' && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#ff4d8a', padding: '8px 10px', background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.18)', borderRadius: '7px' }}>
                <IconAlert size={11} /> {message.text || 'Erro na validação'}
              </div>
              {message.errorCode === 'HWID_MISMATCH' && (
                <button
                  onClick={() => window.electron.openExternalUrl('https://wa.me/5543988322483?text=' + encodeURIComponent(`Olá! Minha licença ${licenseKey.trim().toUpperCase()} está vinculada a outro dispositivo. Pode me ajudar?`))}
                  style={{
                    marginTop: '8px', width: '100%', padding: '10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
                    border: 'none', borderRadius: '7px',
                    color: '#fff', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 4px 12px rgba(37,211,102,0.25)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.92'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                  Falar com suporte no WhatsApp
                </button>
              )}
            </div>
          )}
          {message?.type === 'success' && (
            <div style={{ fontSize: '11px', color: '#4ade80', marginBottom: '10px', textAlign: 'center', padding: '8px 10px', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.20)', borderRadius: '7px' }}>
              {message.text}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleValidate}
            disabled={isLoading || !hasInput}
            style={{
              width: '100%', padding: '13px',
              background: hasInput && !isLoading
                ? 'linear-gradient(135deg, #6d44f0 0%, #9b3fcf 50%, #e8245e 100%)'
                : 'rgba(255,255,255,0.05)',
              border: hasInput && !isLoading ? 'none' : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px',
              fontSize: '13px', fontWeight: 700,
              color: hasInput ? '#fff' : 'rgba(255,255,255,0.20)',
              cursor: hasInput && !isLoading ? 'pointer' : 'not-allowed',
              fontFamily: 'Syne, sans-serif', letterSpacing: '0.03em',
              transition: 'filter .15s, box-shadow .15s',
              boxShadow: hasInput && !isLoading ? '0 6px 28px rgba(109,68,240,0.35), 0 1px 0 rgba(255,255,255,0.08) inset' : 'none',
            }}
            onMouseEnter={e => { if (hasInput && !isLoading) (e.currentTarget as HTMLElement).style.filter = 'brightness(1.10)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none'; }}
          >
            {isLoading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="spinner" style={{ width: '13px', height: '13px', borderWidth: '2px' } as React.CSSProperties} />
                Validando...
              </span>
            ) : 'Entrar'}
          </button>
        </div>

        {/* Purchase link */}
        <div style={{ marginTop: '18px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.22)' }}>Não tem uma chave?</span>
          <button
            onClick={() => setShowPurchaseModal(true)}
            style={{ background: 'none', border: 'none', color: 'rgba(167,139,250,0.70)', cursor: 'pointer', fontWeight: 700, fontSize: '12px', fontFamily: 'Syne, sans-serif', padding: 0, transition: 'color .15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(167,139,250,1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(167,139,250,0.70)'; }}
          >
            Adquira aqui →
          </button>
        </div>
      </div>

      {/* Copyright */}
      <p style={{ position: 'absolute', bottom: '14px', zIndex: 10, fontSize: '10px', color: 'rgba(255,255,255,0.10)', fontFamily: 'Syne, sans-serif', letterSpacing: '0.05em' }}>
        © 2026 TitanForge Launcher
      </p>

      {/* ══ Modal: Licença Suspensa ══ */}
      {showSuspendedModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.88)' }} onClick={() => setShowSuspendedModal(false)}>
          <div style={{ background: '#0d0d10', border: '1px solid rgba(255,45,120,0.28)', borderRadius: '14px', maxWidth: '340px', width: '90%', padding: '28px', animation: 'modalIn .2s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: 'rgba(255,45,120,0.10)', border: '1px solid rgba(255,45,120,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconAlert size={22} color="#ff2d78" />
              </div>
            </div>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: '8px' }}>Licença Expirada</h2>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginBottom: '6px', lineHeight: 1.6 }}>Sua licença mensal expirou e precisa ser renovada.</p>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginBottom: '20px', lineHeight: 1.6 }}>Entre em contato com o suporte para renovar sua assinatura.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={async () => {
                  const msg = encodeURIComponent('Olá, minha licença expirou e eu gostaria de renovar');
                  await window.electron.openExternalUrl(`https://wa.me/554388322483?text=${msg}`);
                  setShowSuspendedModal(false);
                }}
                style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '12px', fontWeight: 700, fontFamily: 'Syne, sans-serif', cursor: 'pointer', width: '100%' }}
              >
                Abrir WhatsApp
              </button>
              <button onClick={() => setShowSuspendedModal(false)} className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Cadastro novo via PIX (EFI) ══ */}
      {showPurchaseModal && (
        <SignupModal
          onClose={() => setShowPurchaseModal(false)}
          onLicenseCreated={(key) => {
            setLicenseKey(key);
            saveLicenseLocally(key);
            setShowPurchaseModal(false);
          }}
        />
      )}
    </div>
  );
};

export default Login;
