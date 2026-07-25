import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconAlert } from './Icons';

interface Props {
  bypassName: string;
  bypassUrl: string;
  thumbnail?: string | null;
  onClose: () => void;
  onInstalled: () => void;
  // Customização de textos (multiplayer reusa este componente)
  titleLabel?: string;          // ex: "Instalar bypass" / "Instalar fix multiplayer"
  instructionTitle?: string;    // ex: "Selecione a pasta de instalação do jogo"
  instructionBody?: string;     // texto secundário
}

type Stage = 'idle' | 'downloading' | 'extracting' | 'opening' | 'done' | 'error';

const FolderIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const BypassInstallModal: React.FC<Props> = ({
  bypassName, bypassUrl, thumbnail, onClose, onInstalled,
  titleLabel = 'Instalar bypass',
  instructionTitle = 'Selecione a pasta de instalação do jogo',
  instructionBody = 'Os arquivos serão extraídos diretamente para a pasta escolhida — geralmente é a pasta onde o jogo está instalado.',
}) => {
  const [folder, setFolder] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [openedExternally, setOpenedExternally] = useState(false);

  useEffect(() => {
    const handler = (data: { stage: Stage; percent?: number }) => {
      if (data.stage) setStage(data.stage);
      if (typeof data.percent === 'number') setProgress(data.percent);
    };
    window.electron.onBypassProgress(handler);
  }, []);

  async function pickFolder() {
    const r = await window.electron.bypassPickFolder();
    if (r.success && r.folder) {
      setFolder(r.folder);
      setErrorMsg(null);
    }
  }

  async function startInstall() {
    if (!folder) return;
    setStage('downloading');
    setProgress(0);
    setErrorMsg(null);
    setOpenedExternally(false);

    const r = await window.electron.bypassExtract(bypassUrl, folder);
    if (r.success) {
      if (r.openedExternally) setOpenedExternally(true);
      setStage('done');
      onInstalled();
    } else {
      setStage('error');
      setErrorMsg(r.error || 'Falha ao instalar');
    }
  }

  const isWorking = stage === 'downloading' || stage === 'extracting' || stage === 'opening';
  const isDone = stage === 'done';
  const isError = stage === 'error';

  const stageLabel =
    stage === 'downloading' ? 'Baixando arquivo...' :
    stage === 'extracting'  ? 'Extraindo arquivos...' :
    stage === 'opening'     ? 'Abrindo no cliente...' :
    stage === 'done'        ? (openedExternally ? 'Aberto no cliente externo' : 'Instalação concluída') :
    stage === 'error'       ? 'Falha' :
    'Pronto para instalar';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.86)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        onClick={() => { if (!isWorking) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            width: 500, maxWidth: '100%',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          }}
        >
          {/* Thumb */}
          {thumbnail && (
            <div style={{ width: '100%', height: 110, position: 'relative', overflow: 'hidden' }}>
              <img src={thumbnail} alt={bypassName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, var(--bg-card) 100%)' }} />
              <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16 }}>
                <p style={{ fontSize: 10, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 2px', fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
                  {titleLabel}
                </p>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0, textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
                  {bypassName}
                </h3>
              </div>
            </div>
          )}

          <div style={{ padding: '18px 22px 20px' }}>
            {!thumbnail && (
              <>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 4px' }}>
                  {titleLabel}
                </p>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' }}>
                  {bypassName}
                </h3>
              </>
            )}

            {/* Instrução grande, com pulse */}
            {!folder && stage === 'idle' && (
              <motion.div
                initial={{ scale: 0.97, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                style={{
                  position: 'relative',
                  background: 'linear-gradient(135deg, rgba(124,92,252,0.10) 0%, rgba(124,92,252,0.04) 100%)',
                  border: '1px solid rgba(124,92,252,0.32)',
                  borderRadius: 10, padding: '14px 16px',
                  marginBottom: 14,
                  overflow: 'hidden',
                }}
              >
                <motion.div
                  animate={{ opacity: [0.4, 0.7, 0.4] }}
                  transition={{ duration: 2.4, repeat: Infinity }}
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
                  }}
                />
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: 'rgba(124,92,252,0.16)',
                    border: '1px solid rgba(124,92,252,0.32)',
                    color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <IconAlert size={14} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '0 0 4px', fontWeight: 700, letterSpacing: '0.005em' }}>
                      {instructionTitle}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      {instructionBody}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Folder picker — botão grande e cativante */}
            <button
              onClick={pickFolder}
              disabled={isWorking}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px',
                background: folder
                  ? 'linear-gradient(135deg, rgba(74,222,128,0.10), rgba(74,222,128,0.04))'
                  : 'linear-gradient(135deg, rgba(124,92,252,0.08), rgba(255,255,255,0.02))',
                border: `1px solid ${folder ? 'rgba(74,222,128,0.32)' : 'rgba(124,92,252,0.28)'}`,
                borderRadius: 10,
                color: 'var(--text-primary)',
                fontSize: 12.5, cursor: isWorking ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
                marginBottom: 14,
                transition: 'border-color .15s, background .15s, transform .12s',
              }}
              onMouseEnter={e => { if (!isWorking) (e.currentTarget as HTMLElement).style.transform = 'scale(1.005)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            >
              <span style={{
                width: 36, height: 36, borderRadius: 8,
                background: folder ? 'rgba(74,222,128,0.14)' : 'rgba(124,92,252,0.14)',
                color: folder ? '#4ade80' : 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {folder ? <IconCheck size={16} /> : <FolderIcon size={16} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>
                  {folder ? 'Pasta selecionada' : 'Pasta de destino'}
                </p>
                <p style={{
                  fontSize: 12.5, color: 'var(--text-primary)', margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: folder ? 500 : 600,
                }}>
                  {folder || 'Clique para selecionar'}
                </p>
              </div>
              <span style={{
                fontSize: 10, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '4px 8px', background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}>
                {folder ? 'Trocar' : 'Selecionar'}
              </span>
            </button>

            {/* Status / progress */}
            {(isWorking || isDone || isError) && (
              <div style={{
                background: isError ? 'rgba(255,77,138,0.05)' : isDone ? 'rgba(74,222,128,0.05)' : 'rgba(124,92,252,0.04)',
                border: `1px solid ${isError ? 'rgba(255,77,138,0.22)' : isDone ? 'rgba(74,222,128,0.22)' : 'rgba(124,92,252,0.22)'}`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: stage === 'downloading' && progress > 0 ? 8 : 0 }}>
                  {isWorking && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 } as React.CSSProperties} />}
                  {isDone && <span style={{ color: '#4ade80' }}><IconCheck size={13} /></span>}
                  {isError && <span style={{ color: '#ff4d8a' }}><IconAlert size={13} /></span>}
                  <span style={{ fontSize: 12, color: isError ? '#ff4d8a' : isDone ? '#4ade80' : 'var(--text-primary)', fontWeight: 500 }}>
                    {isError ? errorMsg : stageLabel}
                  </span>
                </div>
                {stage === 'downloading' && progress > 0 && (
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${progress}%`,
                      background: 'var(--accent)',
                      transition: 'width 0.2s ease',
                    }} />
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} disabled={isWorking} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '11px' }}>
                {isDone ? 'Fechar' : 'Cancelar'}
              </button>
              {!isDone && (
                <button
                  onClick={startInstall}
                  disabled={!folder || isWorking}
                  style={{
                    flex: 2, padding: '11px',
                    background: !folder || isWorking
                      ? 'rgba(124,92,252,0.18)'
                      : 'linear-gradient(135deg, var(--accent) 0%, #ff4d8a 100%)',
                    border: 'none', borderRadius: 8,
                    color: '#fff', fontSize: 12.5, fontWeight: 700,
                    cursor: !folder || isWorking ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: '0.02em',
                    boxShadow: !folder || isWorking ? 'none' : '0 4px 18px rgba(124,92,252,0.35)',
                    opacity: !folder || isWorking ? 0.55 : 1,
                    transition: 'transform .1s, filter .15s',
                  }}
                  onMouseEnter={e => { if (folder && !isWorking) (e.currentTarget as HTMLElement).style.filter = 'brightness(1.10)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none'; }}
                >
                  {isWorking ? 'Instalando...' : isError ? 'Tentar novamente' : 'Instalar agora'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default BypassInstallModal;
