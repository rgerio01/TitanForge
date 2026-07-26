import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconAlert } from './Icons';

type Stage =
  | { kind: 'idle' }
  | { kind: 'available'; currentVersion: string; newVersion: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'downloaded'; version: string; path: string | null }
  | { kind: 'error'; message: string };

const formatBytes = (b: number) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = b, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};

const UpdateModal: React.FC = () => {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    window.electron.onUpdateAvailable((data) => {
      setStage({ kind: 'available', currentVersion: data.currentVersion, newVersion: data.newVersion });
      setOpen(true);
    });
    window.electron.onUpdateDownloadProgress((data) => {
      setStage({
        kind: 'downloading',
        percent: data.percent || 0,
        transferred: data.transferred || 0,
        total: data.total || 0,
        bytesPerSecond: data.bytesPerSecond || 0,
      });
      setOpen(true);
    });
    window.electron.onUpdateDownloaded((data) => {
      setStage({ kind: 'downloaded', version: data.version, path: data.path ?? null });
      setOpen(true);
    });
    window.electron.onUpdateError((data) => {
      setStage({ kind: 'error', message: data.message });
      setOpen(true);
    });
  }, []);

  if (!open || stage.kind === 'idle') return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed',
          top: 56, right: 20,
          zIndex: 99998,
          width: 320,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ padding: '12px 14px' }}>
          {stage.kind === 'available' && (
            <AvailableView current={stage.currentVersion} next={stage.newVersion} />
          )}
          {stage.kind === 'downloading' && (
            <DownloadingView
              percent={stage.percent}
              transferred={stage.transferred}
              total={stage.total}
              speed={stage.bytesPerSecond}
            />
          )}
          {stage.kind === 'downloaded' && (
            <DownloadedView version={stage.version} path={stage.path} />
          )}
          {stage.kind === 'error' && (
            <ErrorView message={stage.message} onClose={() => setOpen(false)} />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// ───────── Subviews ─────────

const Header: React.FC<{ label: string; onClose?: () => void }> = ({ label, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  }}>
    <span style={{
      fontSize: 9, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600,
    }}>
      {label}
    </span>
    {onClose && (
      <button
        onClick={onClose}
        style={{
          background: 'none', border: 'none',
          color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 14, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
    )}
  </div>
);

const AvailableView: React.FC<{ current: string; next: string }> = ({ current, next }) => (
  <>
    <Header label="Atualização disponível" />
    <p style={{ fontSize: 12.5, color: 'var(--text-primary)', margin: '0 0 6px', fontWeight: 500 }}>
      Nova versão do TitanForge
    </p>
    <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 10px', fontFamily: 'ui-monospace, monospace' }}>
      v{current} → <span style={{ color: 'var(--text-primary)' }}>v{next}</span>
    </p>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-muted)' }}>
      <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 } as React.CSSProperties} />
      Baixando em segundo plano...
    </div>
  </>
);

const DownloadingView: React.FC<{ percent: number; transferred: number; total: number; speed: number }> = ({ percent, transferred, total, speed }) => (
  <>
    <Header label="Baixando atualização" />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
        {percent.toFixed(0)}%
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
        {formatBytes(transferred)} / {formatBytes(total)}
      </span>
    </div>

    <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
      <motion.div
        animate={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        transition={{ duration: 0.3 }}
        style={{
          height: '100%',
          background: 'var(--accent)',
        }}
      />
    </div>

    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0', fontFamily: 'ui-monospace, monospace' }}>
      {formatBytes(speed)}/s · pode continuar usando
    </p>
  </>
);

const DownloadedView: React.FC<{ version: string; path: string | null }> = ({ version, path }) => (
  <>
    <Header label="Atualização baixada" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{
        width: 18, height: 18, borderRadius: 4,
        background: 'rgba(74,222,128,0.12)',
        color: '#4ade80',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <IconCheck size={11} />
      </span>
      <p style={{ fontSize: 12.5, color: 'var(--text-primary)', margin: 0 }}>
        v{version} baixada
      </p>
    </div>
    <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
      Não instalada automaticamente{path ? <> — salva em <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{path}</span></> : ''}.
    </p>
    <button
      onClick={() => window.electron.openUpdatesFolder?.().catch(() => {})}
      style={{
        padding: '5px 14px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
        borderRadius: 6, color: '#4ade80', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
      }}
    >
      Abrir pasta
    </button>
  </>
);

const ErrorView: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => (
  <>
    <Header label="Falha na atualização" onClose={onClose} />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ color: '#ff4d8a', flexShrink: 0, marginTop: 2 }}>
        <IconAlert size={11} />
      </span>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {message.length > 180 ? message.slice(0, 180) + '...' : message}
      </p>
    </div>
  </>
);

export default UpdateModal;
