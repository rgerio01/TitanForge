import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconAlert } from '../components/Icons';

interface Tutorial {
  id: string;
  name: string;
  video_url: string;
  description: string | null;
  category: string | null;
  display_order: number;
}

/**
 * Converte uma URL de YouTube em URL de embed.
 * Suporta:
 *  - https://www.youtube.com/watch?v=ID
 *  - https://youtu.be/ID
 *  - https://www.youtube.com/embed/ID
 *  - https://www.youtube.com/shorts/ID
 */
function toYouTubeEmbed(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      if (u.pathname.startsWith('/embed/')) return `https://www.youtube.com/embed/${u.pathname.split('/')[2]}`;
      if (u.pathname.startsWith('/shorts/')) return `https://www.youtube.com/embed/${u.pathname.split('/')[2]}`;
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
  } catch {}
  return null;
}

const ChevronDown: React.FC<{ rotated: boolean }> = ({ rotated }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform .2s ease', transform: rotated ? 'rotate(180deg)' : 'rotate(0)' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TutoriaisPage: React.FC = () => {
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    let m = true;
    setLoading(true);
    window.electron.tutorialsList()
      .then((r) => { if (m && r.success) setTutorials(r.tutorials); })
      .finally(() => { if (m) setLoading(false); });
    return () => { m = false; };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    tutorials.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set);
  }, [tutorials]);

  const filtered = useMemo(() => {
    if (filter === 'all') return tutorials;
    return tutorials.filter(t => t.category === filter);
  }, [tutorials, filter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      style={{ maxWidth: 820, margin: '0 auto', paddingBottom: 20 }}
    >
      {/* Categorias (filtro) */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label={`Todos (${tutorials.length})`} />
          {categories.map(c => (
            <FilterPill key={c} active={filter === c} onClick={() => setFilter(c)} label={c} />
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="spinner" style={{ width: 14, height: 14 } as React.CSSProperties} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '32px 16px', textAlign: 'center' }}>
          <span style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', marginBottom: 8 }}>
            <IconAlert size={20} />
          </span>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0 }}>Nenhum tutorial disponível ainda.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(t => (
            <TutorialCard key={t.id} tutorial={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
          ))}
        </div>
      )}
    </motion.div>
  );
};

const FilterPill: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    style={{
      padding: '5px 11px', fontSize: 11.5,
      background: active ? 'rgba(124,92,252,0.10)' : 'rgba(255,255,255,0.02)',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      border: `1px solid ${active ? 'rgba(124,92,252,0.40)' : 'var(--border)'}`,
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      fontWeight: active ? 600 : 500,
    }}
  >
    {label}
  </button>
);

const TutorialCard: React.FC<{ tutorial: Tutorial; open: boolean; onToggle: () => void }> = ({ tutorial, open, onToggle }) => {
  const embed = useMemo(() => toYouTubeEmbed(tutorial.video_url), [tutorial.video_url]);

  return (
    <motion.div
      layout
      style={{
        background: 'var(--bg-card)',
        border: '1px solid',
        borderColor: open ? 'rgba(124,92,252,0.32)' : 'var(--border)',
        borderRadius: 10, overflow: 'hidden',
        transition: 'border-color .2s ease',
      }}
    >
      {/* Header (clicável) */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'transparent', border: 'none',
          textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: open ? 'linear-gradient(135deg, var(--accent), #ff4d8a)' : 'rgba(124,92,252,0.10)',
          color: open ? '#fff' : 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'background .2s ease',
        }}>
          ▶
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tutorial.category && (
            <p style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: '0 0 2px' }}>
              {tutorial.category}
            </p>
          )}
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
            {tutorial.name}
          </h3>
        </div>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          <ChevronDown rotated={open} />
        </span>
      </button>

      {/* Conteúdo expansível */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
              {/* Vídeo */}
              {embed ? (
                <div style={{ position: 'relative', paddingTop: '56.25%', background: '#000', borderRadius: 8, overflow: 'hidden', marginTop: 12, marginBottom: 12 }}>
                  <iframe
                    src={embed}
                    title={tutorial.name}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div style={{ marginTop: 12, marginBottom: 12, padding: '12px 14px', background: 'rgba(255,210,90,0.06)', border: '1px solid rgba(255,210,90,0.20)', borderRadius: 8 }}>
                  <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 6px' }}>
                    Não foi possível incorporar o vídeo. Abra externamente:
                  </p>
                  <button
                    onClick={() => window.electron.openExternalUrl(tutorial.video_url)}
                    className="btn-ghost"
                    style={{ padding: '6px 10px', fontSize: 11 }}
                  >
                    Abrir vídeo →
                  </button>
                </div>
              )}

              {/* Descrição */}
              {tutorial.description && (
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {tutorial.description}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TutoriaisPage;
