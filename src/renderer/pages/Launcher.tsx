import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Shield } from 'lucide-react';
import {
  IconHome, IconPlus, IconStar, IconDownload, IconSend,
  IconShield, IconUser, IconUsers, IconShop, IconBell, IconGift,
  IconLock, IconAlert, IconArrowUp, IconTrash, IconTrashSm, IconCrown,
  IconDiscord, IconSearch, IconLogout, IconGame, IconRefresh,
  IconCheck, IconEye, IconEyeOff, IconCopy, IconGamepad,
} from '../components/Icons';
import { heartbeat } from '../services/heartbeat';
import { removeSavedLicense, getLicenseInfo } from '../services/license';
import { getDownloadUrl, getTestDownloadUrl, getLauncherUpdateCommand } from '../services/config';
import type { License } from '../services/supabase';
import { getBypassList, type BypassWithSteamData } from '../services/bypass';
import { getPremiumAccounts, type PremiumAccount } from '../services/premiumAccounts';
import { getUpdates, hasUnreadUpdates, markUpdatesAsRead, createInitialUpdate, type Update } from '../services/updates';
import { getStoreItems } from '../services/store';
import { getMultiplayerContent, type MultiplayerWithSteamData } from '../services/multiplayer';
import { getCheckoutLink } from '../services/checkouts';
import { getSocialLinkMap } from '../services/social';
import * as DepotBox from '../services/depotbox';
import type { DepotBoxGame } from '../services/depotbox';
import { getRyuuGames, type RyuuDlc } from '../services/ryuuGames';
import HomeEffects, { CursorGlow } from '../components/HomeEffects';
import BypassInstallModal from '../components/BypassInstallModal';
import PaymentModal from '../components/PaymentModal';
import CompleteProfileModal from '../components/CompleteProfileModal';
import DenuvoRemoval from './DenuvoRemoval';
import Settings from './Settings';
import ReferralPage from './ReferralPage';
import TutoriaisPage from './TutoriaisPage';

// Mapeia "tipo" legado para o `products.type` real
const PREMIUM_TYPE_MAP: Record<string, { productType: string; name: string; description: string; price: number }> = {
  bypass_premium:   { productType: 'bypass',          name: 'Bypass Premium',        description: 'Acesso a todos os bypasses premium',          price: 29.90 },
  contas_oficiais:  { productType: 'premiumaccounts', name: 'Contas Oficiais',       description: 'Acesso a contas premium oficiais',            price: 39.90 },
  multiplayer:      { productType: 'multiplayer',     name: 'Multiplayer Premium',   description: 'Recursos online com amigos',                  price: 34.90 },
  nsfw_premium:     { productType: 'nsfw',            name: 'Conteúdo +18',          description: 'Acesso a jogos adultos',                      price: 19.90 },
  adicionar_jogo:   { productType: 'add_games',       name: 'Adicionar Jogos',       description: 'Permissão para adicionar jogos personalizados', price: 24.90 },
};

// Module-level set: tracks appids whose thumbnails have already failed — no retry
const failedThumbs = new Set<string>();

interface LauncherProps {
  licenseKey: string;
  hwid: string;
  onLogout: () => void;
}

type Page = 'home' | 'premium' | 'update-launcher' | 'add-game' | 'bypass' | 'premium-accounts' | 'updates' | 'store' | 'multiplayer' | 'nsfw-games' | 'indique' | 'request-game' | 'denuvo' | 'settings' | 'tutoriais';

const Launcher: React.FC<LauncherProps> = ({ licenseKey, hwid, onLogout }) => {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [steamPath, setSteamPath] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateStatus, setUpdateStatus] = useState('');

  // Mensagens separadas por página
  const [homeMessage, setHomeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [premiumMessage, setPremiumMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [updateLauncherMessage, setUpdateLauncherMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addGameMessage, setAddGameMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isUpdatingLauncher, setIsUpdatingLauncher] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<License | null>(null);
  const [isLoadingLicenseInfo, setIsLoadingLicenseInfo] = useState<boolean>(true);
  const [chargebackToast, setChargebackToast] = useState<{ action: string; productType: string } | null>(null);
  const [isOpeningSteam, setIsOpeningSteam] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Estados para novas funcionalidades
  const [allBypass, setAllBypass] = useState<BypassWithSteamData[]>([]);
  const [bypassFilter, setBypassFilter] = useState('');
  const [showBypassWarning, setShowBypassWarning] = useState(false);
  const [bypassInstallTarget, setBypassInstallTarget] = useState<{ id: string; name: string; link: string; thumbnail?: string | null } | null>(null);
  const [multiplayerInstallTarget, setMultiplayerInstallTarget] = useState<{ name: string; link: string; thumbnail?: string | null } | null>(null);
  const [premiumAccounts, setPremiumAccounts] = useState<PremiumAccount[]>([]);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set()); // Dropdown de jogos
  const [updates, setUpdates] = useState<Update[]>([]);
  const [hasNewUpdates, setHasNewUpdates] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Estados para filtros e visualização de Bypass
  const [filterPremium, setFilterPremium] = useState(false);
  const [filterFree, setFilterFree] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [installedBypasses, setInstalledBypasses] = useState<string[]>([]);

  // Estados para Loja
  const [storeItems, setStoreItems] = useState<any[]>([]);
  const [storeFilter, setStoreFilter] = useState<'all' | 'licenca' | 'produto' | 'servico'>('all');
  const [storeSearchQuery, setStoreSearchQuery] = useState('');

  // Estados para Multiplayer
  const [multiplayerContent, setMultiplayerContent] = useState<MultiplayerWithSteamData[]>([]);
  const [multiplayerSearchQuery, setMultiplayerSearchQuery] = useState('');

  // Estados para controlar modais de bloqueio
  // Legacy modal states (kept for any residual references — replaced by PremiumModal)
  // const [showPremiumAccountsModal, setShowPremiumAccountsModal] = useState(false);
  // const [showAddGamePermissionModal, setShowAddGamePermissionModal] = useState(false);
  // const [showMultiplayerPermissionModal, setShowMultiplayerPermissionModal] = useState(false);

  // Estados para modais de tutorial
  const [showBypassTutorial, setShowBypassTutorial] = useState(false);
  const [showMultiplayerTutorial, setShowMultiplayerTutorial] = useState(false);

  // (state de modal específico de Multiplayer removido — clicar no card já abre o instalador direto)
  // const [multiplayerGameData, setMultiplayerGameData] = useState<any>(null); // removido — modal simplificado
  // const [showMultiplayerGameModal, setShowMultiplayerGameModal] = useState(false); // removido — modal simplificado
  // const [isLoadingMultiplayerGameDetails, setIsLoadingMultiplayerGameDetails] = useState(false); // removido

  // Modal de Adicionar Jogo
  const [showAddGameModal, setShowAddGameModal] = useState(false);

  // Estados para Adicionar Jogo (SteamTools)
  const [isDownloadingGame, setIsDownloadingGame] = useState(false);
  const [gamePreview, setGamePreview] = useState<{ name: string; thumbnail: string; appId: string } | null>(null);

  // Estados para Atualizar Jogos (lista com busca)
  const [updateSearchQuery, setUpdateSearchQuery] = useState('');
  const [updateGameMessage, setUpdateGameMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isUpdatingGame, setIsUpdatingGame] = useState(false);
  const [updateBulkProgress, setUpdateBulkProgress] = useState<{ current: number; total: number; currentName: string }>({ current: 0, total: 0, currentName: '' });
  const [updateSelectedGames, setUpdateSelectedGames] = useState<Set<string>>(new Set());

  // Estados para Solicitar Jogo
  const [requestGameInput, setRequestGameInput] = useState('');
  const [requestGameMessage, setRequestGameMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isRequestingGame, setIsRequestingGame] = useState(false);

  // Estados para Busca em Tempo Real (unificada)
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingGamesJson, setIsLoadingGamesJson] = useState(false);
  const [gamesDatabase, setGamesDatabase] = useState<Array<{ appid: string; name: string; header_image: string; drm?: boolean }>>([]);
  const [nsfwDatabase, setNsfwDatabase] = useState<Array<{ appid: string; name: string; header_image: string; drm?: boolean }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{ appid: string; name: string; header_image: string }>>([]);
  const [displayedResults, setDisplayedResults] = useState<Array<DepotBoxGame | { appid: string; name: string; header_image?: string }>>([]);

  // Estados para Seleção Múltipla
  const [selectedGames, setSelectedGames] = useState<Set<string | number>>(new Set()); // Set de appids (pode ser string ou number)
  const [selectedGamesData, setSelectedGamesData] = useState<Record<string, { appid: string | number; name: string }>>({}); // Dados dos jogos selecionados
  const [gamesThumbnails, setGamesThumbnails] = useState<Record<string, string>>({}); // Cache de thumbnails

  // Estados para Download em Lote
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState({ current: 0, total: 0, currentGame: '' });

  // Estados para DepotBox API
  const [depotboxResults] = useState<DepotBoxGame[]>([]);
  const [isSearchingDepotbox] = useState(false);
  const useDepotBox = true; // Toggle entre DepotBox e sistema antigo (fixo como true por enquanto)

  // Estado para scroll infinito
  const [displayLimit, setDisplayLimit] = useState(20); // Inicia mostrando 20 jogos

  // Estados para Modal de DRM Warning
  const [showDrmWarning, setShowDrmWarning] = useState(false);
  const [selectedGameForDrmWarning, setSelectedGameForDrmWarning] = useState<DepotBoxGame | null>(null);
  const [drmGameDetails, setDrmGameDetails] = useState<any>(null);
  const [isLoadingDrmDetails, setIsLoadingDrmDetails] = useState(false);


  // Estados de atualização do launcher
  const [appUpdate, setAppUpdate] = useState<{ newVersion: string; downloading: boolean; pct: number; ready: boolean; countdown: number } | null>(null);

  // Estados para Meus Jogos (home)
  const [myGames, setMyGames] = useState<Array<{ appid: string; name: string | null; thumb: string | null }>>([]);
  const [myGamesLoading, setMyGamesLoading] = useState(false);
  const [myGamesSearch, setMyGamesSearch] = useState('');
  const [myGamesFilter, setMyGamesFilter] = useState('');
  const [myGamesDisplayLimit, setMyGamesDisplayLimit] = useState(30);

  // Modal de confirmação (remover / atualizar jogo)
  const [confirmModal, setConfirmModal] = useState<{
    type: 'remove' | 'update';
    appid: string;
    name: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Modal DLC
  const [dlcModal, setDlcModal] = useState<{
    gameAppid: string;
    gameName: string;
    dlcs: RyuuDlc[];
  } | null>(null);
  const [dlcDownloading, setDlcDownloading] = useState<Set<string>>(new Set());
  const [dlcDone, setDlcDone] = useState<Set<string>>(new Set());

  const [_appVersion, setAppVersion] = useState<string>(''); // Usado para logging/debug

  // Efeitos visuais na Home
  const [effectsEnabled, setEffectsEnabled] = useState<boolean>(() => {
    return localStorage.getItem('titanforge_home_effects') !== 'false';
  });

  // Ref para o input de busca (manter foco durante pesquisa)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refs para IntersectionObserver de Meus Jogos
  const myGamesSentinelRef = useRef<HTMLDivElement>(null);
  const myGamesGridWrapperRef = useRef<HTMLDivElement>(null);
  const myGamesObserverRef = useRef<IntersectionObserver | null>(null);

  // Toast de acesso premium
  const [premiumToast, setPremiumToast] = useState(false);

  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});

  // PixPurchaseModal — usado para todos os produtos premium (substitui Kirvano)
  const [pixPurchaseProduct, setPixPurchaseProduct] = useState<{ type: string; name: string; price: number; description?: string } | null>(null);

  const openPremiumModal = (_titulo: string, _descricao: string, tipo: string) => {
    const mapping = PREMIUM_TYPE_MAP[tipo];
    if (!mapping) return;
    setPixPurchaseProduct({
      type: mapping.productType,
      name: mapping.name,
      description: mapping.description,
      price: mapping.price,
    });
  };


  // Helper: detecta se é modo teste
  const isTestMode = useMemo(() => {
    return licenseInfo?.license_type === 3;
  }, [licenseInfo]);

  // Helper: verifica se acesso está bloqueado (suspenso/inativo)
  // Não bloqueia enquanto licenseInfo ainda está carregando — evita flash de "Acesso Bloqueado".
  const isBlocked = useMemo(() => {
    if (isLoadingLicenseInfo) return false;
    return !licenseInfo ||
           licenseInfo.status === 'suspended' ||
           licenseInfo.status !== 'active';
  }, [licenseInfo, isLoadingLicenseInfo]);

  // Helper: verifica se recursos devem ser restritos (bloqueado OU teste)
  const isRestricted = useMemo(() => {
    return isBlocked || isTestMode;
  }, [isBlocked, isTestMode]);

  // Carregar checkout links + social links uma vez no boot
  useEffect(() => {
    (async () => {
      try {
        const map = await getSocialLinkMap();
        setSocialLinks(map);
      } catch (e) {
        console.error('Erro ao carregar social links:', e);
      }
    })();
  }, []);

  useEffect(() => {
    // Detectar caminho da Steam
    window.electron.detectSteamPath().then((result) => {
      if (result.success && result.path) {
        setSteamPath(result.path);
      }
    });

    // Configurar listeners de progresso
    window.electron.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
    });

    window.electron.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });

    // Listeners para abertura da Steam
    const handleSteamOpened = () => {
      setIsOpeningSteam(false);
      setHomeMessage({ type: 'success', text: 'Steam aberta com sucesso!' });
    };

    const handleSteamError = (error: string) => {
      setIsOpeningSteam(false);
      setHomeMessage({ type: 'error', text: error });
    };

    const handleAppClosing = () => {
      setIsClosing(true);
    };

    window.electron.on('steam-opened', handleSteamOpened);
    window.electron.on('steam-error', handleSteamError);
    window.electron.on('app-closing', handleAppClosing);

    // ===== AUTO-UPDATE: Event Listeners =====

    window.electron.getAppVersion().then(({ version }) => {
      setAppVersion(version);
      console.log('📱 Versão do app:', version);
    });

    // Buscar informações da licença
    setIsLoadingLicenseInfo(true);
    getLicenseInfo(licenseKey)
      .then((info) => {
        if (info) setLicenseInfo(info);
      })
      .finally(() => setIsLoadingLicenseInfo(false));

    // HOT-RELOAD: começa a observar mudanças (realtime + polling fallback de 15s)
    window.electron.licenseWatch(licenseKey).catch(() => {});
    window.electron.onLicenseChanged((fresh: any) => {
      if (fresh) setLicenseInfo(fresh as License);
    });

    // Toast quando um chargeback for detectado em uma compra dessa licença
    window.electron.onChargebackDetected((data) => {
      if (String(data.licenseKey).toUpperCase() === licenseKey.toUpperCase()) {
        setChargebackToast({
          action: data.action,
          productType: data.productType,
        });
        // Atualiza license info imediatamente
        getLicenseInfo(licenseKey).then((fresh) => fresh && setLicenseInfo(fresh)).catch(() => {});
      }
    });

    // Iniciar heartbeat
    heartbeat.start(licenseKey, hwid, handleLicenseInactive);

    return () => {
      heartbeat.stop();
      window.electron.licenseUnwatch().catch(() => {});
      window.electron.offLicenseChanged();
      window.electron.off('steam-opened', handleSteamOpened);
      window.electron.off('steam-error', handleSteamError);
      window.electron.off('app-closing', handleAppClosing);
    };
  }, [licenseKey, hwid]);

  // Carregar dados das novas funcionalidades + configurar listener de eventos Steam
  useEffect(() => {
    // Carregar bypasses instalados do localStorage
    const installed = localStorage.getItem('installed_bypasses');
    if (installed) {
      setInstalledBypasses(JSON.parse(installed));
    }

    // 1️⃣ PRIMEIRO: Configurar listener de eventos Steam (ANTES do prefetch!)
    const handleSteamDataLoaded = (event: Event) => {
      const customEvent = event as CustomEvent<{ appId: string; steamData: any }>;

      // Validar evento
      if (!customEvent.detail || !customEvent.detail.appId || !customEvent.detail.steamData) {
        console.warn('Invalid steam-data-loaded event', event);
        return;
      }

      const { appId, steamData } = customEvent.detail;

      // Atualizar bypass list
      setAllBypass((prevBypass) =>
        prevBypass.map((bypass) =>
          bypass.game_id === appId
            ? {
                ...bypass,
                name: steamData.name,
                thumbnail: steamData.header_image,
                steam_appid: steamData.steam_appid,
                isLoadingThumbnail: false
              }
            : bypass
        )
      );

      // Atualizar multiplayer list
      setMultiplayerContent((prevMultiplayer) =>
        prevMultiplayer.map((item) =>
          item.game_id === appId
            ? {
                ...item,
                name: steamData.name,
                thumbnail: steamData.header_image,
                steam_appid: steamData.steam_appid,
                isLoadingThumbnail: false
              }
            : item
        )
      );
    };

    window.addEventListener('steam-data-loaded', handleSteamDataLoaded);

    // 2️⃣ DEPOIS: Prefetch global em background
    console.log('🚀 Starting global prefetch...');

    // Carregar listas (retornam IMEDIATAMENTE com cache/placeholder)
    const prefetchData = async () => {
      try {
        // Ambos em paralelo
        const [bypasses, multiplayer] = await Promise.all([
          getBypassList(),
          getMultiplayerContent()
        ]);

        // Setar estados (UI já mostra com "Carregando...")
        setAllBypass(bypasses);
        setMultiplayerContent(multiplayer);

        console.log('✅ Prefetch initiated:', {
          bypass: bypasses.length,
          multiplayer: multiplayer.length
        });
      } catch (error) {
        console.error('Erro no prefetch:', error);
      }
    };

    prefetchData();

    // Carregar contas premium
    getPremiumAccounts().then(setPremiumAccounts).catch(console.error);

    // Carregar itens da loja
    getStoreItems().then(setStoreItems).catch(console.error);

    // Carregar atualizações e criar primeira se necessário
    createInitialUpdate().then(() => {
      getUpdates().then((updatesList) => {
        setUpdates(updatesList);
        setHasNewUpdates(hasUnreadUpdates(updatesList));
      }).catch(console.error);
    });

    // Verificar se deve mostrar aviso de bypass
    const warningDismissed = localStorage.getItem('titanforge_bypass_warning_dismissed');
    if (!warningDismissed) {
      // Não mostrar ainda, só quando acessar premium tab
    }

    // Cleanup
    return () => {
      window.removeEventListener('steam-data-loaded', handleSteamDataLoaded);
    };
  }, []);

  // Carregar bypasses instalados do localStorage
  useEffect(() => {
    const installed = localStorage.getItem('installed_bypasses');
    if (installed) {
      try {
        setInstalledBypasses(JSON.parse(installed));
      } catch (error) {
        console.error('Error loading installed bypasses:', error);
      }
    }
  }, []);

  // Cache helpers (chave por licença)
  const myGamesCacheKey = `titanforge_my_games_${licenseKey}`;

  // Hidrata o cache imediatamente ao montar (não bloqueia UI)
  useEffect(() => {
    try {
      const cached = localStorage.getItem(myGamesCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.games)) setMyGames(parsed.games);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseKey]);

  // Carregar lista de Meus Jogos (mostra cache + atualiza em background)
  const loadMyGames = async (silent = false) => {
    // Só mostra spinner se não tem cache ainda
    if (!silent && myGames.length === 0) setMyGamesLoading(true);
    try {
      const [result, ryuuGames] = await Promise.all([
        window.electron.getMyGames(),
        getRyuuGames().catch(() => []),
      ]);
      if (result.success) {
        const ryuuMap = new Map(ryuuGames.map(g => [g.appid, g]));
        const enriched = result.games.map(g => {
          const ryuu = ryuuMap.get(g.appid);
          return {
            appid: g.appid,
            name: ryuu?.name || g.name || null,
            thumb: ryuu?.header_image || null,
          };
        });
        setMyGames(enriched);
        // Persiste cache para próxima abertura — instantâneo
        try {
          localStorage.setItem(myGamesCacheKey, JSON.stringify({ games: enriched, ts: Date.now() }));
        } catch {}
      }
    } catch (error) {
      console.error('Erro ao carregar meus jogos:', error);
    } finally {
      setMyGamesLoading(false);
    }
  };

  useEffect(() => {
    if (currentPage === 'home') {
      // Always refresh in background; UI já mostra cache (se existe)
      const hasCache = myGames.length > 0;
      if (!hasCache) {
        loadMyGames(false);
        setMyGamesDisplayLimit(20);
        setMyGamesSearch('');
        setMyGamesFilter('');
      } else {
        // Atualiza em background sem travar a UI
        loadMyGames(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Debounce search → filter
  useEffect(() => {
    const t = setTimeout(() => {
      setMyGamesFilter(myGamesSearch);
      setMyGamesDisplayLimit(30);
    }, 200);
    return () => clearTimeout(t);
  }, [myGamesSearch]);


  // Auto-dismiss do toast premium
  useEffect(() => {
    if (!premiumToast) return;
    const t = setTimeout(() => setPremiumToast(false), 4000);
    return () => clearTimeout(t);
  }, [premiumToast]);

  // Controlar abertura automática dos modais foi MOVIDO para o handler de navegação
  // para evitar transição visual estranha (modal abrindo depois da página mudar)

  // Verificar status suspended e fazer logout automático
  useEffect(() => {
    if (licenseInfo && licenseInfo.status === 'suspended') {
      console.log('🚫 LICENÇA SUSPENSA - BLOQUEIO TOTAL');

      // 1. DESABILITAR DLL imediatamente
      window.electron.disableHidDll().then(() => {
        console.log('✅ DLL desabilitada');
      });

      // 2. REMOVER licença salva
      removeSavedLicense();

      // 3. LOGOUT IMEDIATO (sem delay)
      setTimeout(() => {
        onLogout();
      }, 50); // 50ms apenas para DLL desabilitar
    }
  }, [licenseInfo, onLogout]);

  // Listeners do autoUpdater
  useEffect(() => {
    window.electron.onUpdateAvailable((data) => {
      setAppUpdate({ newVersion: data.newVersion, downloading: true, pct: 0, ready: false, countdown: 5 });
    });
    window.electron.onUpdateDownloadProgress((data) => {
      setAppUpdate(prev => prev ? { ...prev, pct: Math.round(data.percent) } : prev);
    });
    window.electron.onUpdateDownloaded((data) => {
      setAppUpdate(prev => prev ? { ...prev, downloading: false, ready: true, countdown: 5 } : { newVersion: data.version, downloading: false, pct: 100, ready: true, countdown: 5 });
    });
    window.electron.onUpdateError(() => {
      // Silencia erros de update para não atrapalhar o usuário
    });
  }, []);

  // Countdown quando atualização está pronta
  useEffect(() => {
    if (!appUpdate?.ready) return;
    if (appUpdate.countdown <= 0) {
      window.electron.installAndRestart?.().catch(() => {});
      return;
    }
    const t = setTimeout(() => {
      setAppUpdate(prev => prev ? { ...prev, countdown: prev.countdown - 1 } : prev);
    }, 1000);
    return () => clearTimeout(t);
  }, [appUpdate?.ready, appUpdate?.countdown]);

  // Removido: Contador de tempo restante (não há mais licenças mensais)

  // Carregar games.json da Ryuu Generator (via IPC, sem CORS)
  useEffect(() => {
    const loadGamesDatabase = async () => {
      if (gamesDatabase.length > 0) return;

      setIsLoadingGamesJson(true);
      try {
        console.log('📂 Carregando games.json da Ryuu (IPC)...');
        const result = await window.electron.fetchRyuuGames();

        if (!result.success || !result.games) {
          throw new Error(result.error || 'Falha ao carregar games.json');
        }

        console.log(`📊 Total bruto recebido: ${result.games.length}`);

        // Diagnóstico: contar tipos distintos
        const typeCounts: Record<string, number> = {};
        for (const item of result.games) {
          const t = String((item as any).type || 'undefined');
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
        console.log('📊 Contagem por type:', typeCounts);

        // Aceitar TUDO que tiver appid + name válidos (excluir só DLC/music/soundtrack)
        const excludedTypes = new Set(['dlc', 'music', 'soundtrack', 'video', 'series', 'episode', 'hardware', 'advertising', 'mod']);
        const allValid = result.games
          .filter((item: any) => {
            if (!item?.appid || !item?.name) return false;
            const t = String(item.type || '').toLowerCase().trim();
            if (excludedTypes.has(t)) return false;
            return true;
          })
          .map((item: any) => ({
            appid: String(item.appid),
            name: String(item.name || ''),
            header_image: item.header_image || 'https://ryuu.lol/manifests/placeholder.png',
            drm: item.drm === true,
            nsfw: item.nsfw === true,
          }));

        // Separar nsfw=true dos jogos normais
        const games = allValid.filter((g: any) => !g.nsfw);
        const nsfwGames = allValid.filter((g: any) => g.nsfw);

        setGamesDatabase(games);
        setNsfwDatabase(nsfwGames);
        console.log(`✅ ${games.length} jogos carregados da Ryuu (após filtros)`);
      } catch (error: any) {
        console.error('❌ Erro ao carregar games.json:', error);
        setAddGameMessage({ type: 'error', text: `Erro ao carregar banco de dados de jogos: ${error.message}` });
      } finally {
        setIsLoadingGamesJson(false);
      }
    };

    loadGamesDatabase();
  }, []);

  // Busca desabilitada: agora usamos o games.json da Ryuu (ver useEffect abaixo)


  // Reset displayLimit quando searchQuery muda
  useEffect(() => {
    setDisplayLimit(20);
  }, [searchQuery]);

  // Scroll infinito para carregar mais jogos
  useEffect(() => {
    if (!showAddGameModal) return;

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      const scrollPercentage =
        (target.scrollTop + target.clientHeight) / target.scrollHeight;

      // Se chegou a 80% do scroll, carregar mais 20 jogos
      if (scrollPercentage > 0.8 && displayLimit < displayedResults.length) {
        setDisplayLimit(prev => Math.min(prev + 20, displayedResults.length));
      }
    };

    const modalContent = document.querySelector('.results-scrollable');
    modalContent?.addEventListener('scroll', handleScroll);

    return () => modalContent?.removeEventListener('scroll', handleScroll);
  }, [showAddGameModal, displayLimit, displayedResults.length]);

  // Restaurar foco no input quando a busca terminar
  useEffect(() => {
    if (!isSearchingDepotbox && searchInputRef.current && showAddGameModal) {
      searchInputRef.current.focus();
    }
  }, [isSearchingDepotbox, showAddGameModal]);

  // Busca live na base da Ryuu (nome ou appid, atualiza a cada letra)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setDisplayedResults([]);
      setGamePreview(null);
      return;
    }

    if (gamesDatabase.length === 0) {
      console.log('⏳ gamesDatabase ainda vazio, aguardando carregar...');
      return;
    }

    const input = searchQuery.trim();
    const isAppId = /^\d+$/.test(input);
    const query = input.toLowerCase();

    console.log(`🔍 Buscando ${isAppId ? 'appid' : 'nome'}: "${input}" em ${gamesDatabase.length} jogos`);

    const results = gamesDatabase
      .filter(game =>
        isAppId
          ? game.appid === input
          : game.name.toLowerCase().includes(query)
      )
      .slice(0, 500);

    console.log(`📊 ${results.length} resultados`);

    setSearchResults(results);
    setDisplayedResults(results.slice(0, 50));

    setGamesThumbnails(prev => {
      const next = { ...prev };
      results.forEach(g => {
        if (!next[g.appid]) next[g.appid] = g.header_image;
      });
      return next;
    });

    setGamePreview(null);
  }, [searchQuery, gamesDatabase]);

  // Scroll infinito
  useEffect(() => {
    if (displayedResults.length >= searchResults.length) return;

    const handleScroll = (e: any) => {
      const bottom = e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 200;

      if (bottom && displayedResults.length < searchResults.length) {
        const newLimit = Math.min(displayedResults.length + 50, searchResults.length);
        setDisplayedResults(searchResults.slice(0, newLimit));
      }
    };

    const contentArea = document.querySelector('.content-area-add-game');
    contentArea?.addEventListener('scroll', handleScroll);

    return () => contentArea?.removeEventListener('scroll', handleScroll);
  }, [displayedResults, searchResults]);

  // Thumbnails agora vêm diretamente do header_image no games.json (sem lazy-load)

  const handleLicenseInactive = async () => {
    setHomeMessage({
      type: 'error',
      text: 'Sua licença foi desativada. Os arquivos serão removidos.',
    });

    // Remover arquivos da Steam
    if (steamPath) {
      await window.electron.cleanupSteamFiles(steamPath);
    }

    // Remover licença local e fazer logout
    removeSavedLicense();

    setTimeout(() => {
      onLogout();
    }, 3000);
  };

  const handleUpdateSteam = async () => {
    // Guard: bloquear se licença suspensa OU modo teste
    if (isRestricted) {
      setPremiumMessage({
        type: 'error',
        text: isTestMode ? 'Esta função não está disponível no modo teste.' : 'Sua licença expirou. Não é possível realizar esta ação.'
      });
      return;
    }

    if (!steamPath) {
      setPremiumMessage({ type: 'error', text: 'Steam não encontrada. Instale a Steam primeiro.' });
      return;
    }

    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateStatus('Preparando instalação...');
    setPremiumMessage(null);

    try {
      // Buscar URL de download do backend (Supabase)
      const downloadUrl = await getDownloadUrl();

      if (!downloadUrl) {
        setPremiumMessage({ type: 'error', text: 'Erro de conexão. Tente novamente.' });
        setIsUpdating(false);
        return;
      }

      setUpdateStatus('Baixando arquivos...');

      // Realizar download e instalação
      const result = await window.electron.updateSteam(steamPath, downloadUrl);

      if (result.success) {
        setPremiumMessage({ type: 'success', text: 'Instalação concluída com sucesso!' });
        try {
          const updated = await window.electron.getMyGames();
          if (updated.success) setMyGames(updated.games.map((g: any) => ({ appid: String(g.appid), name: g.name, thumb: null })));
        } catch {}
      } else {
        setPremiumMessage({ type: 'error', text: 'Erro durante a instalação. Tente novamente.' });
      }
    } catch (error: any) {
      setPremiumMessage({ type: 'error', text: 'Erro durante a instalação. Tente novamente.' });
    } finally {
      setIsUpdating(false);
      setUpdateProgress(0);
      setUpdateStatus('');
    }
  };

  // Handler para download do pacote de teste
  const handleDownloadTestPackage = async () => {
    if (!steamPath) {
      setPremiumMessage({ type: 'error', text: 'Steam não encontrada. Instale a Steam primeiro.' });
      return;
    }

    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateStatus('Preparando instalação do pacote de teste...');
    setPremiumMessage(null);

    try {
      // Buscar URL do pacote de teste
      const downloadUrl = await getTestDownloadUrl();

      if (!downloadUrl) {
        setPremiumMessage({ type: 'error', text: 'Pacote de teste não disponível no momento.' });
        setIsUpdating(false);
        return;
      }

      setUpdateStatus('Baixando pacote de teste...');

      // Usar mesma função IPC do premium
      const result = await window.electron.updateSteam(steamPath, downloadUrl);

      if (result.success) {
        setPremiumMessage({ type: 'success', text: 'Pacote de teste instalado com sucesso!' });
      } else {
        setPremiumMessage({ type: 'error', text: 'Erro durante a instalação. Tente novamente.' });
      }
    } catch (error: any) {
      setPremiumMessage({ type: 'error', text: 'Erro durante a instalação. Tente novamente.' });
    } finally {
      setIsUpdating(false);
      setUpdateProgress(0);
      setUpdateStatus('');
    }
  };

  const handleUpdateLauncher = async () => {
    // Guard: bloquear se licença suspensa
    if (isBlocked) {
      setUpdateLauncherMessage({ type: 'error', text: 'Sua licença expirou. Não é possível realizar esta ação.' });
      return;
    }

    setIsUpdatingLauncher(true);
    setUpdateLauncherMessage(null);

    try {
      // ✅ OBRIGATÓRIO: Garantir que xinput1_4.dll está presente ANTES do PowerShell
      console.log('🔍 Verificando xinput1_4.dll...');
      const ensureResult = await window.electron.ensureHidDll();

      if (!ensureResult.success) {
        setUpdateLauncherMessage({
          type: 'error',
          text: `Erro ao preparar atualização: ${ensureResult.error}`
        });
        setIsUpdatingLauncher(false);
        return;
      }

      console.log('✅ xinput1_4.dll confirmado como presente');

      // Buscar comando dinâmico do Supabase
      console.log('🔍 Buscando comando de atualização...');
      const command = await getLauncherUpdateCommand();

      if (!command) {
        setUpdateLauncherMessage({
          type: 'error',
          text: 'Comando de atualização não configurado. Contate o suporte.'
        });
        setIsUpdatingLauncher(false);
        return;
      }

      console.log('🔄 Executando comando de atualização:', command);

      // Executar comando PowerShell dinâmico
      const result = await window.electron.runPowerShellCommand(command);

      if (result.success) {
        setUpdateLauncherMessage({ type: 'success', text: 'Launcher atualizado com sucesso!' });
      } else {
        setUpdateLauncherMessage({
          type: 'error',
          text: result.error || 'Erro ao atualizar o launcher.'
        });
      }
    } catch (error: any) {
      setUpdateLauncherMessage({
        type: 'error',
        text: error.message || 'Erro ao executar atualização.'
      });
    } finally {
      setIsUpdatingLauncher(false);
    }
  };


  // Toggle seleção de jogo
  const toggleGameSelection = (appid: string | number) => {
    const appidStr = String(appid);
    setSelectedGames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(appid)) {
        newSet.delete(appid);
        // Remover dados do jogo também
        setSelectedGamesData(prevData => {
          const newData = { ...prevData };
          delete newData[appidStr];
          return newData;
        });
        console.log(`❌ ${appid} desmarcado`);
      } else {
        newSet.add(appid);
        // Adicionar dados do jogo
        const game = depotboxResults.find(g => String(g.appid) === String(appid)) ||
                     displayedResults.find(g => String(g.appid) === String(appid));
        if (game) {
          setSelectedGamesData(prevData => ({
            ...prevData,
            [appidStr]: { appid, name: game.name }
          }));
        }
        console.log(`✅ ${appid} marcado`);
      }
      return newSet;
    });
  };

  // Download em lote sequencial
  const handleBulkDownload = async () => {
    if (selectedGames.size === 0) return;

    setIsBulkDownloading(true);
    setBulkDownloadProgress({ current: 0, total: selectedGames.size, currentGame: '' });

    const selectedArray = Array.from(selectedGames);

    // Se useDepotBox estiver ativo, usar o fluxo DepotBox
    if (useDepotBox && depotboxResults.length > 0) {
      try {
        console.log('📦 [DepotBox] Iniciando download em lote de', selectedArray.length, 'jogos');

        // Mapear nomes dos jogos usando selectedGamesData
        const gameNames: Record<string, string> = Object.fromEntries(
          Object.entries(selectedGamesData).map(([appid, data]) => [appid, data.name])
        );

        setAddGameMessage({ type: 'success', text: '⏳ Preparando download...' });

        // Passo 1: Iniciar download em lote
        const token = await DepotBox.initiateBatchDownload(selectedArray, false);
        console.log('✅ [DepotBox] Token recebido:', token);

        setAddGameMessage({ type: 'success', text: '⏳ Processando arquivos no servidor...' });

        // Passo 2: Poll status até completar
        const finalStatus = await DepotBox.pollUntilComplete(token, (status) => {
          console.log('📊 [DepotBox] Status:', status.status, status.message);
          setAddGameMessage({
            type: 'success',
            text: status.message || 'Processando...'
          });
        });

        console.log('✅ [DepotBox] Download pronto:', finalStatus.finalUserZipName);
        setAddGameMessage({ type: 'success', text: '⬇️ Baixando e instalando arquivos...' });

        // Passo 3: Baixar e extrair para Steam
        if (!finalStatus.download_link) {
          throw new Error('Link de download não recebido');
        }

        const result = await window.electron.depotboxBatchDownloadAndExtract(
          finalStatus.download_link,
          selectedArray.map(String), // Convert to string
          gameNames
        );

        if (result.success) {
          setAddGameMessage({
            type: 'success',
            text: `✅ ${selectedArray.length} jogo(s) instalado(s) com sucesso! Steam reiniciada.`
          });
          console.log('✅ [DepotBox] Instalação concluída:', result.filesExtracted);
          // Limpar seleções após sucesso
          setSelectedGames(new Set());
          setSelectedGamesData({});
        } else {
          throw new Error(result.error || 'Erro desconhecido');
        }
      } catch (error: any) {
        console.error('❌ Erro no download em lote:', error);
        setAddGameMessage({
          type: 'error',
          text: 'Erro ao processar download. Tentando método alternativo...'
        });

        // Fallback para o método antigo
        await handleBulkDownloadLegacy(selectedArray.map(String));
        return;
      } finally {
        setIsBulkDownloading(false);
        // Não limpar selectedGames e searchQuery aqui para permitir múltiplas seleções
      }
    } else {
      // Método legado (sistema antigo)
      await handleBulkDownloadLegacy(selectedArray.map(String));
    }
  };

  // Função auxiliar para download legado (sistema antigo)
  const handleBulkDownloadLegacy = async (selectedArray: string[]) => {
    let successCount = 0;
    let failedGames: string[] = [];

    for (let i = 0; i < selectedArray.length; i++) {
      const appid = selectedArray[i];
      // Use selectedGamesData as source of truth — persists across search changes
      const gameName =
        selectedGamesData[appid]?.name ||
        searchResults.find(g => g.appid === appid)?.name ||
        gamesDatabase.find(g => g.appid === appid)?.name ||
        appid;

      setBulkDownloadProgress({
        current: i + 1,
        total: selectedArray.length,
        currentGame: gameName,
      });

      console.log(`📥 [${i + 1}/${selectedArray.length}] Baixando: ${gameName} (${appid})`);

      try {
        // Verificar xinput1_4.dll
        const ensureResult = await window.electron.ensureHidDll();
        if (!ensureResult.success) {
          failedGames.push(gameName);
          console.error(`❌ Erro xinput1_4.dll para ${gameName}`);
          continue;
        }

        // Baixar jogo (skipRestart: true para não reiniciar Steam a cada download)
        const result = await window.electron.downloadManifestorLua(appid, gameName, true);

        if (result.success) {
          successCount++;
          console.log(`✅ ${gameName} instalado com sucesso`);
        } else {
          failedGames.push(gameName);
          console.error(`❌ Falha ao baixar ${gameName}: ${result.error}`);
        }
      } catch (error) {
        failedGames.push(gameName);
        console.error(`❌ Erro ao processar ${gameName}:`, error);
      }

      // Delay de 2s entre downloads para não sobrecarregar
      if (i < selectedArray.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Reiniciar Steam após TODOS os downloads
    if (successCount > 0) {
      console.log('✅ Todos downloads concluídos. Reiniciando Steam...');
      try {
        const steamPathResult = await window.electron.detectSteamPath();
        if (steamPathResult.success && steamPathResult.path) {
          await window.electron.restartSteam(steamPathResult.path);
          console.log('✅ Steam reiniciada com sucesso');
        }
      } catch (error) {
        console.error('❌ Erro ao reiniciar Steam:', error);
      }
    }

    // Mensagem final
    if (failedGames.length === 0) {
      setAddGameMessage({
        type: 'success',
        text: `✅ ${successCount} jogo(s) instalado(s) com sucesso! Steam reiniciada.`
      });
    } else {
      setAddGameMessage({
        type: 'error',
        text: `⚠️ ${successCount} jogo(s) instalado(s). ${failedGames.length} falhou(aram): ${failedGames.slice(0, 3).join(', ')}${failedGames.length > 3 ? '...' : ''}`
      });
    }

    // Limpar seleção ao final
    setSelectedGames(new Set());
    setSelectedGamesData({});
    setIsBulkDownloading(false);
  };

  const handleAddGame = async () => {
    if (!gamePreview) {
      setAddGameMessage({ type: 'error', text: 'Busque o jogo primeiro antes de adicionar' });
      return;
    }

    setIsDownloadingGame(true);
    setAddGameMessage(null);

    try {
      // ✅ OBRIGATÓRIO: Garantir que xinput1_4.dll está presente ANTES de baixar o jogo
      console.log('🔍 Verificando xinput1_4.dll...');
      const ensureResult = await window.electron.ensureHidDll();

      if (!ensureResult.success) {
        setAddGameMessage({
          type: 'error',
          text: `Erro ao preparar sistema: ${ensureResult.error}`
        });
        return;
      }

      console.log('✅ xinput1_4.dll confirmado como presente');

      // Agora sim, baixar o jogo usando o ID do preview
      const result = await window.electron.downloadManifestorLua(gamePreview.appId, gamePreview.name);

      if (result.success) {
        setAddGameMessage({
          type: 'success',
          text: `${gamePreview.name} adicionado com sucesso! Steam reiniciada.`,
        });
        setSearchQuery(''); // Limpar campo após sucesso
        setGamePreview(null); // Limpar preview
      } else {
        setAddGameMessage({
          type: 'error',
          text: result.error || 'Erro ao baixar o jogo',
        });
      }
    } catch (error: any) {
      setAddGameMessage({ type: 'error', text: 'Erro ao baixar o jogo. Tente novamente.' });
    } finally {
      setIsDownloadingGame(false);
    }
  };

  // Filtrar Meus Jogos
  const filteredMyGames = useMemo(() => {
    const q = myGamesFilter.trim().toLowerCase();
    if (!q) return myGames;
    return myGames.filter(g => (g.name || '').toLowerCase().includes(q) || g.appid.includes(q));
  }, [myGames, myGamesFilter]);

  const displayedMyGames = useMemo(() => filteredMyGames.slice(0, myGamesDisplayLimit), [filteredMyGames, myGamesDisplayLimit]);

  // IntersectionObserver para scroll infinito de Meus Jogos (anti-loop)
  useEffect(() => {
    // Disconnect previous observer first
    if (myGamesObserverRef.current) {
      myGamesObserverRef.current.disconnect();
      myGamesObserverRef.current = null;
    }

    // Only observe if there are more items to load
    if (myGamesDisplayLimit >= filteredMyGames.length) return;
    const sentinel = myGamesSentinelRef.current;
    const wrapper = myGamesGridWrapperRef.current;
    if (!sentinel || !wrapper) return;

    let triggered = false; // anti-loop flag: only fires once per observation cycle

    myGamesObserverRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered) {
          triggered = true;
          setMyGamesDisplayLimit(prev => Math.min(prev + 20, filteredMyGames.length));
        }
      },
      { root: wrapper, rootMargin: '0px', threshold: 0.1 }
    );

    myGamesObserverRef.current.observe(sentinel);
    return () => {
      if (myGamesObserverRef.current) myGamesObserverRef.current.disconnect();
    };
  }, [myGamesDisplayLimit, filteredMyGames.length]);

  // Calcular estatísticas dos bypasses
  const bypassStats = useMemo(() => {
    const totalBypasses = allBypass.length;
    const premiumCount = allBypass.filter(b => b.status === 'premium').length;
    const freeCount = allBypass.filter(b => b.status === 'free').length;
    const installedCount = installedBypasses.length;

    return { totalBypasses, premiumCount, freeCount, installedCount };
  }, [allBypass, installedBypasses]);

  // Filtrar bypasses (unificado: free + premium + filtros)
  const filteredBypass = useMemo(() => {
    return allBypass.filter(bypass => {
      // Filtro de busca
      const matchesSearch = !bypassFilter.trim() ||
        bypass.name.toLowerCase().includes(bypassFilter.toLowerCase());

      // Se nenhum filtro ativo, mostra todos
      if (!filterPremium && !filterFree) {
        return matchesSearch;
      }

      // Filtros Premium e Free são independentes
      const matchesPremiumFilter = filterPremium && bypass.status === 'premium';
      const matchesFreeFilter = filterFree && bypass.status === 'free';

      return matchesSearch && (matchesPremiumFilter || matchesFreeFilter);
    });
  }, [allBypass, bypassFilter, filterPremium, filterFree]);

  // Ordenar bypasses
  const sortedBypass = useMemo(() => {
    return [...filteredBypass].sort((a, b) => {
      const compareResult = a.name.localeCompare(b.name, 'pt-BR');
      return sortOrder === 'asc' ? compareResult : -compareResult;
    });
  }, [filteredBypass, sortOrder]);

  // Filtrar itens da loja
  const filteredStoreItems = useMemo(() => {
    let items = storeItems;

    // Filtrar por categoria
    if (storeFilter !== 'all') {
      items = items.filter(item => item.categoria === storeFilter);
    }

    // Filtrar por busca
    if (storeSearchQuery.trim()) {
      items = items.filter(item =>
        item.nome.toLowerCase().includes(storeSearchQuery.toLowerCase()) ||
        item.descricao.toLowerCase().includes(storeSearchQuery.toLowerCase())
      );
    }

    return items;
  }, [storeItems, storeFilter, storeSearchQuery]);

  const navItems: { id: Page; label: string; icon: React.ReactNode; badge?: boolean; isPremium?: boolean; flame?: boolean }[] = [
    { id: 'home',             label: 'Home',              icon: <IconHome /> },
    { id: 'add-game',         label: 'Adicionar Jogo',    icon: <IconPlus />,    isPremium: true },
    { id: 'premium',          label: 'Pacote Premium',    icon: <IconStar /> },
    { id: 'update-launcher',  label: 'Atualizar Steam',icon: <IconDownload /> },
    { id: 'request-game',     label: 'Solicitar Jogo',    icon: <IconSend /> },
    { id: 'bypass',           label: 'Bypass',            icon: <IconShield />,  isPremium: true },
    { id: 'premium-accounts', label: 'Contas Oficiais',   icon: <IconUser />,    isPremium: true },
    { id: 'multiplayer',      label: 'Multiplayer',       icon: <IconUsers />,   isPremium: true },
    { id: 'nsfw-games',       label: '+18',               icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>, isPremium: true },
    { id: 'store',            label: 'Loja',              icon: <IconShop /> },
    { id: 'updates',          label: 'Atualizações',      icon: <IconBell />,    badge: hasNewUpdates },
    { id: 'indique',          label: 'Indique e Ganhe',   icon: <IconGift /> },
    { id: 'tutoriais',        label: 'Tutoriais',         icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
    { id: 'settings',         label: 'Configurações',     icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  ];

  // Tela de loading inicial — evita flash de "Acesso Bloqueado" enquanto licenseInfo carrega
  if (isLoadingLicenseInfo) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--bg-root)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18,
      }}>
        <img
          src="assets/logo.png"
          alt="TitanForge"
          style={{ width: 56, height: 56, filter: 'drop-shadow(0 0 24px rgba(124,92,252,0.55))', animation: 'logoPulse 2.4s ease-in-out infinite' }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 } as React.CSSProperties} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
            Carregando seus dados...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex relative" style={{ background: 'var(--bg-root)' }}>
      {/* Background orbs */}
      <div className="orb orb-purple" />
      <div className="orb orb-red" />
      <div className="orb orb-teal" />

      {/* Cursor glow — all pages */}
      <CursorGlow enabled={effectsEnabled} />

      {/* Home particles — home only */}
      {currentPage === 'home' && <HomeEffects enabled={effectsEnabled} />}

      {/* OVERLAY PRIMEIRO - PRIORIDADE MÁXIMA */}
      {isBlocked && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 999999, background: 'rgba(8,8,9,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'all' }}
          onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onTouchStartCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="card" style={{ textAlign: 'center', padding: '32px 28px', maxWidth: '380px', borderColor: 'var(--red-border)' }}>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>🚫</div>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Acesso Bloqueado</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
              Licença inválida ou expirada. Faça login novamente.
            </p>
            <button onClick={() => onLogout()} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '9px' }}>
              Fazer Login
            </button>
          </div>
        </div>
      )}

      {/* Modal de fechamento */}
      {isClosing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(8,8,9,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Fechando Steam...</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Aguarde alguns segundos</p>
          </div>
        </div>
      )}

      {/* Draggable area */}
      <div
        className="absolute top-0 left-0 right-0 h-12 z-40"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Window controls */}
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 10px', zIndex: 50, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => { if (isBlocked) return; window.electron.minimizeApp(); }}
          disabled={isBlocked}
          className="btn-ghost"
          style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', fontSize: '16px', lineHeight: 1 }}
          title="Minimizar"
        >
          −
        </button>
        <button
          onClick={() => { if (isBlocked) return; window.electron.maximizeApp(); }}
          disabled={isBlocked}
          className="btn-ghost"
          style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}
          title="Maximizar"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" style={{ color: 'var(--text-secondary)' }}>
            <rect x="1" y="1" width="9" height="9" stroke="currentColor" fill="none" strokeWidth="1.5"/>
          </svg>
        </button>
        <button
          onClick={() => { if (isBlocked) return; window.electron.closeApp(); }}
          disabled={isBlocked}
          className="btn-ghost btn-danger"
          style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', fontSize: '18px', lineHeight: 1 }}
          title="Fechar"
        >
          ×
        </button>
      </div>

      {/* Sidebar */}
      {/* SIDEBAR */}
      <motion.div
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.25 }}
        className="sidebar flex flex-col flex-shrink-0"
        style={{ width: '176px', zIndex: 20 }}
      >
        {/* Logo */}
        <div className="px-4 pt-5 pb-3 flex flex-col items-center">
          <img
            src="assets/logo.png"
            alt="TitanForge Logo"
            style={{ width: '52px', height: 'auto', marginBottom: '4px', display: 'block' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '8px' }}>v2.5.12</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 pb-2 overflow-y-auto overflow-x-hidden" style={{ gap: '2px', display: 'flex', flexDirection: 'column' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={async () => {
                if (isBlocked) return;
                const allowedPagesTestMode = ['home', 'premium', 'update-launcher', 'indique'];
                if (isTestMode && !allowedPagesTestMode.includes(item.id)) return;

                if (item.id === 'add-game') {
                  setShowAddGameModal(true);
                  return;
                }

                if (item.id === 'premium-accounts') {
                  setCurrentPage(item.id);
                  return;
                }

                setCurrentPage(item.id);
                if (item.id === 'updates') {
                  markUpdatesAsRead();
                  setHasNewUpdates(false);
                }
              }}
              disabled={isBlocked}
              className={`nav-item ${currentPage === item.id ? 'active' : ''} ${isBlocked ? 'opacity-40 cursor-not-allowed' : ''} ${isTestMode && !['home', 'premium', 'update-launcher', 'indique'].includes(item.id) ? 'opacity-30' : ''} ${item.flame ? 'nav-item-flame' : ''}`}
            >
              <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', position: 'relative' }}>
                {item.icon}
                {item.flame && (
                  <span className="flame-emitter" aria-hidden="true">
                    <span className="flame f1" />
                    <span className="flame f2" />
                    <span className="flame f3" />
                  </span>
                )}
              </span>
              <span className="truncate" style={{ fontSize: '12px', flex: 1 }}>{item.label}</span>
              {item.isPremium && <IconCrown />}
              {item.badge && (
                <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }}></span>
              )}
            </button>
          ))}
        </nav>

        {/* Sidebar footer: user info + Discord + logout — all centered */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Usuário</span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff', textAlign: 'center', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {licenseInfo?.nome ? licenseInfo.nome.split(' ')[0] : licenseKey.substring(0, 12) + '...'}
          </span>
          {licenseInfo && (
            <>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '6px' }}>Tipo</span>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
                {licenseInfo.license_type === 2 ? 'Vitalícia' : licenseInfo.license_type === 3 ? 'Teste' : 'Mensal'}
              </span>
            </>
          )}

          {/* Discord */}
          {socialLinks['discord'] && (
            <button
              onClick={() => window.electron.openExternalUrl(socialLinks['discord'])}
              style={{ marginTop: '10px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 0', background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.22)', borderRadius: '7px', color: '#7289da', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Syne, sans-serif', transition: 'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(88,101,242,0.16)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(88,101,242,0.08)')}
            >
              <IconDiscord size={13} />
              Discord
            </button>
          )}

          {/* WhatsApp */}
          {socialLinks['whatsapp'] && (
            <button
              onClick={() => window.electron.openExternalUrl(socialLinks['whatsapp'])}
              style={{ marginTop: '6px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 0', background: 'rgba(37,211,102,0.07)', border: '1px solid rgba(37,211,102,0.20)', borderRadius: '7px', color: '#25d366', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Syne, sans-serif', transition: 'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,211,102,0.14)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(37,211,102,0.07)')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              WhatsApp
            </button>
          )}

          {/* Logout */}
          <button
            onClick={async () => {
              setIsLoggingOut(true);
              try { await window.electron.disableHidDll(); } catch {}
              setTimeout(() => { setIsLoggingOut(false); onLogout(); }, 500);
            }}
            disabled={isLoggingOut}
            style={{ marginTop: '6px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 0', background: 'rgba(192,48,58,0.08)', border: '1px solid rgba(192,48,58,0.22)', borderRadius: '7px', color: '#e05a65', fontSize: '11px', fontWeight: 600, cursor: isLoggingOut ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif', transition: 'background .15s', opacity: isLoggingOut ? 0.6 : 1 }}
            onMouseEnter={e => { if (!isLoggingOut) (e.currentTarget.style.background = 'rgba(192,48,58,0.16)'); }}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(192,48,58,0.08)')}
          >
            {isLoggingOut ? <><Loader2 className="h-3 w-3 animate-spin" /> Saindo...</> : <><IconLogout size={12} /> Sair</>}
          </button>
        </div>
      </motion.div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ position: 'relative', zIndex: 10 }}>
        {/* Page header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'transparent' }}>
          <div className="flex items-center gap-3">
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {currentPage === 'home' && 'Biblioteca de Jogos'}
              {currentPage === 'premium' && 'Pacote Premium'}
              {currentPage === 'update-launcher' && 'Atualizar Steam'}
              {currentPage === 'add-game' && 'Adicionar Jogo'}
              {currentPage === 'bypass' && 'Bypass'}
              {currentPage === 'premium-accounts' && 'Contas Oficiais'}
              {currentPage === 'multiplayer' && 'Multiplayer'}
              {currentPage === 'nsfw-games' && 'Conteúdo +18'}
              {currentPage === 'updates' && 'Atualizações'}
              {currentPage === 'store' && 'Loja'}
              {currentPage === 'indique' && 'Indique e Ganhe'}
              {currentPage === 'request-game' && 'Solicitar Jogo'}
              {currentPage === 'denuvo' && 'Remover Denuvo'}
              {currentPage === 'settings' && 'Configurações'}
              {currentPage === 'tutoriais' && 'Tutoriais'}
            </h2>
            {isTestMode && (
              <span className="badge badge-premium">Modo Teste</span>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            {currentPage === 'home' && 'Gerencie e acesse sua biblioteca Steam'}
            {currentPage === 'premium' && 'Recursos exclusivos para assinantes'}
            {currentPage === 'update-launcher' && 'Mantenha sua steam sempre atualizado'}
            {currentPage === 'add-game' && 'Adicione novos jogos à sua biblioteca'}
            {currentPage === 'bypass' && 'Ferramentas de bypass e desbloqueio'}
            {currentPage === 'premium-accounts' && 'Contas premium de jogos oficiais'}
            {currentPage === 'multiplayer' && 'Recursos para jogar online com amigos'}
            {currentPage === 'nsfw-games' && 'Jogos adultos — apenas para maiores de 18 anos'}
            {currentPage === 'updates' && 'Últimas atualizações do launcher'}
            {currentPage === 'store' && 'Adquira novos produtos e licenças'}
            {currentPage === 'indique' && 'Indique amigos e ganhe no PIX'}
            {currentPage === 'request-game' && 'Solicite adição de um novo jogo'}
            {currentPage === 'denuvo' && 'Adquira licença alternativa para jogos com proteção Denuvo'}
            {currentPage === 'settings' && 'Informações da sua licença e dispositivo'}
            {currentPage === 'tutoriais' && 'Tutoriais em vídeo para você dominar o launcher'}
          </p>
        </div>

        {/* Content area */}
        {/* Banner de atualização do launcher */}
        {appUpdate && (
          <div style={{
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '12px',
            background: appUpdate.ready ? 'rgba(34,197,94,0.10)' : 'rgba(124,92,252,0.10)',
            borderBottom: appUpdate.ready ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(124,92,252,0.25)',
            flexShrink: 0, zIndex: 20,
          }}>
            {appUpdate.ready ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <Loader2 className="animate-spin" style={{ width: '14px', height: '14px', color: '#a78bfa', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {appUpdate.ready ? (
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#4ade80' }}>
                  Atualização {appUpdate.newVersion} pronta — reiniciando em {appUpdate.countdown}s
                </span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>
                    Nova versão {appUpdate.newVersion} — baixando {appUpdate.pct}%
                  </span>
                  <div style={{ flex: 1, height: '3px', background: 'rgba(124,92,252,0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${appUpdate.pct}%`, background: '#a78bfa', transition: 'width 0.3s' }} />
                  </div>
                </div>
              )}
            </div>
            {appUpdate.ready && (
              <button
                onClick={() => window.electron.installAndRestart?.().catch(() => {})}
                style={{ flexShrink: 0, padding: '5px 14px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: '6px', color: '#4ade80', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
              >
                Reiniciar Agora
              </button>
            )}
            {!appUpdate.ready && (
              <button
                onClick={() => setAppUpdate(null)}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '16px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
              >
                ×
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex justify-center custom-scrollbar" style={{ paddingBottom: 44 }}>
          <div className="w-full max-w-[1200px] px-4 sm:px-6 lg:px-8 py-4">
          {currentPage === 'home' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="home-content"
            >
              {/* Compact hero + Steam manager row */}
              <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                {/* Welcome banner */}
                <div className="card" style={{ flex: 1, padding: '16px 18px' }}>
                  <p style={{ fontSize: '9px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>TITANFORGE LAUNCHER</p>
                  <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
                    Bem-vindo{licenseInfo?.nome ? `, ${String(licenseInfo.nome).split(' ')[0]}` : ''}
                  </h2>
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.40)', margin: 0 }}>
                    {myGames.length > 0 ? `${myGames.length} jogo${myGames.length !== 1 ? 's' : ''} instalado${myGames.length !== 1 ? 's' : ''}` : 'Biblioteca com 1000+ jogos Steam'}
                  </p>
                </div>

                {/* Compact Steam manager */}
                <div className="card" style={{ width: '260px', flexShrink: 0, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>Gerenciador Steam</p>
                    {steamPath && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)' }} />
                        <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 600 }}>Detectada</span>
                      </div>
                    )}
                  </div>
                  {homeMessage && (
                    <div className={homeMessage.type === 'success' ? 'alert-warning' : 'alert-danger'} style={{ padding: '5px 8px', fontSize: '11px', marginBottom: '7px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{homeMessage.type === 'success' ? '✓' : '✗'}</span>
                      <span>{homeMessage.text}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={async () => {
                        if (isBlocked || !steamPath) return;
                        setIsOpeningSteam(true); setHomeMessage(null);
                        try {
                          await window.electron.openSteam(steamPath);
                          setTimeout(() => { setIsOpeningSteam(false); setHomeMessage({ type: 'success', text: 'Steam iniciada!' }); }, 2000);
                        } catch (error: any) {
                          setHomeMessage({ type: 'error', text: error.message || 'Erro ao abrir Steam' });
                          setIsOpeningSteam(false);
                        }
                      }}
                      disabled={!steamPath || isBlocked || isOpeningSteam}
                      className="btn-ghost"
                      style={{ flex: 1, justifyContent: 'center', padding: '6px', fontSize: '11px' }}
                    >
                      {isOpeningSteam ? <><Loader2 className="h-3 w-3 animate-spin" /> Abrindo...</> : <>▶ Abrir</>}
                    </button>
                    <button
                      onClick={async () => {
                        if (isBlocked || !steamPath) return;
                        setIsOpeningSteam(true); setHomeMessage(null);
                        try {
                          await window.electron.closeSteam();
                          await new Promise(r => setTimeout(r, 2000));
                          await window.electron.openSteam(steamPath);
                          setTimeout(() => { setIsOpeningSteam(false); setHomeMessage({ type: 'success', text: 'Steam reiniciada!' }); }, 2000);
                        } catch (error: any) {
                          setHomeMessage({ type: 'error', text: error.message || 'Erro ao reiniciar Steam' });
                          setIsOpeningSteam(false);
                        }
                      }}
                      disabled={!steamPath || isBlocked || isOpeningSteam}
                      className="btn-ghost"
                      style={{ flex: 1, justifyContent: 'center', padding: '6px', fontSize: '11px' }}
                    >
                      {isOpeningSteam ? <><Loader2 className="h-3 w-3 animate-spin" /> Aguarde...</> : <><IconRefresh size={11} /> Reiniciar</>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Alerta Modo Teste */}
              {isTestMode && (
                <div className="alert-warning flex items-center gap-3" style={{ flexShrink: 0 }}>
                  <IconAlert size={14} />
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: '2px' }}>Modo Teste Ativo</p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Acesse Premium para desbloquear todos os recursos</p>
                  </div>
                </div>
              )}

              {/* Meus Jogos */}
              <section className="my-games-section">
                {/* Header */}
                <div className="my-games-header">
                  <div className="my-games-title">
                    <IconGame size={13} />
                    Meus Jogos
                    <span className="my-games-count">
                      {myGamesLoading ? '...' : `${filteredMyGames.length} jogos`}
                    </span>
                  </div>
                  <button
                    onClick={() => loadMyGames(false)}
                    className="btn-ghost"
                    style={{ fontSize: '11px', padding: '5px 10px' }}
                    disabled={myGamesLoading}
                  >
                    {myGamesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <><IconRefresh size={11} /> Atualizar</>}
                  </button>
                </div>

                {/* Search */}
                {!myGamesLoading && myGames.length > 0 && (
                  <div className="my-games-search">
                    <span className="search-icon" style={{ display: 'flex', alignItems: 'center' }}><IconSearch size={12} /></span>
                    <input
                      type="text"
                      value={myGamesSearch}
                      onChange={e => setMyGamesSearch(e.target.value)}
                      placeholder="Buscar nos meus jogos..."
                    />
                  </div>
                )}

                {/* Content */}
                {myGamesLoading ? (
                  <div className="my-games-grid">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className="my-game-skeleton">
                        <div className="skel-thumb loading" style={{
                          background: 'linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%)',
                          backgroundSize: '200% 100%',
                          animation: 'shimmer 1.4s infinite',
                          width: '100%',
                          aspectRatio: '460 / 215',
                        }} />
                        <div className="skel-body">
                          <div className="skel-line" />
                          <div className="skel-line skel-line-short" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : myGames.length === 0 ? (
                  <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '10px', opacity: 0.3, display: 'flex', justifyContent: 'center' }}><IconGamepad size={30} /></div>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhum jogo instalado</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Adicione jogos pela aba <strong>Adicionar Jogos</strong></p>
                  </div>
                ) : filteredMyGames.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                    Nenhum jogo encontrado para "<strong style={{ color: 'var(--text-secondary)' }}>{myGamesSearch}</strong>"
                  </div>
                ) : (
                  <div ref={myGamesGridWrapperRef} className="my-games-grid-wrapper" style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, maxHeight: '70vh' }}>
                    <div className="my-games-grid">
                      {displayedMyGames.map(game => {
                        const hasFailed = failedThumbs.has(game.appid);
                        const thumbSrc = hasFailed ? null : (game.thumb || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`);
                        return (
                        <div key={game.appid} className="my-game-card">
                          <div className="thumb-wrap">
                            {thumbSrc ? (
                              <img
                                src={thumbSrc}
                                alt={game.name || game.appid}
                                loading="lazy"
                                onError={() => {
                                  failedThumbs.add(game.appid);
                                  // Force re-render by updating state slightly
                                  setMyGames(prev => [...prev]);
                                }}
                              />
                            ) : (
                              <div style={{ width: '100%', height: '100%', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                                <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{game.appid}</span>
                              </div>
                            )}
                          </div>
                          <div className="game-info">
                            <div className="game-name" title={game.name || game.appid}>{game.name || `App ${game.appid}`}</div>
                            <div className="game-appid">ID: {game.appid}</div>
                          </div>
                          <div className="game-actions">
                            <button
                              className="btn-update"
                              onClick={() => setConfirmModal({ type: 'update', appid: game.appid, name: game.name || `App ${game.appid}` })}
                            >
                              <IconArrowUp /> Atualizar
                            </button>
                            <button
                              className="btn-dlc"
                              title="Ver DLCs disponíveis"
                              onClick={async () => {
                                // Sempre usa o import estático (já resolvido pelo bundler)
                                // e força re-fetch se o cache ainda não foi populado
                                let all: import('../services/ryuuGames').RyuuGame[];
                                try {
                                  all = await getRyuuGames();
                                } catch {
                                  all = [];
                                }
                                const appidStr = String(game.appid);
                                const ryuuGame = all.find(g => String(g.appid) === appidStr) || null;
                                const dlcs = ryuuGame?.dlc ?? [];
                                console.log(`🧩 DLC Modal — jogo: ${appidStr} (${game.name})`);
                                console.log(`🧩 ryuuGame encontrado:`, !!ryuuGame);
                                console.log(`🧩 DLCs (${dlcs.length}):`, dlcs.map(d => `${d.appid} — ${d.name}`));
                                setDlcModal({ gameAppid: appidStr, gameName: game.name || `App ${appidStr}`, dlcs });
                              }}
                            >
                              {/* Puzzle icon */}
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                <line x1="7" y1="7" x2="7.01" y2="7"/>
                              </svg>
                            </button>
                            <button
                              className="btn-delete"
                              onClick={() => setConfirmModal({ type: 'remove', appid: game.appid, name: game.name || `App ${game.appid}` })}
                              title="Remover jogo"
                            >
                              <IconTrashSm />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    {/* IntersectionObserver sentinel — only rendered when more items exist */}
                    {myGamesDisplayLimit < filteredMyGames.length && (
                      <div ref={myGamesSentinelRef} style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                        {[0,1,2].map(i => (
                          <div key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1s ${i * 0.2}s ease-in-out infinite alternate` }} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

            </motion.div>
          )}

          {currentPage === 'premium' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={isTestMode ? "h-full flex items-center justify-center" : "w-full"}
            >
              {isTestMode ? (
                /* VISUALIZAÇÃO MODO TESTE */
                <div className="w-full max-w-[700px] space-y-3">
                  {/* Banner de Modo Teste */}
                  <div className="card-minimal p-3" style={{ borderLeft: '4px solid var(--neon)' }}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <h4 className="text-white font-semibold text-sm mb-1">
                          Modo Teste - Acesso Limitado
                        </h4>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                          Você está usando uma licença de teste. Baixe o pacote de teste para experimentar o launcher.
                        </p>
                        <p style={{ color: 'var(--neon-bright)', fontWeight: 600, fontSize: '12px' }}>
                          Para desbloquear todos os recursos, adquira uma licença completa.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Seção de Download do Pacote Teste */}
                  <div className="card" style={{ padding: '20px 22px' }}>
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Baixar Pacote de Teste</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Experimente o TitanForge Launcher gratuitamente</p>
                    </div>

                    {/* Mensagens */}
                    {premiumMessage && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={premiumMessage.type === 'success' ? 'alert-warning' : 'alert-danger'}
                        style={{ marginBottom: '12px', fontSize: '12px' }}
                      >
                        {premiumMessage.text}
                      </motion.div>
                    )}

                    {/* Botão de Download */}
                    <button
                      onClick={handleDownloadTestPackage}
                      disabled={isUpdating}
                      className="btn-primary"
                      style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '13px' }}
                    >
                      {isUpdating ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /><span>{updateStatus || 'Baixando...'}</span></>
                      ) : (
                        'Baixar Pacote de Teste'
                      )}
                    </button>

                    {/* Barra de Progresso */}
                    {isUpdating && updateProgress > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ height: '4px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ background: 'var(--accent)', height: '100%', transition: 'width 0.3s', width: `${updateProgress}%` }} />
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>{updateProgress}%</p>
                      </div>
                    )}

                    {/* CTA de Upgrade */}
                    <div className="card" style={{ marginTop: '14px', padding: '12px 14px', textAlign: 'center', borderColor: 'rgba(124,92,252,0.2)' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                        Pronto para desbloquear todos os recursos?
                      </p>
                      <button
                        onClick={async () => {
                          const link = await getCheckoutLink('licenca_login');
                          if (link) await window.electron.openExternalUrl(link);
                        }}
                        className="btn-primary"
                        style={{ width: '100%', justifyContent: 'center', padding: '9px' }}
                      >
                        Adquirir Licença Completa
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* VISUALIZAÇÃO NORMAL — catálogo completo ryuu.lol */
                <PremiumGamesPage
                  gamesDatabase={gamesDatabase}
                  isLoading={isLoadingGamesJson}
                  myGames={myGames}
                  adultAppIds={new Set(nsfwDatabase.map(g => g.appid))}
                  onInstall={async (appid, name) => {
                    setHomeMessage(null);
                    try {
                      const ensureResult = await window.electron.ensureHidDll();
                      if (!ensureResult.success) return;
                      await window.electron.downloadManifestorLua(appid, name, false);
                      const updated = await window.electron.getMyGames();
                      if (updated.success) setMyGames(updated.games.map((g: any) => ({ appid: String(g.appid), name: g.name, thumb: null })));
                    } catch (err) { console.error('Erro ao instalar jogo premium:', err); }
                  }}
                  onRemove={async (appid) => {
                    try {
                      await window.electron.removeGame(appid);
                      const updated = await window.electron.getMyGames();
                      if (updated.success) setMyGames(updated.games.map((g: any) => ({ appid: String(g.appid), name: g.name, thumb: null })));
                    } catch (err) { console.error('Erro ao remover jogo:', err); }
                  }}
                  onRefreshMyGames={async () => {
                    const updated = await window.electron.getMyGames();
                    if (updated.success) setMyGames(updated.games.map((g: any) => ({ appid: String(g.appid), name: g.name, thumb: null })));
                  }}
                  onInstallBasePack={handleUpdateSteam}
                  isInstallingBasePack={isUpdating}
                  basePackMessage={premiumMessage}
                  steamPath={steamPath}
                  isBlocked={isBlocked}
                />
              )}
            </motion.div>
          )}

          {currentPage === 'update-launcher' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="h-full flex items-center justify-center">
              <div className="w-full max-w-[480px]">
                <div className="card" style={{ padding: '28px 24px' }}>
                  <div className="flex justify-center mb-4">
                    <div style={{ position: 'relative', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', inset: 0, borderRadius: '14px', background: 'linear-gradient(135deg, rgba(59,130,246,0.20) 0%, rgba(99,102,241,0.12) 100%)', border: '1px solid rgba(59,130,246,0.28)', boxShadow: '0 0 24px rgba(59,130,246,0.14) inset' }} />
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#gUpd)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', zIndex: 1 }}>
                        <defs><linearGradient id="gUpd" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#818cf8"/></linearGradient></defs>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/>
                      </svg>
                    </div>
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center', marginBottom: '6px' }}>Atualizar Steam</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '20px' }}>
                    Mantenha seu launcher sempre atualizado
                  </p>
                  <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {['Correções de bugs e melhorias de estabilidade', 'Novos recursos e funcionalidades exclusivas', 'Melhor performance e otimizações'].map(b => (
                      <div key={b} className="flex items-center gap-2" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--accent)', fontSize: '13px' }}>✓</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                  {updateLauncherMessage && (
                    <div className={`mb-3 ${updateLauncherMessage.type === 'success' ? 'alert-warning' : 'alert-danger'}`} style={{ fontSize: '12px', padding: '8px 12px' }}>
                      {updateLauncherMessage.text}
                    </div>
                  )}
                  <div className="flex justify-center">
                    <button onClick={handleUpdateLauncher} disabled={isUpdatingLauncher} className="btn-primary" style={{ padding: '10px 24px' }}>
                      {isUpdatingLauncher ? <><Loader2 className="h-4 w-4 animate-spin" />Atualizando...</> : <>⚡ Atualizar Agora</>}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Página Adicionar Jogo */}
          {currentPage === 'add-game' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{ width: '100%', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {/* Verificar permissão add_games */}
              {licenseInfo?.add_games === 'disable' ? (
                <div className="card" style={{ padding: '40px 24px', textAlign: 'center', maxWidth: '360px', margin: '0 auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px', opacity: 0.5 }}><IconLock size={32} /></div>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>Acesso Restrito</h3>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.40)', marginBottom: '18px', lineHeight: 1.5 }}>Adicionar jogos manualmente requer um plano com este recurso desbloqueado.</p>
                  <button
                    onClick={() => { setShowAddGameModal(false); openPremiumModal('Adicionar Jogos — Premium', 'Para adicionar jogos individualmente à sua biblioteca, você precisa do plano com este recurso desbloqueado.', 'adicionar_jogo'); }}
                    style={{ background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', border: 'none', borderRadius: '9px', padding: '10px 20px', fontSize: '12px', fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
                  >
                    Adquirir Acesso →
                  </button>
                </div>
              ) : (
                <>
                  {/* Loading inicial */}
                  {isLoadingGamesJson && (
                    <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                      <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Carregando banco de dados...</span>
                    </div>
                  )}

                  {/* Campo de busca */}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Ex: Counter-Strike, 730, ou link da Steam..."
                      className="input"
                      disabled={isLoadingGamesJson || isBulkDownloading}
                    />
                    {searchQuery && (isLoadingGamesJson || displayedResults.length === 0) && (
                      <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent)' }} />
                      </div>
                    )}
                  </div>

                  {/* Seleção + instalar */}
                  {displayedResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="card"
                      style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                    >
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {selectedGames.size === 0 ? 'Selecione jogos para instalar' : `${selectedGames.size} jogo(s) selecionado(s)`}
                      </span>
                      <button
                        onClick={handleBulkDownload}
                        disabled={selectedGames.size === 0 || isBulkDownloading}
                        className="btn-primary"
                        style={{ padding: '6px 14px', fontSize: '12px' }}
                      >
                        {isBulkDownloading ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Instalando {bulkDownloadProgress.current}/{bulkDownloadProgress.total}</>
                        ) : (
                          <>📥 Instalar ({selectedGames.size})</>
                        )}
                      </button>
                    </motion.div>
                  )}

                  {/* Progresso */}
                  {isBulkDownloading && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="card"
                      style={{ padding: '12px 14px', borderLeft: '3px solid var(--accent)' }}
                    >
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{bulkDownloadProgress.currentGame}</p>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Jogo {bulkDownloadProgress.current} de {bulkDownloadProgress.total}</p>
                      <div style={{ marginTop: '8px', width: '100%', background: 'var(--bg-input)', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                        <div style={{ background: 'var(--accent)', height: '100%', transition: 'width 0.3s', width: `${(bulkDownloadProgress.current / bulkDownloadProgress.total) * 100}%` }} />
                      </div>
                    </motion.div>
                  )}

                  {/* Grid de resultados */}
                  {displayedResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="content-area-add-game"
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px', maxHeight: '600px', overflowY: 'auto' }}
                    >
                      {displayedResults.map((game) => {
                        const isSelected = selectedGames.has(game.appid);
                        const thumbnail = gamesThumbnails[game.appid];
                        return (
                          <motion.div
                            key={game.appid}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            onClick={() => !isBulkDownloading && toggleGameSelection(game.appid)}
                            className="game-card"
                            style={{
                              opacity: isBulkDownloading ? 0.5 : 1,
                              cursor: isBulkDownloading ? 'not-allowed' : 'pointer',
                              borderColor: isSelected ? 'rgba(124,92,252,0.5)' : undefined,
                              background: isSelected ? 'var(--accent-dim)' : undefined,
                            }}
                          >
                            <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden' }}>
                              <img
                                src={thumbnail || 'https://ryuu.lol/manifests/placeholder.png'}
                                alt={game.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { const img = e.currentTarget as HTMLImageElement; img.onerror = null; img.src = 'https://ryuu.lol/manifests/placeholder.png'; }}
                              />
                              {isSelected && (
                                <div style={{ position: 'absolute', top: '6px', right: '6px', width: '20px', height: '20px', background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff' }}>
                                  ✓
                                </div>
                              )}
                              {(game as any).drm === true && (
                                <div style={{ position: 'absolute', top: '4px', left: '4px', background: 'rgba(255,45,120,0.88)', borderRadius: '3px', padding: '1px 5px', fontSize: '8px', fontWeight: 700, color: '#fff', backdropFilter: 'blur(4px)', letterSpacing: '0.04em', zIndex: 2 }}>
                                  DRM
                                </div>
                              )}
                            </div>
                            <div style={{ padding: '8px 10px' }}>
                              <h4 style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={game.name}>{game.name}</h4>
                              <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>App ID: {game.appid}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}

                  {/* Loading mais */}
                  {displayedResults.length < searchResults.length && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', gap: '8px' }}>
                      <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Carregando mais jogos...</span>
                    </div>
                  )}

                  {/* Busca vazia */}
                  {searchQuery && searchResults.length === 0 && !isLoadingGamesJson && (
                    <div style={{ textAlign: 'center', padding: '32px 0' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nenhum jogo encontrado para "{searchQuery}"</p>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Tente usar outro termo de busca ou ID</p>
                    </div>
                  )}

                  {/* Game Preview Card */}
                  {gamePreview && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="card"
                      style={{ padding: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}
                    >
                      <div style={{ width: '128px', height: '60px', flexShrink: 0, background: 'var(--bg-input)', borderRadius: '6px', overflow: 'hidden' }}>
                        <img src={gamePreview.thumbnail} alt={gamePreview.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px' }}>{gamePreview.name}</h4>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>App ID: {gamePreview.appId}</p>
                      </div>
                      <button onClick={handleAddGame} disabled={isDownloadingGame} className="btn-primary" style={{ padding: '7px 14px', fontSize: '12px' }}>
                        {isDownloadingGame ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>➕ Adicionar</>}
                      </button>
                    </motion.div>
                  )}

                  {/* Message */}
                  {addGameMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={addGameMessage.type === 'success' ? 'alert-warning' : 'alert-danger'}
                      style={{ fontSize: '12px' }}
                    >
                      {addGameMessage.text}
                    </motion.div>
                  )}

                  {/* Como funciona */}
                  <div className="card" style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Como funciona</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {[
                        'Digite nome, ID ou link da Steam',
                        'Selecione múltiplos jogos clicando nos cards',
                        'Clique em "Instalar Jogos" para baixar todos',
                      ].map((step, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>{i + 1}.</span>
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* Página Remover Jogo */}
          {/* Bypass Page */}
          {currentPage === 'bypass' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="h-full flex flex-col"
            >
              {/* Antivírus warning */}
              <div className="alert-danger mb-3" style={{ padding: '10px 14px' }}>
                <p style={{ fontWeight: 600, color: 'var(--red)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}><IconAlert size={13} /> Aviso Importante — Antivírus</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Os arquivos podem conter <strong>.dll</strong> e <strong>.exe</strong> detectados como ameaça pelo Windows Defender.
                  É um <strong>falso positivo</strong>. <strong>Desative temporariamente o antivírus</strong> durante a instalação.
                </p>
              </div>

              {/* Banner de upgrade para usuários sem acesso premium */}
              {licenseInfo?.bypass !== 'enable' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', background: 'var(--neon-dim)', border: '1px solid var(--neon-border)' }}>
                  <IconCrown size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1px' }}>Você está no modo visualização</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Jogos <strong style={{ color: 'var(--neon-bright)' }}>Premium</strong> são bloqueados. Adquira acesso para baixar todos os bypasses.</p>
                  </div>
                  <button
                    onClick={() => openPremiumModal('Bypass Premium', 'Acesse todos os bypasses e ferramentas de desbloqueio com o plano premium.', 'bypass_premium')}
                    className="btn-primary"
                    style={{ flexShrink: 0, padding: '6px 14px', fontSize: '11px', background: 'var(--neon)' }}
                  >
                    Desbloquear
                  </button>
                </div>
              )}

              {/* Stats + Search + Filters */}
              <div className="mb-3">
                <div className="flex gap-2 mb-3 flex-wrap items-center">
                  <span className="filter-pill" style={{ cursor: 'default' }}><strong>{bypassStats.totalBypasses}</strong> Total</span>
                  <span className="filter-pill" style={{ cursor: 'default', color: 'var(--neon)' }}><strong>{bypassStats.premiumCount}</strong> Premium</span>
                  <span className="filter-pill" style={{ cursor: 'default', color: '#4ade80' }}><strong>{bypassStats.freeCount}</strong> Free</span>
                  <span className="filter-pill" style={{ cursor: 'default' }}><strong>{bypassStats.installedCount}</strong> Instalados</span>
                </div>

                <div className="flex gap-2 items-center">
                  <input type="text" value={bypassFilter} onChange={(e) => setBypassFilter(e.target.value)}
                    placeholder="Buscar bypasses..." className="input" style={{ flex: 1 }} />
                  <button onClick={() => setFilterPremium(!filterPremium)}
                    className={`filter-pill ${filterPremium ? 'active' : ''}`}>
                    <IconCrown size={10} /> Premium
                  </button>
                  <button onClick={() => setFilterFree(!filterFree)}
                    className={`filter-pill ${filterFree ? 'active' : ''}`}>
                    Free
                  </button>
                  <button onClick={() => setShowBypassTutorial(true)} className="btn-ghost" style={{ padding: '6px 12px' }}>
                    Tutorial
                  </button>
                  <div className="relative">
                    <button onClick={() => setSortMenuOpen(!sortMenuOpen)} className="btn-ghost" style={{ padding: '6px 12px' }}>
                      ↕ Ordenar
                    </button>
                    {sortMenuOpen && (
                      <div className="card absolute top-full right-0 mt-1 min-w-[120px]" style={{ padding: '6px', zIndex: 50 }}>
                        {(['asc', 'desc'] as const).map(o => (
                          <button key={o} onClick={() => { setSortOrder(o); setSortMenuOpen(false); }}
                            className="w-full text-left px-3 py-1.5 rounded" style={{ fontSize: '12px', color: 'var(--text-secondary)', transition: 'background .15s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                            {o === 'asc' ? 'A → Z' : 'Z → A'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {sortedBypass.length === 0 ? (
                  <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', opacity: 0.3 }}><IconShield size={28} /></div>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhum bypass disponível</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Não há bypasses no momento.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
                    {sortedBypass.map((bypass) => {
                      const isPremium = bypass.status === 'premium';
                      const hasAccess = licenseInfo?.bypass === 'enable';
                      const shouldBlur = isPremium && !hasAccess;

                      return (
                        <motion.div
                          key={bypass.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="game-card group"
                          style={isPremium ? { borderColor: 'var(--neon-border)' } : {}}
                        >
                          {/* Badge tipo */}
                          {isPremium ? (
                            <div className="badge badge-premium" style={{ position: 'absolute', top: '6px', left: '6px', zIndex: 2 }}>
                              PREMIUM
                            </div>
                          ) : (
                            <div className="badge badge-free" style={{ position: 'absolute', top: '6px', left: '6px', zIndex: 2 }}>
                              FREE
                            </div>
                          )}

                          {/* Badge Instalado */}
                          {installedBypasses.includes(bypass.id) && (
                            <div className="badge badge-tested" style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <IconCheck size={9} />
                            </div>
                          )}

                          {/* Thumbnail 16:9 */}
                          <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden' }}>
                            {bypass.isLoadingThumbnail ? (
                              <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                            ) : bypass.thumbnail ? (
                              <img
                                src={bypass.thumbnail}
                                alt={bypass.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', filter: shouldBlur ? 'blur(6px)' : 'none', transition: 'transform 0.2s ease' }}
                                className="group-hover:scale-[1.04]"
                                loading="lazy"
                              />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: shouldBlur ? 'blur(6px)' : 'none' }}>
                                <span style={{ fontSize: '28px', opacity: 0.25 }}>🎮</span>
                              </div>
                            )}

                            {/* Overlay de bloqueio */}
                            {shouldBlur && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPremiumModal('Bypass Premium', 'Adquira acesso Premium para baixar bypasses exclusivos.', 'bypass_premium');
                                }}
                                style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, cursor: 'pointer' }}
                              >
                                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--neon)', background: 'var(--neon-dim)', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--neon-border)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <IconLock size={10} /> Premium
                                </span>
                              </div>
                            )}

                            {/* Botão instalar no hover (apenas sem blur) */}
                            {!shouldBlur && (
                              <div className="group-hover:opacity-100" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'all 0.2s' }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.6)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBypassInstallTarget({
                                      id: bypass.id,
                                      name: bypass.name,
                                      link: bypass.link,
                                      thumbnail: bypass.thumbnail,
                                    });
                                  }}
                                  className="btn-primary"
                                  style={{ padding: '6px 14px', fontSize: '11px' }}
                                >
                                  Instalar
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div style={{ padding: '8px 10px' }}>
                            <h4 style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {bypass.name}
                            </h4>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Modal de instalação de bypass com extração */}
          {bypassInstallTarget && (
            <BypassInstallModal
              bypassName={bypassInstallTarget.name}
              bypassUrl={bypassInstallTarget.link}
              thumbnail={bypassInstallTarget.thumbnail}
              titleLabel="Instalar bypass"
              instructionTitle="Selecione a pasta de instalação do jogo"
              instructionBody="Os arquivos do bypass serão extraídos diretamente nessa pasta. Em quase todos os casos é a pasta raiz do jogo na sua biblioteca da Steam."
              onClose={() => setBypassInstallTarget(null)}
              onInstalled={() => {
                const installed = [...installedBypasses, bypassInstallTarget.id];
                setInstalledBypasses(installed);
                localStorage.setItem('installed_bypasses', JSON.stringify(installed));
              }}
            />
          )}

          {/* Modal de instalação de fix multiplayer — mesmo extrator */}
          {multiplayerInstallTarget && (
            <BypassInstallModal
              bypassName={multiplayerInstallTarget.name}
              bypassUrl={multiplayerInstallTarget.link}
              thumbnail={multiplayerInstallTarget.thumbnail}
              titleLabel="Instalar fix multiplayer"
              instructionTitle="Selecione a pasta onde o jogo está instalado"
              instructionBody="O fix multiplayer será extraído diretamente na pasta do jogo. Use a pasta raiz do jogo (a mesma onde fica o .exe principal)."
              onClose={() => setMultiplayerInstallTarget(null)}
              onInstalled={() => {}}
            />
          )}

          {/* Premium Accounts Page */}
          {currentPage === 'premium-accounts' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="h-full flex flex-col"
            >
              {licenseInfo?.premiumaccounts === 'enable' ? (
                <>
                  {/* Aviso contas compartilhadas */}
                  <div className="alert-warning mb-3">
                    <p style={{ fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}><IconAlert size={13} /> Contas Compartilhadas — Leia com atenção</p>
                    <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <li>As contas são <strong>compartilhadas entre múltiplos usuários</strong> e podem apresentar problemas eventuais de acesso.</li>
                      <li>Se não conseguir fazer login, <strong>entre em contato com o suporte</strong> para obter uma nova conta.</li>
                      <li style={{ color: 'var(--red)', fontWeight: 600 }}><strong style={{ color: 'var(--red)' }}>NÃO COMPARTILHE</strong> essas contas. O compartilhamento resulta em <strong>suspensão permanente</strong> sem reembolso.</li>
                    </ul>
                  </div>

                  {/* Barra de ações — exportar CSV */}
                  {premiumAccounts.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                      <button
                        onClick={() => {
                          const header = 'Nome,Login,Senha,Jogos';
                          const rows = premiumAccounts.map(a => {
                            const escape = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
                            return [escape(a.nome), escape(a.login), escape(a.senha), escape(a.content || '')].join(',');
                          });
                          const csv = [header, ...rows].join('\r\n');
                          const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `contas-oficiais-${new Date().toISOString().slice(0,10)}.csv`;
                          link.click();
                          URL.revokeObjectURL(url);
                        }}
                        style={{
                          padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px',
                          background: 'rgba(124,92,252,0.10)', border: '1px solid rgba(124,92,252,0.30)',
                          borderRadius: '7px', color: 'var(--neon-bright)', fontSize: '11px', fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Exportar CSV ({premiumAccounts.length} contas)
                      </button>
                    </div>
                  )}

                  {/* Lista de Contas */}
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {premiumAccounts.length === 0 ? (
                      <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', opacity: 0.3 }}><IconUser size={24} /></div>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhuma conta disponível</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Não há contas oficiais premium no momento.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                        {premiumAccounts.map((account) => {
                          const isExpanded = expandedAccounts.has(account.id);

                          return (
                            <motion.div
                              key={account.id}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="card"
                              style={{ padding: '14px 16px', borderColor: 'rgba(124,92,252,0.2)' }}
                            >
                              {/* Header com nome e dropdown toggle */}
                              <div
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', cursor: 'pointer' }}
                                onClick={() => {
                                  const newExpanded = new Set(expandedAccounts);
                                  if (newExpanded.has(account.id)) {
                                    newExpanded.delete(account.id);
                                  } else {
                                    newExpanded.add(account.id);
                                  }
                                  setExpandedAccounts(newExpanded);
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <IconUser size={13} />
                                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{account.nome}</h4>
                                </div>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>▼</span>
                              </div>

                              {/* Dropdown de Jogos */}
                              {isExpanded && account.content && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  style={{ marginBottom: '10px', background: 'var(--bg-input)', borderRadius: '6px', padding: '10px 12px', border: '1px solid var(--border)' }}
                                >
                                  <h5 style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}><IconGamepad size={11} /> Jogos Disponíveis</h5>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                                    {account.content}
                                  </div>
                                </motion.div>
                              )}

                              {/* Login */}
                              <div className="mb-2">
                                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '5px' }}>Login:</label>
                                <div className="flex gap-1.5">
                                  <input type="text" value={account.login} readOnly className="input" style={{ flex: 1, padding: '6px 10px' }} />
                                  <button onClick={() => { navigator.clipboard.writeText(account.login); setCopyToast('Login copiado!'); setTimeout(() => setCopyToast(null), 3000); }}
                                    className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconCopy size={12} /></button>
                                </div>
                              </div>

                              {/* Senha */}
                              <div>
                                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '5px' }}>Senha:</label>
                                <div className="flex gap-1.5">
                                  <input type={visiblePasswords.has(account.id) ? 'text' : 'password'} value={account.senha} readOnly
                                    className="input" style={{ flex: 1, padding: '6px 10px' }} />
                                  <button onClick={() => { const n = new Set(visiblePasswords); n.has(account.id) ? n.delete(account.id) : n.add(account.id); setVisiblePasswords(n); }}
                                    className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {visiblePasswords.has(account.id) ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                                  </button>
                                  <button onClick={() => { navigator.clipboard.writeText(account.senha); setCopyToast('Senha copiada!'); setTimeout(() => setCopyToast(null), 3000); }}
                                    className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconCopy size={12} /></button>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // Preview Mode - Blocked
                <>
                  {/* Banner de bloqueio premium */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '12px 16px', marginBottom: '14px',
                    background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(255,45,120,0.07))',
                    border: '1px solid rgba(124,92,252,0.22)', borderRadius: '10px',
                  }}>
                    <div style={{ flexShrink: 0, width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(124,92,252,0.14)', border: '1px solid rgba(124,92,252,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IconCrown size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: '#fff', margin: '0 0 2px' }}>Modo Visualização</p>
                      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>Você está vendo uma prévia. Adquira o acesso para desbloquear logins e senhas das contas oficiais.</p>
                    </div>
                    <button
                      onClick={() => openPremiumModal('Contas Oficiais Premium', 'Adquira acesso Premium para ver logins e senhas das contas oficiais.', 'contas_oficiais')}
                      style={{ flexShrink: 0, padding: '7px 14px', background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap' }}
                    >
                      Adquirir →
                    </button>
                  </div>

                  {premiumAccounts.length === 0 ? (
                    <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.4 }}>📦</div>
                      <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhuma conta disponível</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Não há contas oficiais premium no momento.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                      {premiumAccounts.map((account) => (
                        <div key={account.id} className="card" style={{ padding: '14px 16px', borderColor: 'rgba(124,92,252,0.2)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <IconUser size={14} />
                            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{account.nome}</h4>
                          </div>

                          {account.content && (
                            <div style={{ marginBottom: '10px', background: 'var(--bg-input)', borderRadius: '6px', padding: '8px 10px', border: '1px solid var(--border)' }}>
                              <h5 style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}><IconGamepad size={11} /> Jogos Disponíveis</h5>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-line', overflow: 'hidden', maxHeight: '60px' }}>
                                {account.content}
                              </div>
                            </div>
                          )}

                          {/* Login — visível para todos */}
                          <div style={{ marginBottom: '8px' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Login:</label>
                            <div className="flex gap-1.5">
                              <input type="text" value={account.login} readOnly className="input" style={{ flex: 1, padding: '6px 10px', filter: 'blur(4px)', userSelect: 'none' }} />
                              <button className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, cursor: 'not-allowed' }}>
                                <IconCopy size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Senha — campo com overlay de bloqueio */}
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Senha:</label>
                            <div style={{ position: 'relative' }}>
                              <div className="flex gap-1.5">
                                <input type="password" value="••••••••" readOnly className="input" style={{ flex: 1, padding: '6px 10px' }} />
                                <button className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, cursor: 'not-allowed' }}>
                                  <IconEye size={12} />
                                </button>
                                <button className="btn-ghost" style={{ padding: '6px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, cursor: 'not-allowed' }}>
                                  <IconCopy size={12} />
                                </button>
                              </div>
                              {/* Lock overlay */}
                              <div
                                onClick={() => openPremiumModal('Contas Oficiais Premium', 'Adquira acesso Premium para ver logins e senhas das contas oficiais.', 'contas_oficiais')}
                                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(10,10,16,0.7)', backdropFilter: 'blur(2px)', borderRadius: '6px', cursor: 'pointer' }}
                              >
                                <IconLock size={13} />
                                <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Premium</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Updates Page */}
          {currentPage === 'updates' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="space-y-2">
              {updates.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', opacity: 0.3 }}><IconBell size={24} /></div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Nenhuma atualização</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Não há atualizações disponíveis.</p>
                </div>
              ) : (
                updates.map((update) => (
                  <motion.div key={update.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                    className="card" style={{ padding: '14px 16px' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>{update.nome}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(update.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-line', lineHeight: 1.7 }}>
                      {String(update.content).split('\n').map((line, i) => (
                        <div key={i} className="flex items-start gap-2">
                          {line.trim() && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>}
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}

          {/* Loja */}
          {currentPage === 'store' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {/* Header com Filtros */}
              <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: 'Todos' },
                    { id: 'licenca', label: 'Licenças' },
                    { id: 'produto', label: 'Produtos' },
                    { id: 'servico', label: 'Serviços' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setStoreFilter(f.id as any)}
                      className={`filter-pill${storeFilter === f.id ? ' active' : ''}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={storeSearchQuery}
                  onChange={(e) => setStoreSearchQuery(e.target.value)}
                  placeholder="Buscar produtos..."
                  className="input"
                  style={{ width: '220px' }}
                />
              </div>

              {/* Grid */}
              {filteredStoreItems.length === 0 ? (
                <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', opacity: 0.3 }}><IconShop size={28} /></div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhum produto encontrado</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {storeSearchQuery ? 'Tente outras palavras-chave' : 'Nenhum produto disponível nesta categoria'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                  {filteredStoreItems.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      className="group"
                      style={{
                        display: 'flex', flexDirection: 'column',
                        background: 'var(--bg-card)', borderRadius: '12px',
                        border: `1px solid ${item.destaque ? 'rgba(124,92,252,0.45)' : 'rgba(255,255,255,0.07)'}`,
                        overflow: 'hidden', transition: 'border-color .2s, transform .2s',
                        boxShadow: item.destaque ? '0 0 20px rgba(124,92,252,0.12)' : 'none',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                    >
                      {/* Thumb 600×900 (2:3 ratio) */}
                      <div style={{ width: '100%', aspectRatio: '2/3', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
                        {item.imagem ? (
                          <img
                            src={item.imagem}
                            alt={item.nome}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.35s ease' }}
                            className="group-hover:scale-[1.04]"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"%3E%3Crect fill="%23111114" width="200" height="300"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%2333333a" font-size="64"%3E🛒%3C/text%3E%3C/svg%3E';
                            }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', opacity: 0.2 }}>🛒</div>
                        )}
                        {item.destaque && (
                          <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 2, background: 'linear-gradient(135deg,#7c5cfc,#ff2d78)', borderRadius: '5px', padding: '3px 8px', fontSize: '8px', fontWeight: 800, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            ★ DESTAQUE
                          </div>
                        )}
                        {/* Bottom gradient overlay */}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(to top, rgba(10,8,16,0.85), transparent)', pointerEvents: 'none' }} />
                      </div>

                      {/* Conteúdo */}
                      <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', lineHeight: 1.3 }}>{item.nome}</h3>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, flex: 1, marginBottom: '14px' }}>{item.descricao}</p>
                        {(() => {
                          const CATEGORIA_PERM: Record<string, string> = { licenca: 'bypass', produto: 'add_games', servico: 'multiplayer' };
                          const permField = item.permission_field || CATEGORIA_PERM[item.categoria];
                          const isUnlocked = !!(permField && licenseInfo?.[permField as keyof typeof licenseInfo] === 'enable');
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: 'auto' }}>
                              {isUnlocked ? (
                                <span style={{ fontSize: '12px', fontWeight: 700, color: '#22c55e', fontFamily: 'Syne, sans-serif', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  ✓ Ativado
                                </span>
                              ) : (
                                <span style={{ fontSize: '16px', fontWeight: 800, color: '#fff', fontFamily: 'Syne, sans-serif', letterSpacing: '-0.01em' }}>
                                  R$ {item.preco.toFixed(2).replace('.', ',')}
                                </span>
                              )}
                              {isUnlocked ? (
                                <button
                                  onClick={async () => { await window.electron.openExternalUrl(item.link_compra); }}
                                  style={{ padding: '7px 14px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: '8px', color: '#22c55e', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0, transition: 'opacity .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
                                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                                >
                                  ↓ Baixar
                                </button>
                              ) : (
                                <button
                                  onClick={async () => { await window.electron.openExternalUrl(item.link_compra); }}
                                  style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#7c5cfc,#a855f7)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0, transition: 'opacity .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                                >
                                  Comprar
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Informativo */}
              <div className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '14px' }}>ℹ️</span>
                  <div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      Clique em <strong style={{ color: 'var(--text-primary)' }}>"Comprar"</strong> para abrir a página de pagamento no seu navegador.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Multiplayer Page */}
          {currentPage === 'multiplayer' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="h-full flex flex-col"
            >
              {/* Antivírus warning */}
              <div className="alert-danger mb-3" style={{ padding: '10px 14px' }}>
                <p style={{ fontWeight: 600, color: 'var(--red)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}><IconAlert size={13} /> Aviso Importante — Antivírus</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Os arquivos podem conter <strong>.dll</strong> e <strong>.exe</strong> detectados como ameaça.
                  É um <strong>falso positivo</strong>. <strong>Desative temporariamente o antivírus</strong> durante a instalação.
                </p>
              </div>

              {/* Stats + Search */}
              <div className="mb-3">
                <div className="flex gap-2 mb-3 flex-wrap items-center">
                  <span className="filter-pill" style={{ cursor: 'default' }}><strong>{multiplayerContent.length}</strong> Total</span>
                  {licenseInfo?.multiplayer !== 'enable' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(15,5,10,0.82)', border: '1px solid rgba(255,45,120,0.45)', borderRadius: '5px', padding: '2px 8px', fontSize: '9px', fontWeight: 700, color: '#ff4d8a', letterSpacing: '0.06em', textTransform: 'uppercase', backdropFilter: 'blur(4px)' }}>
                      <IconLock size={9} /> Premium
                    </span>
                  )}
                  <button onClick={() => setShowMultiplayerTutorial(true)} className="btn-ghost ml-auto" style={{ padding: '6px 12px' }}>
                    Tutorial
                  </button>
                </div>
                <input type="text" value={multiplayerSearchQuery} onChange={(e) => setMultiplayerSearchQuery(e.target.value)}
                  placeholder="Buscar jogos multiplayer..." className="input" />
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {multiplayerContent.length === 0 ? (
                  <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', opacity: 0.3 }}><IconGamepad size={28} /></div>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhum recurso disponível</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Novos recursos multiplayer serão adicionados em breve!</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
                    {multiplayerContent
                      .filter((item) =>
                        item.name.toLowerCase().includes(multiplayerSearchQuery.toLowerCase())
                      )
                      .map((item) => {
                        const hasAccess = licenseInfo?.multiplayer === 'enable';
                        const shouldBlur = !hasAccess;

                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            onClick={() => {
                              if (!hasAccess) {
                                openPremiumModal('Multiplayer Premium', 'Adquira acesso Multiplayer para baixar os fixes e jogar online com amigos.', 'multiplayer');
                              } else {
                                setMultiplayerInstallTarget({
                                  name: item.name,
                                  link: item.link,
                                  thumbnail: item.thumbnail,
                                });
                              }
                            }}
                            className="game-card group"
                            style={{ opacity: shouldBlur ? 0.8 : 1 }}
                          >
                            {/* Badge online */}
                            <div style={{ position: 'absolute', top: '6px', left: '6px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(6,20,12,0.88)', border: '1px solid rgba(34,197,94,0.45)', borderRadius: '5px', padding: '2px 7px', backdropFilter: 'blur(6px)' }}>
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1.4s ease-in-out infinite alternate', flexShrink: 0 }} />
                              <span style={{ fontSize: '9px', fontWeight: 700, color: '#4ade80', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Online</span>
                            </div>

                            {/* Thumbnail 16:9 */}
                            <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden' }}>
                              {item.isLoadingThumbnail ? (
                                <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                              ) : item.thumbnail ? (
                                <img
                                  src={item.thumbnail}
                                  alt={item.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover', filter: shouldBlur ? 'blur(6px)' : 'none', transition: 'transform 0.2s ease' }}
                                  className="group-hover:scale-[1.04]"
                                  loading="lazy"
                                />
                              ) : (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: shouldBlur ? 'blur(6px)' : 'none', opacity: 0.25 }}>
                                  <IconGamepad size={28} />
                                </div>
                              )}

                              {/* Overlay de bloqueio */}
                              {shouldBlur && (
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(124,92,252,0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}><IconLock size={10} /> Premium</span>
                                </div>
                              )}

                              {/* Botão instalar no hover (só se tiver acesso) — usa o mesmo extrator do Bypass */}
                              {hasAccess && (
                                <div className="group-hover:opacity-100" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0 }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.6)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0)'; (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMultiplayerInstallTarget({
                                        name: item.name,
                                        link: item.link,
                                        thumbnail: item.thumbnail,
                                      });
                                    }}
                                    className="btn-primary"
                                    style={{ padding: '6px 14px', fontSize: '11px' }}
                                  >
                                    Instalar
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div style={{ padding: '8px 10px' }}>
                              <h4 style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: shouldBlur ? 0.6 : 1 }}>
                                {item.name}
                              </h4>
                            </div>
                          </motion.div>
                        );
                      })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {currentPage === 'indique' && <ReferralPage licenseKey={licenseKey} />}

          {currentPage === 'tutoriais' && <TutoriaisPage />}

          {false && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{ width: '100%', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              <div className="alert-warning">
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  ⚠️ Só funciona para jogos <strong style={{ color: 'var(--text-primary)' }}>já adicionados na sua conta Steam</strong>
                </p>
              </div>

              {isLoadingGamesJson && (
                <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Carregando banco de dados...</span>
                </div>
              )}

              <input
                type="text"
                value={updateSearchQuery}
                onChange={(e) => setUpdateSearchQuery(e.target.value)}
                placeholder="Ex.: Counter-Strike, 500, God of War..."
                className="input"
                disabled={isLoadingGamesJson || isUpdatingGame}
              />

              {(() => {
                const q = updateSearchQuery.trim();
                if (!q || gamesDatabase.length === 0) return null;
                const isAppId = /^\d+$/.test(q);
                const lower = q.toLowerCase();
                const results = gamesDatabase
                  .filter(g => isAppId ? g.appid === q : g.name.toLowerCase().includes(lower))
                  .slice(0, 60);

                if (results.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 0' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nenhum jogo encontrado para "{q}"</p>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Tente outro termo ou use o AppID direto</p>
                    </div>
                  );
                }

                return (
                  <>
                    <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {updateSelectedGames.size === 0 ? 'Selecione jogos para atualizar' : `${updateSelectedGames.size} jogo(s) selecionado(s)`}
                      </span>
                      <button
                        onClick={async () => {
                          if (updateSelectedGames.size === 0) return;
                          const ids = Array.from(updateSelectedGames);
                          setIsUpdatingGame(true);
                          setUpdateGameMessage(null);
                          setUpdateBulkProgress({ current: 0, total: ids.length, currentName: '' });
                          let ok = 0; let fail = 0; const failures: string[] = [];
                          for (let i = 0; i < ids.length; i++) {
                            const appId = ids[i];
                            const meta = gamesDatabase.find(g => g.appid === appId);
                            setUpdateBulkProgress({ current: i + 1, total: ids.length, currentName: meta?.name || appId });
                            try {
                              const r = await window.electron.updateGameFiles(appId);
                              if (r.success) ok++;
                              else { fail++; failures.push(`${meta?.name || appId}: ${r.error}`); }
                            } catch (e: any) {
                              fail++; failures.push(`${meta?.name || appId}: ${e?.message || 'erro'}`);
                            }
                          }
                          setIsUpdatingGame(false);
                          setUpdateSelectedGames(new Set());
                          setUpdateBulkProgress({ current: 0, total: 0, currentName: '' });
                          if (fail === 0) {
                            setUpdateGameMessage({ type: 'success', text: `✅ ${ok} jogo(s) atualizado(s) com sucesso.` });
                          } else {
                            setUpdateGameMessage({
                              type: fail === ids.length ? 'error' : 'info',
                              text: `${ok} atualizado(s), ${fail} falhou(aram). ${failures.slice(0, 3).join(' | ')}${failures.length > 3 ? '...' : ''}`,
                            });
                          }
                        }}
                        disabled={updateSelectedGames.size === 0 || isUpdatingGame}
                        className="btn-primary"
                        style={{ padding: '6px 14px', fontSize: '12px' }}
                      >
                        {isUpdatingGame ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Atualizando {updateBulkProgress.current}/{updateBulkProgress.total}
                          </>
                        ) : (
                          <>♻️ Atualizar Selecionados ({updateSelectedGames.size})</>
                        )}
                      </button>
                    </div>

                    {isUpdatingGame && updateBulkProgress.total > 0 && (
                      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ padding: '12px 14px', borderLeft: '3px solid var(--accent)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{updateBulkProgress.currentName}</p>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Jogo {updateBulkProgress.current} de {updateBulkProgress.total}</p>
                        <div style={{ marginTop: '8px', width: '100%', background: 'var(--bg-input)', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                          <div style={{ background: 'var(--accent)', height: '100%', transition: 'width 0.3s', width: `${(updateBulkProgress.current / updateBulkProgress.total) * 100}%` }} />
                        </div>
                      </motion.div>
                    )}

                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px', maxHeight: '600px', overflowY: 'auto' }}>
                      {results.map((game) => {
                        const isSelected = updateSelectedGames.has(game.appid);
                        const thumb = game.header_image || 'https://ryuu.lol/manifests/placeholder.png';
                        return (
                          <motion.div
                            key={game.appid}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            onClick={() => {
                              if (isUpdatingGame) return;
                              setUpdateSelectedGames(prev => {
                                const next = new Set(prev);
                                if (next.has(game.appid)) next.delete(game.appid);
                                else next.add(game.appid);
                                return next;
                              });
                            }}
                            className="game-card"
                            style={{
                              opacity: isUpdatingGame ? 0.5 : 1,
                              cursor: isUpdatingGame ? 'not-allowed' : 'pointer',
                              borderColor: isSelected ? 'rgba(124,92,252,0.5)' : undefined,
                              background: isSelected ? 'var(--accent-dim)' : undefined,
                            }}
                          >
                            <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-input)', position: 'relative', overflow: 'hidden' }}>
                              <img
                                src={thumb}
                                alt={game.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { const img = e.currentTarget as HTMLImageElement; img.onerror = null; img.src = 'https://ryuu.lol/manifests/placeholder.png'; }}
                              />
                              {isSelected && (
                                <div style={{ position: 'absolute', top: '6px', right: '6px', width: '20px', height: '20px', background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff' }}>
                                  ✓
                                </div>
                              )}
                            </div>
                            <div style={{ padding: '8px 10px' }}>
                              <h4 style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={game.name}>{game.name}</h4>
                              <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>App ID: {game.appid}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  </>
                );
              })()}

              {updateGameMessage && (
                <div className={updateGameMessage!.type === 'error' ? 'alert-danger' : 'alert-warning'} style={{ fontSize: '12px' }}>
                  {updateGameMessage!.text}
                </div>
              )}
            </motion.div>
          )}

          {currentPage === 'request-game' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
            <div className="w-full max-w-[680px] mx-auto space-y-3">

              <div className="alert-warning">
                <p style={{ fontWeight: 600, marginBottom: '4px' }}>💡 Insira apenas o AppID numérico</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Não use o nome do jogo. O AppID fica na URL da Steam:{' '}
                  <code style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>store.steampowered.com/app/<u>500</u>/...</code>
                </p>
              </div>

              <div className="card">
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>AppID do jogo</label>
                <div className="flex gap-2">
                  <input
                    type="text" inputMode="numeric"
                    value={requestGameInput}
                    onChange={(e) => setRequestGameInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="ex.: 500"
                    className="input"
                    style={{ flex: 1 }}
                    disabled={isRequestingGame}
                  />
                  <button
                    onClick={async () => {
                      const appId = requestGameInput.trim();
                      if (!appId || !/^\d+$/.test(appId)) {
                        setRequestGameMessage({ type: 'error', text: 'Informe um AppID numérico válido.' });
                        return;
                      }
                      setIsRequestingGame(true);
                      setRequestGameMessage({ type: 'info', text: `Enviando solicitação do AppID ${appId}...` });
                      try {
                        const result = await window.electron.requestGameRyuu(appId);
                        if (!result.success) {
                          setRequestGameMessage({ type: 'error', text: result.error || 'Falha ao enviar solicitação.' });
                        } else if (result.alreadyInDb) {
                          setRequestGameMessage({ type: 'info', text: `ℹ️ O AppID ${appId} já está no banco de dados. Tente buscar em "Adicionar Jogos".` });
                        } else {
                          setRequestGameMessage({ type: 'success', text: `✅ Solicitação enviada! O AppID ${appId} foi registrado para análise.` });
                          setRequestGameInput('');
                        }
                      } catch (err: any) {
                        setRequestGameMessage({ type: 'error', text: err?.message || 'Erro inesperado.' });
                      } finally { setIsRequestingGame(false); }
                    }}
                    disabled={isRequestingGame}
                    className="btn-primary flex-shrink-0"
                  >
                    {isRequestingGame ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Enviando...</> : <><IconSend size={12} /> Solicitar</>}
                  </button>
                </div>

                {requestGameMessage && (
                  <div className={`mt-3 ${requestGameMessage.type === 'success' ? 'alert-warning' : requestGameMessage.type === 'error' ? 'alert-danger' : ''}`}
                    style={{ fontSize: '12px', padding: '8px 12px', ...(requestGameMessage.type === 'info' ? { background: 'var(--accent-dim)', border: '1px solid var(--border-focus)', borderRadius: '7px', color: 'var(--text-primary)' } : {}) }}>
                    {requestGameMessage.text}
                  </div>
                )}
              </div>
            </div>
            </motion.div>
          )}

          {/* ===================== +18 NSFW ===================== */}
          {currentPage === 'nsfw-games' && (
            <NsfwPage
              nsfwDatabase={nsfwDatabase}
              isLoading={isLoadingGamesJson}
              myGames={myGames}
              hasNsfwAccess={licenseInfo?.nsfw === 'enable'}
              onPremiumBlock={() => openPremiumModal('Conteúdo +18 — Premium', 'Acesse jogos adultos com o plano que inclui conteúdo +18 desbloqueado.', 'nsfw_premium')}
              onRemove={async (appid, name) => {
                try {
                  const result = await window.electron.removeGame(appid);
                  if (result.success) {
                    setMyGames(prev => prev.filter(g => g.appid !== appid));
                    setHomeMessage({ type: 'success', text: `${name} removido com sucesso!` });
                  } else {
                    setHomeMessage({ type: 'error', text: result.error || 'Erro ao remover jogo' });
                  }
                } catch (err: any) {
                  setHomeMessage({ type: 'error', text: err.message || 'Erro ao remover jogo' });
                }
              }}
              onInstall={async (appid, name) => {
                setHomeMessage(null);
                try {
                  const ensureResult = await window.electron.ensureHidDll();
                  if (!ensureResult.success) return;
                  await window.electron.downloadManifestorLua(appid, name, false);
                  const updated = await window.electron.getMyGames();
                  if (updated.success) {
                    setMyGames(updated.games.map((g: any) => ({
                      appid: String(g.appid),
                      name: g.name,
                      thumb: null,
                    })));
                  }
                  // Auto-adicionar à coleção +18 no Steam após instalar
                  window.electron.syncAdultCategories([appid]).catch(() => {});
                } catch (err) {
                  console.error('Erro ao instalar jogo +18:', err);
                }
              }}
            />
          )}

          {/* ===================== REMOVER DENUVO ===================== */}
          {currentPage === 'denuvo' && (
            <DenuvoRemoval
              licenseKey={licenseKey}
              licenseName={licenseInfo?.nome}
            />
          )}

          {/* ===================== CONFIGURAÇÕES ===================== */}
          {currentPage === 'settings' && (
            <Settings
              licenseKey={licenseKey}
              hwid={hwid}
              licenseInfo={licenseInfo}
              onLicenseInfoChanged={async () => {
                try {
                  const fresh = await getLicenseInfo(licenseKey);
                  if (fresh) setLicenseInfo(fresh);
                } catch {}
              }}
            />
          )}

          </div>
        </div>
      </div>

      {/* Warning Modal for Premium Bypass */}
      {showBypassWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-[2vw]">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card-minimal rounded-xl p-4 max-w-[600px] w-full border border-red-600"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">⚠️</span>
              <h3 className="text-sm font-bold text-white">Atenção - Termos de Uso</h3>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.6", marginBottom: "12px" }}>
              <strong className="text-red-400">NÃO COMPARTILHE OS LINKS DE BYPASS PREMIUM.</strong>
              <br /><br />
              O compartilhamento de links premium pode resultar na <strong className="text-red-400">suspensão permanente</strong> da sua licença sem direito a reembolso.
            </p>

            <div className="flex items-start gap-[0.75vw] mb-3 p-[2vh_1.5vw] bg-black bg-opacity-30 rounded-lg">
              <input
                type="checkbox"
                id="bypass-warning-checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    localStorage.setItem('titanforge_bypass_warning_dismissed', 'true');
                  } else {
                    localStorage.removeItem('titanforge_bypass_warning_dismissed');
                  }
                }}
                className="mt-1 w-5 h-5 cursor-pointer"
              />
              <label htmlFor="bypass-warning-checkbox" style={{ fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer", flex: 1 }}>
                Não mostrar este aviso novamente
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowBypassWarning(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-3 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowBypassWarning(false);
                }}
                className="flex-1 btn-minimal py-2 text-sm font-semibold"
              >
                Aceito e Concordo
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Confirmation Modal — Remover / Atualizar Jogo */}
      {confirmModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)' }}
          onClick={() => { if (!confirmLoading) setConfirmModal(null); }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="card"
            style={{ maxWidth: '420px', width: '90%', padding: '28px 24px', borderColor: confirmModal.type === 'remove' ? 'var(--red-border)' : 'rgba(124,92,252,0.28)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Icon */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px',
                background: confirmModal.type === 'remove' ? 'var(--red-dim)' : 'var(--accent-dim)',
                border: `1px solid ${confirmModal.type === 'remove' ? 'var(--red-border)' : 'rgba(124,92,252,0.28)'}`,
              }}>
                {confirmModal.type === 'remove' ? <IconTrash size={24} /> : <IconRefresh size={24} />}
              </div>
            </div>

            {/* Title */}
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', marginBottom: '8px' }}>
              {confirmModal.type === 'remove' ? 'Remover Jogo' : 'Atualizar Jogo'}
            </h2>

            {/* Game name */}
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '6px' }}>
              {confirmModal.name}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '20px' }}>
              App ID: {confirmModal.appid}
            </p>

            {/* Description */}
            <div style={{
              padding: '10px 14px', borderRadius: '8px', marginBottom: '20px', fontSize: '12px', lineHeight: 1.6, color: 'var(--text-secondary)',
              background: confirmModal.type === 'remove' ? 'var(--red-dim)' : 'var(--accent-dim)',
              border: `1px solid ${confirmModal.type === 'remove' ? 'var(--red-border)' : 'rgba(124,92,252,0.22)'}`,
            }}>
              {confirmModal.type === 'remove' ? (
                <>O arquivo <strong style={{ color: 'var(--text-primary)' }}>.lua</strong> será deletado permanentemente. Você pode reinstalar o jogo a qualquer momento pela aba <strong style={{ color: 'var(--text-primary)' }}>Adicionar Jogo</strong>.</>
              ) : (
                <>Os arquivos do jogo serão <strong style={{ color: 'var(--text-primary)' }}>rebaixados da fonte mais recente</strong>. A Steam será reiniciada automaticamente após a atualização.</>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmModal(null)}
                disabled={confirmLoading}
                className="btn-ghost"
                style={{ flex: 1, justifyContent: 'center', padding: '10px' }}
              >
                Cancelar
              </button>
              <button
                disabled={confirmLoading}
                onClick={async () => {
                  if (!confirmModal) return;
                  setConfirmLoading(true);
                  try {
                    if (confirmModal.type === 'remove') {
                      const result = await window.electron.removeGame(confirmModal.appid);
                      if (result.success) {
                        console.log(`✅ Jogo removido: ${confirmModal.name} (AppID: ${confirmModal.appid})`);
                        setMyGames(prev => prev.filter(g => g.appid !== confirmModal.appid));
                        setHomeMessage({ type: 'success', text: `${confirmModal.name} removido com sucesso!` });
                      } else {
                        setHomeMessage({ type: 'error', text: result.error || 'Erro ao remover jogo' });
                      }
                    } else {
                      const result = await window.electron.updateGameFiles(confirmModal.appid);
                      if (result.success) {
                        console.log(`✅ Jogo atualizado: ${confirmModal.name} (AppID: ${confirmModal.appid})`);
                        // Restart Steam automatically after update
                        try {
                          const steamResult = await window.electron.detectSteamPath();
                          if (steamResult.success && steamResult.path) {
                            await window.electron.restartSteam(steamResult.path);
                          }
                        } catch (e) {
                          console.error('Erro ao reiniciar Steam:', e);
                        }
                        setHomeMessage({ type: 'success', text: `${confirmModal.name} atualizado com sucesso! Steam reiniciada.` });
                      } else {
                        setHomeMessage({ type: 'error', text: result.error || 'Erro ao atualizar jogo' });
                      }
                    }
                  } catch (err: any) {
                    setHomeMessage({ type: 'error', text: err.message || 'Erro desconhecido' });
                  } finally {
                    setConfirmLoading(false);
                    setConfirmModal(null);
                  }
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: 600, fontFamily: 'Syne, sans-serif', cursor: confirmLoading ? 'not-allowed' : 'pointer', transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', opacity: confirmLoading ? 0.55 : 1,
                  background: confirmModal.type === 'remove' ? 'var(--red)' : 'var(--accent)',
                  color: '#fff',
                }}
              >
                {confirmLoading ? (
                  <><div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} /><span>{confirmModal.type === 'remove' ? 'Removendo...' : 'Atualizando...'}</span></>
                ) : (
                  confirmModal.type === 'remove' ? <><IconTrash size={12} /> Remover</> : <><IconRefresh size={12} /> Atualizar</>

                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* DRM Warning Modal */}
      {showDrmWarning && selectedGameForDrmWarning && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[10000] p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="w-full max-w-3xl bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] rounded-2xl shadow-2xl overflow-hidden" style={{ border: '1px solid var(--neon-border)' }}
          >
            {/* Header com thumbnail de fundo */}
            <div className="relative h-64 overflow-hidden">
              {/* Background Image */}
              <div className="absolute inset-0">
                {drmGameDetails?.header_image || selectedGameForDrmWarning.header_image_url ? (
                  <img
                    src={drmGameDetails?.header_image || selectedGameForDrmWarning.header_image_url}
                    alt={selectedGameForDrmWarning.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, rgba(232,48,90,0.12) 0%, #0f0f0f 100%)' }} />
                )}
                {/* Overlay gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/50 to-transparent" />
              </div>

              {/* Content over image */}
              <div className="relative h-full flex flex-col justify-end p-6">
                <div className="flex items-start gap-4">
                  {/* Shield Icon */}
                  <div className="flex-shrink-0 w-16 h-16 rounded-xl backdrop-blur-md flex items-center justify-center" style={{ background: 'var(--neon-dim)', border: '2px solid var(--neon)' }}>
                    <Shield className="w-8 h-8" style={{ color: 'var(--neon-bright)' }} />
                  </div>

                  {/* Title & Info */}
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">
                      {selectedGameForDrmWarning.name}
                    </h2>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-sm" style={{ background: 'var(--neon-dim)', border: '1px solid var(--neon-border)', color: 'var(--neon-bright)' }}>
                        <Shield className="w-3 h-3 inline mr-1" />
                        Proteção DRM Detectada
                      </span>
                      {selectedGameForDrmWarning.is_dlc && (
                        <span className="px-3 py-1 bg-blue-500/20 border border-blue-500/50 rounded-full text-blue-300 text-xs font-semibold backdrop-blur-sm">
                          DLC
                        </span>
                      )}
                    </div>
                    <p className="text-gray-300 text-sm">
                      App ID: <span className="font-mono font-semibold">{selectedGameForDrmWarning.appid}</span>
                    </p>
                  </div>

                  {/* Close Button */}
                  <button
                    onClick={() => {
                      setShowDrmWarning(false);
                      setSelectedGameForDrmWarning(null);
                      setDrmGameDetails(null);
                    }}
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all"
                  >
                    <span className="text-white text-2xl leading-none">×</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* DRM Notice */}
              {selectedGameForDrmWarning.drm_notice && (
                <div className="rounded-xl p-4" style={{ background: 'var(--neon-dim)', border: '1px solid var(--neon-border)' }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(232,48,90,0.20)' }}>
                      <Shield className="w-5 h-5" style={{ color: 'var(--neon-bright)' }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm mb-1" style={{ color: 'var(--neon-bright)' }}>Tipo de Proteção DRM</h3>
                      <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.80)' }}>
                        {selectedGameForDrmWarning.drm_notice}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* External Account Notice */}
              {selectedGameForDrmWarning.ext_user_account_notice && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-blue-300 font-bold text-sm mb-1">Requisito de Conta Externa</h3>
                      <p className="text-blue-100/80 text-sm leading-relaxed">
                        {selectedGameForDrmWarning.ext_user_account_notice}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Game Description */}
              {isLoadingDrmDetails ? (
                <div className="bg-white/5 rounded-xl p-6 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-purple-500 animate-spin mr-3" />
                  <span className="text-gray-400">Carregando detalhes do jogo...</span>
                </div>
              ) : drmGameDetails ? (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-white font-bold text-sm mb-2">Sobre este jogo</h3>
                  <p className="text-gray-400 text-sm leading-relaxed line-clamp-4">
                    {drmGameDetails.short_description || 'Descrição não disponível.'}
                  </p>
                  {drmGameDetails.developers && drmGameDetails.developers.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <span className="text-gray-500 text-xs">Desenvolvedora: </span>
                      <span className="text-gray-300 text-xs font-medium">{drmGameDetails.developers.join(', ')}</span>
                    </div>
                  )}
                  {drmGameDetails.publishers && drmGameDetails.publishers.length > 0 && (
                    <div className="mt-1">
                      <span className="text-gray-500 text-xs">Publicadora: </span>
                      <span className="text-gray-300 text-xs font-medium">{drmGameDetails.publishers.join(', ')}</span>
                    </div>
                  )}
                  {drmGameDetails.release_date && (
                    <div className="mt-1">
                      <span className="text-gray-500 text-xs">Lançamento: </span>
                      <span className="text-gray-300 text-xs font-medium">{drmGameDetails.release_date.date}</span>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Bypass Recommendation */}
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                      <span className="text-2xl">💡</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-purple-300 font-bold text-sm mb-2">Recomendação</h3>
                    <p className="text-purple-100/80 text-sm leading-relaxed mb-3">
                      Este jogo possui proteção DRM <strong>({selectedGameForDrmWarning.drm_notice})</strong>, o que pode dificultar ou impossibilitar sua execução sem uma conta Steam válida.
                    </p>
                    <p className="text-purple-100/80 text-sm leading-relaxed">
                      Verifique na aba <strong className="text-purple-200">Bypass</strong> se temos uma solução disponível para este jogo. Bypasses removem ou contornam proteções DRM, permitindo execução offline.
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowDrmWarning(false);
                    setSelectedGameForDrmWarning(null);
                    setDrmGameDetails(null);
                    setCurrentPage('bypass');
                  }}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-xl transition-all text-sm"
                >
                  Verificar Bypasses Disponíveis
                </button>
                <button
                  onClick={() => {
                    setShowDrmWarning(false);
                    setSelectedGameForDrmWarning(null);
                    setDrmGameDetails(null);
                  }}
                  className="flex-1 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold py-3 px-4 rounded-xl transition-all text-sm"
                >
                  Entendi
                </button>
              </div>

              {/* Steam Link */}
              <div className="text-center">
                <button
                  onClick={() => {
                    window.electron.openExternalUrl(`https://store.steampowered.com/app/${selectedGameForDrmWarning.appid}`);
                  }}
                  className="text-blue-400 hover:text-blue-300 text-xs underline transition-colors"
                >
                  Ver na Steam Store →
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal Tutorial: Bypass */}
      {showBypassTutorial && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-2xl w-[90%] max-h-[85vh] bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] rounded-2xl border border-blue-500/30 p-6 overflow-y-auto custom-scrollbar"
          >
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blue-500/20 flex items-center justify-center">
                <span className="text-4xl">📚</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Tutorial: Como Instalar Bypass</h2>
              <p className="text-gray-400 text-sm">Siga os passos abaixo para instalar corretamente</p>
            </div>

            {/* O que é Denuvo */}
            <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--neon-dim)', border: '1px solid var(--neon-border)' }}>
              <h3 className="font-bold text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--neon-bright)' }}>
                <span>💡</span> O que é Denuvo?
              </h3>
              <p className="text-gray-300 text-xs leading-relaxed">
                <strong>Denuvo</strong> é um sistema de proteção anti-pirataria usado em jogos AAA.
                Ele dificulta a execução de cópias não autorizadas. Os arquivos de <strong>bypass</strong>
                {' '}removem ou contornam essa proteção, permitindo que você jogue sem ativação.
              </p>
            </div>

            {/* Passo a Passo */}
            <div className="space-y-4">
              {/* Passo 1 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold text-sm">1</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Baixe o arquivo de bypass</h4>
                    <p className="text-gray-400 text-xs">
                      Clique no botão <strong>"Baixar"</strong> no jogo desejado e escolha onde salvar o arquivo <strong>.zip</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold text-sm">2</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Desative temporariamente o antivírus</h4>
                    <p className="text-gray-400 text-xs">
                      O Windows Defender pode bloquear arquivos <strong>.dll</strong> e <strong>.exe</strong>.
                      Desative-o antes de extrair o arquivo. <span className="text-red-400">Isso é seguro - é um falso positivo.</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold text-sm">3</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Extraia o arquivo .zip</h4>
                    <p className="text-gray-400 text-xs">
                      Clique com o botão direito no arquivo baixado e selecione <strong>"Extrair Aqui"</strong> ou
                      {' '}<strong>"Extrair para..."</strong>. Você verá arquivos como <strong>.dll</strong>, <strong>.exe</strong>, etc.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 4 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold text-sm">4</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Localize a pasta do jogo</h4>
                    <p className="text-gray-400 text-xs mb-2">
                      Abra a Steam → Biblioteca → Clique com botão direito no jogo →
                      {' '}<strong>"Gerenciar"</strong> → <strong>"Procurar arquivos locais"</strong>.
                    </p>
                    <p className="text-gray-500 text-xs italic">
                      Exemplo: <code className="bg-black/50 px-1 rounded">C:\Program Files (x86)\Steam\steamapps\common\NomeDoJogo\</code>
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 5 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold text-sm">5</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Copie os arquivos para a pasta do jogo</h4>
                    <p className="text-gray-400 text-xs">
                      Arraste todos os arquivos extraídos (geralmente <strong>.dll</strong> e <strong>.exe</strong>)
                      {' '}para a <strong>pasta raiz do jogo</strong> (onde está o executável principal).
                      Substitua arquivos se solicitado.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 6 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <span className="text-green-400 font-bold text-sm">✓</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Pronto! Inicie o jogo</h4>
                    <p className="text-gray-400 text-xs">
                      Você pode reativar o antivírus agora. Inicie o jogo pela Steam normalmente.
                      O bypass já está instalado e o jogo deve funcionar sem ativação.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Botão Fechar */}
            <button
              onClick={() => setShowBypassTutorial(false)}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all"
            >
              Entendi
            </button>
          </motion.div>
        </div>
      )}

      {/* Modal Tutorial: Multiplayer */}
      {showMultiplayerTutorial && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-2xl w-[90%] max-h-[85vh] bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] rounded-2xl border border-cyan-500/30 p-6 overflow-y-auto custom-scrollbar"
          >
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <span className="text-4xl">📚</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Tutorial: Como Instalar Multiplayer</h2>
              <p className="text-gray-400 text-sm">Siga os passos abaixo para instalar corretamente</p>
            </div>

            {/* Passo a Passo */}
            <div className="space-y-4">
              {/* Passo 1 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 font-bold text-sm">1</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Baixe o arquivo multiplayer</h4>
                    <p className="text-gray-400 text-xs">
                      Clique no botão <strong>"Baixar"</strong> no jogo desejado e escolha onde salvar o arquivo <strong>.zip</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 font-bold text-sm">2</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Desative temporariamente o antivírus</h4>
                    <p className="text-gray-400 text-xs">
                      O Windows Defender pode bloquear arquivos <strong>.dll</strong> e <strong>.exe</strong>.
                      Desative-o antes de extrair o arquivo. <span className="text-red-400">Isso é seguro - é um falso positivo.</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 font-bold text-sm">3</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Extraia o arquivo .zip</h4>
                    <p className="text-gray-400 text-xs">
                      Clique com o botão direito no arquivo baixado e selecione <strong>"Extrair Aqui"</strong> ou
                      {' '}<strong>"Extrair para..."</strong>. Você verá arquivos como <strong>.dll</strong>, <strong>.exe</strong>, etc.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 4 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 font-bold text-sm">4</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Localize a pasta do jogo</h4>
                    <p className="text-gray-400 text-xs mb-2">
                      Abra a Steam → Biblioteca → Clique com botão direito no jogo →
                      {' '}<strong>"Gerenciar"</strong> → <strong>"Procurar arquivos locais"</strong>.
                    </p>
                    <p className="text-gray-500 text-xs italic">
                      Exemplo: <code className="bg-black/50 px-1 rounded">C:\Program Files (x86)\Steam\steamapps\common\NomeDoJogo\</code>
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 5 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 font-bold text-sm">5</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Copie os arquivos para a pasta do jogo</h4>
                    <p className="text-gray-400 text-xs">
                      Arraste todos os arquivos extraídos (geralmente <strong>.dll</strong> e <strong>.exe</strong>)
                      {' '}para a <strong>pasta raiz do jogo</strong> (onde está o executável principal).
                      Substitua arquivos se solicitado.
                    </p>
                  </div>
                </div>
              </div>

              {/* Passo 6 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <span className="text-green-400 font-bold text-sm">✓</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-bold text-sm mb-1">Pronto! Inicie o jogo</h4>
                    <p className="text-gray-400 text-xs">
                      Você pode reativar o antivírus agora. Inicie o jogo pela Steam normalmente.
                      O crack multiplayer já está instalado e você poderá jogar online.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Botão Fechar */}
            <button
              onClick={() => setShowMultiplayerTutorial(false)}
              className="w-full mt-6 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl transition-all"
            >
              Entendi
            </button>
          </motion.div>
        </div>
      )}

      {/* CompleteProfileModal — abre se algum dado essencial está vazio */}
      {licenseInfo && (!licenseInfo.nome || !licenseInfo.email || !licenseInfo.numero) && (
        <CompleteProfileModal
          licenseKey={licenseKey}
          initial={{ nome: licenseInfo.nome, email: licenseInfo.email, numero: licenseInfo.numero }}
          onComplete={async () => {
            try {
              const fresh = await getLicenseInfo(licenseKey);
              if (fresh) setLicenseInfo(fresh);
            } catch {}
          }}
        />
      )}

      {/* Toast de chargeback (vermelho, persistente até fechar) */}
      {chargebackToast && (
        <motion.div
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          style={{
            position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
            zIndex: 99999,
            background: 'linear-gradient(135deg, rgba(220,38,38,0.95), rgba(157,23,77,0.95))',
            border: '1px solid rgba(255,77,138,0.45)',
            borderRadius: 10, padding: '14px 18px',
            maxWidth: 480, boxShadow: '0 10px 40px rgba(220,38,38,0.4)',
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}
        >
          <span style={{ color: '#fff', flexShrink: 0, marginTop: 2 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, color: '#fff', fontWeight: 700, margin: '0 0 4px' }}>
              Sua licença foi suspensa
            </p>
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)', margin: 0, lineHeight: 1.5 }}>
              Detectamos uma contestação de cobrança em uma de suas compras. Por política, a licença é suspensa automaticamente. Entre em contato com o suporte caso isso seja um engano.
            </p>
          </div>
          <button onClick={() => setChargebackToast(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 16, padding: 0, marginLeft: 4 }}>
            ×
          </button>
        </motion.div>
      )}

      {/* Modal de pagamento (PIX + Cartão) */}
      {pixPurchaseProduct && (
        <PaymentModal
          product={pixPurchaseProduct}
          licenseKey={licenseKey}
          licenseName={licenseInfo?.nome}
          licenseEmail={licenseInfo?.email}
          licensePhone={licenseInfo?.numero}
          onClose={() => setPixPurchaseProduct(null)}
          onPaid={async () => {
            try {
              const fresh = await getLicenseInfo(licenseKey);
              if (fresh) setLicenseInfo(fresh);
            } catch {}
          }}
        />
      )}

      {/* Copy Toast Notification */}
      {copyToast && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-[5vh] right-[3vw] bg-green-500 text-white font-semibold px-3 py-2 rounded-lg shadow-lg text-sm z-50"
        >
          {copyToast}
        </motion.div>
      )}

      {/* Modal Adicionar Jogo */}
      {showAddGameModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="card custom-scrollbar"
            style={{ width: '90%', maxWidth: '860px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>Buscar Jogos</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Busque por nome ou App ID do jogo</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {licenseInfo?.add_games !== 'enable' && (
                  <button
                    onClick={() => { setShowAddGameModal(false); openPremiumModal('Adicionar Jogos', 'Acesso à função de adicionar jogos personalizados.', 'adicionar_jogo'); }}
                    style={{
                      padding: '8px 14px', fontSize: 11.5, fontWeight: 700,
                      background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)',
                      border: 'none', borderRadius: 8, color: '#fff',
                      cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.02em',
                      boxShadow: '0 4px 14px rgba(124,92,252,0.30)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <IconCrown size={12} /> Adquirir função
                  </button>
                )}
                <button
                  onClick={() => setShowAddGameModal(false)}
                  className="btn-ghost"
                  style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ position: 'relative' }}>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Ex: Cyberpunk, God of War, 1091500..."
                  className="input"
                  disabled={isLoadingGamesJson || isBulkDownloading}
                  autoFocus
                />
                {isSearchingDepotbox && (
                  <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                    <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                  </div>
                )}
              </div>

              {/* Results count + Select all */}
              {displayedResults.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {displayedResults.length} resultado{displayedResults.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => {
                      if (selectedGames.size === displayedResults.length) {
                        setSelectedGames(new Set());
                      } else {
                        setSelectedGames(new Set(displayedResults.map(g => g.appid)));
                      }
                    }}
                    style={{ fontSize: '12px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Syne, sans-serif', transition: 'opacity 0.15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.75')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                  >
                    {selectedGames.size === displayedResults.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                </div>
              )}
            </div>

            {/* Results Grid - Scrollable */}
            <div className="custom-scrollbar results-scrollable" style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
              {isSearchingDepotbox ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '10px' }}>
                  <Loader2 className="h-6 w-6 text-purple-500 animate-spin" />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Buscando jogos...</span>
                </div>
              ) : isLoadingGamesJson ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '10px' }}>
                  <Loader2 className="h-6 w-6 text-purple-500 animate-spin" />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Carregando banco de dados...</span>
                </div>
              ) : displayedResults.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {searchQuery ? 'Nenhum jogo encontrado' : 'Digite para buscar jogos'}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '8px' }}>
                    {displayedResults
                      .slice(0, displayLimit)
                      .map((game) => {
                        const isSelected = selectedGames.has(game.appid);

                    return (
                      <motion.div
                        key={game.appid}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newSelected = new Set(selectedGames);
                          if (isSelected) {
                            newSelected.delete(game.appid);
                          } else {
                            newSelected.add(game.appid);
                          }
                          setSelectedGames(newSelected);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 12px',
                          background: isSelected ? 'var(--green-dim)' : 'var(--bg-card)',
                          border: `1px solid ${isSelected ? 'rgba(22,163,74,0.35)' : 'var(--border)'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                        onMouseEnter={(e) => { if (!isSelected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)'; } }}
                        onMouseLeave={(e) => { if (!isSelected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; } }}
                      >
                        {/* Thumbnail 120x56 */}
                        <div style={{ width: '120px', height: '56px', background: 'var(--bg-input)', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
                          {gamesThumbnails[game.appid] ? (
                            <img
                              src={gamesThumbnails[game.appid]}
                              alt={game.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              loading="lazy"
                            />
                          ) : (
                            <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                          )}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h4 style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {game.name}
                          </h4>
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            ID: {game.appid}
                          </p>
                        </div>

                        {/* DRM Shield Icon */}
                        {useDepotBox && (('drm_notice' in game && (game as any).drm_notice) || ('ext_user_account_notice' in game && (game as any).ext_user_account_notice)) && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const depotGame = game as DepotBoxGame;
                              setSelectedGameForDrmWarning(depotGame);
                              setShowDrmWarning(true);
                              setIsLoadingDrmDetails(true);

                              try {
                                const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${game.appid}&l=portuguese`);
                                const data = await response.json();

                                if (data[game.appid]?.success) {
                                  setDrmGameDetails(data[game.appid].data);
                                }
                              } catch (error) {
                                console.error('Error fetching game details:', error);
                              } finally {
                                setIsLoadingDrmDetails(false);
                              }
                            }}
                            className="btn-ghost"
                            style={{ flexShrink: 0, width: '30px', height: '30px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderColor: 'var(--neon-border)' }}
                            title={`${(game as any).drm_notice ? 'DRM: ' + (game as any).drm_notice : ''} ${(game as any).ext_user_account_notice ? (game as any).drm_notice ? ' | ' : '' + (game as any).ext_user_account_notice : ''}`}
                          >
                            <Shield className="w-3.5 h-3.5" style={{ color: 'var(--neon)' }} />
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Indicador de "Carregando Mais" */}
                {displayLimit < displayedResults.length && (
                  <div style={{ textAlign: 'center', padding: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Role para carregar mais jogos...</span>
                  </div>
                )}

                {/* Mensagem de "Todos carregados" */}
                {displayLimit >= displayedResults.length && displayedResults.length > 0 && (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Todos os {displayedResults.length} jogos carregados
                  </div>
                )}
              </>
              )}
            </div>

            {/* Footer with Install Button */}
            {selectedGames.size > 0 && (
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => {
                    if (licenseInfo?.add_games !== 'enable') { setShowAddGameModal(false); openPremiumModal('Adicionar Jogos — Premium', 'Para adicionar jogos individualmente à sua biblioteca, você precisa do plano com este recurso desbloqueado.', 'adicionar_jogo'); return; }
                    handleBulkDownload();
                  }}
                  disabled={isBulkDownloading}
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '13px' }}
                >
                  {isBulkDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Instalando {bulkDownloadProgress.current}/{bulkDownloadProgress.total}</span>
                    </>
                  ) : (
                    <>
                      Instalar {selectedGames.size} jogo{selectedGames.size !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Premium Toast */}
      {premiumToast && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999, background: 'rgba(15,15,18,0.95)', border: '1px solid rgba(255,45,120,0.35)', borderRadius: '12px', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', minWidth: '320px', maxWidth: '420px', backdropFilter: 'blur(12px)', boxShadow: '0 0 30px rgba(255,45,120,0.12), 0 4px 24px rgba(0,0,0,0.5)', animation: 'toastIn .25s ease', fontFamily: 'Syne, sans-serif' }}>
          <div style={{ width: '36px', height: '36px', flexShrink: 0, background: 'rgba(255,45,120,0.10)', border: '1px solid rgba(255,45,120,0.25)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4d8a" strokeWidth="1.8" strokeLinecap="round"><path d="M2 20h20M5 20l2-8 5 4 5-4 2 8"/><path d="M12 4l2 4H10l2-4z"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff', marginBottom: '2px' }}>Recurso Premium</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>Faça upgrade para Premium para usar esta função.</div>
          </div>
          <button
            onClick={() => { setPremiumToast(false); setShowAddGameModal(false); openPremiumModal('Upgrade — Adicionar Jogos', 'Adquira um plano com o recurso de adicionar jogos desbloqueado.', 'adicionar_jogo'); }}
            style={{ background: 'rgba(255,45,120,0.15)', border: '1px solid rgba(255,45,120,0.30)', borderRadius: '6px', padding: '5px 10px', fontSize: '10px', fontWeight: 600, color: '#ff4d8a', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Syne, sans-serif' }}>
            Upgrade
          </button>
        </div>
      )}

      {/* Effects toggle button — only shown on home */}
      {currentPage === 'home' && (
        <button
          onClick={() => {
            const next = !effectsEnabled;
            setEffectsEnabled(next);
            localStorage.setItem('titanforge_home_effects', String(next));
          }}
          title={effectsEnabled ? 'Desativar efeitos' : 'Ativar efeitos'}
          style={{
            position: 'fixed', bottom: '16px', right: '16px',
            zIndex: 9999,
            width: '34px', height: '34px',
            borderRadius: '50%',
            background: effectsEnabled ? 'rgba(124,92,252,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${effectsEnabled ? 'rgba(124,92,252,0.45)' : 'rgba(255,255,255,0.10)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: effectsEnabled ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'background .2s, border-color .2s, color .2s',
            fontSize: '14px',
          }}
        >
          ✦
        </button>
      )}

      {/* ── Aviso fixo: manter launcher aberto ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: '220px', right: 0,
        zIndex: 8000,
        background: 'linear-gradient(90deg, rgba(255,45,120,0.07) 0%, rgba(10,8,14,0.96) 40%)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(255,45,120,0.14)',
        padding: '8px 24px',
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        {/* Pulse dot */}
        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ff2d78', flexShrink: 0, animation: 'pulse 1.2s ease-in-out infinite alternate', boxShadow: '0 0 6px rgba(255,45,120,0.55)' }} />
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', fontFamily: 'Syne, sans-serif' }}>
          <strong style={{ color: 'rgba(255,100,140,0.9)', fontWeight: 700 }}>Mantenha o TitanForge aberto</strong>
          {' '}enquanto joga — fechar o launcher desativa a proteção dos jogos.
        </span>
      </div>

      {/* ── Modal DLC ── */}
      {dlcModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDlcModal(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onClick={e => e.stopPropagation()}
            style={{ background: '#0c0c0f', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', width: '480px', maxWidth: '94vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(22,163,74,0.10)' }}
          >
            {/* Header */}
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                  <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  DLCs — {dlcModal.gameName}
                </h3>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.30)' }}>
                  {dlcModal.dlcs.length === 0 ? 'Nenhuma DLC disponível' : `${dlcModal.dlcs.length} DLC${dlcModal.dlcs.length !== 1 ? 's' : ''} encontrada${dlcModal.dlcs.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={() => setDlcModal(null)}
                style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: '16px', flexShrink: 0 }}
              >
                ×
              </button>
            </div>

            {/* DLC grid */}
            <div className="custom-scrollbar" style={{ overflowY: 'auto', padding: '14px 16px' }}>
              {dlcModal.dlcs.length === 0 ? (
                <div style={{ padding: '48px 0', textAlign: 'center' }}>
                  <div style={{ opacity: 0.2, display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  </div>
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)', fontWeight: 600 }}>Nenhuma DLC disponível</p>
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.15)', marginTop: '5px' }}>Este jogo não possui DLCs na base de dados.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
                  {dlcModal.dlcs.map(dlc => {
                    const isDownloading = dlcDownloading.has(dlc.appid);
                    const isDone = dlcDone.has(dlc.appid);
                    const thumbSrc = dlc.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${dlc.appid}/header.jpg`;

                    return (
                      <div
                        key={dlc.appid}
                        style={{
                          background: isDone ? 'rgba(22,163,74,0.06)' : 'rgba(255,255,255,0.025)',
                          border: `1px solid ${isDone ? 'rgba(22,163,74,0.28)' : 'rgba(255,255,255,0.07)'}`,
                          borderRadius: '10px',
                          overflow: 'hidden',
                          display: 'flex', flexDirection: 'column',
                          transition: 'border-color .2s',
                        }}
                      >
                        {/* Thumbnail */}
                        <div style={{ width: '100%', aspectRatio: '460/215', background: '#0e0e12', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                          <img
                            src={thumbSrc}
                            alt={dlc.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            loading="lazy"
                            onError={e => { (e.target as HTMLImageElement).src = 'https://ryuu.lol/manifests/placeholder.png'; }}
                          />
                          {isDone && (
                            <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(6,18,10,0.88)', border: '1px solid rgba(22,163,74,0.50)', borderRadius: '5px', padding: '2px 7px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <IconCheck size={9} />
                              <span style={{ fontSize: '9px', fontWeight: 700, color: '#4ade80' }}>Instalada</span>
                            </div>
                          )}
                        </div>

                        {/* Info + action */}
                        <div style={{ padding: '9px 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: '#e8e8f0', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{dlc.name}</p>
                          <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.24)' }}>ID: {dlc.appid}</p>
                          <button
                            disabled={isDownloading || isDone}
                            onClick={async () => {
                              setDlcDownloading(prev => new Set(prev).add(dlc.appid));
                              console.log(`📥 Baixando DLC: dlcAppId=${dlc.appid}, baseGameAppId=${dlcModal!.gameAppid}`);
                              try {
                                const result = await window.electron.downloadDlcManifest(dlc.appid, dlcModal!.gameAppid);
                                console.log(`📦 Resultado DLC:`, result);
                                if (result.success) {
                                  setDlcDone(prev => new Set(prev).add(dlc.appid));
                                } else {
                                  console.error('❌ Erro ao baixar DLC:', result.error);
                                }
                              } finally {
                                setDlcDownloading(prev => { const n = new Set(prev); n.delete(dlc.appid); return n; });
                              }
                            }}
                            style={{
                              marginTop: 'auto',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                              background: isDone ? 'rgba(22,163,74,0.10)' : isDownloading ? 'rgba(22,163,74,0.06)' : 'rgba(22,163,74,0.14)',
                              border: `1px solid ${isDone ? 'rgba(22,163,74,0.35)' : 'rgba(22,163,74,0.28)'}`,
                              borderRadius: '7px', padding: '7px 10px',
                              fontSize: '11px', fontWeight: 700,
                              color: isDone ? 'rgba(74,222,128,0.55)' : '#4ade80',
                              cursor: isDone || isDownloading ? 'not-allowed' : 'pointer',
                              fontFamily: 'Syne, sans-serif',
                              width: '100%',
                              opacity: isDownloading ? 0.65 : 1,
                              transition: 'background .15s',
                            }}
                          >
                            {isDownloading ? (
                              <><Loader2 className="animate-spin" style={{ width: '11px', height: '11px' }} /> Baixando...</>
                            ) : isDone ? (
                              <><IconCheck size={11} /> Instalada</>
                            ) : (
                              <><IconDownload size={11} /> Baixar DLC</>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            
          </motion.div>
        </div>
      )}
    </div>
  );
};

// ===================== NSFW / +18 PAGE =====================
interface NsfwPageProps {
  nsfwDatabase: Array<{ appid: string; name: string; header_image: string; drm?: boolean }>;
  isLoading: boolean;
  myGames: Array<{ appid: string; name: string | null; thumb: string | null }>;
  hasNsfwAccess: boolean;
  onInstall: (appid: string, name: string) => Promise<void>;
  onRemove: (appid: string, name: string) => Promise<void>;
  onPremiumBlock: () => void;
}

const NSFW_PAGE_SIZE = 30;

const NsfwPage: React.FC<NsfwPageProps> = ({ nsfwDatabase, isLoading, myGames, hasNsfwAccess, onInstall, onRemove, onPremiumBlock }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(NSFW_PAGE_SIZE);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [bulkInstalling, setBulkInstalling] = useState(false);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [syncingCollection, setSyncingCollection] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const cancelInstallRef = useRef(false);
  const cancelRemoveRef = useRef(false);

  const installedSet = useMemo(() => new Set(myGames.map(g => g.appid)), [myGames]);
  const nsfwAppIdSet = useMemo(() => new Set(nsfwDatabase.map(g => g.appid)), [nsfwDatabase]);

  const handleSyncSteamCollection = async () => {
    const toSync = myGames.map(g => g.appid).filter(id => nsfwAppIdSet.has(id));
    if (toSync.length === 0) { setSyncMsg('Nenhum jogo +18 instalado.'); return; }
    setSyncingCollection(true);
    setSyncMsg(null);
    try {
      const r = await window.electron.syncAdultCategories(toSync);
      setSyncMsg(r.success ? `✓ ${toSync.length} jogo(s) adicionados à coleção +18 no Steam` : `Erro: ${r.error}`);
    } catch { setSyncMsg('Erro ao sincronizar'); }
    finally { setSyncingCollection(false); }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nsfwDatabase;
    return nsfwDatabase.filter(g =>
      g.name.toLowerCase().includes(q) || g.appid.includes(q)
    );
  }, [nsfwDatabase, searchQuery]);

  // Reset limit when search changes
  useEffect(() => { setDisplayLimit(NSFW_PAGE_SIZE); }, [searchQuery]);

  const displayed = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);

  // Scroll sentinel
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (displayLimit >= filtered.length) return;
    const sentinel = sentinelRef.current;
    const wrapper = wrapperRef.current;
    if (!sentinel || !wrapper) return;
    let triggered = false;
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered) {
          triggered = true;
          setDisplayLimit(prev => Math.min(prev + NSFW_PAGE_SIZE, filtered.length));
        }
      },
      { root: wrapper, rootMargin: '0px', threshold: 0.1 }
    );
    observerRef.current.observe(sentinel);
    return () => { observerRef.current?.disconnect(); };
  }, [displayLimit, filtered.length]);

  const handleInstallAll = async () => {
    if (!hasNsfwAccess) { onPremiumBlock(); return; }
    const toInstall = nsfwDatabase.filter(g => !installedSet.has(g.appid));
    if (toInstall.length === 0) return;
    cancelInstallRef.current = false;
    setBulkInstalling(true);
    setBulkProgress({ done: 0, total: toInstall.length });
    for (let i = 0; i < toInstall.length; i++) {
      if (cancelInstallRef.current) break;
      const game = toInstall[i];
      setInstallingIds(prev => new Set(prev).add(game.appid));
      try { await onInstall(game.appid, game.name); } catch {}
      setInstallingIds(prev => { const n = new Set(prev); n.delete(game.appid); return n; });
      setBulkProgress({ done: i + 1, total: toInstall.length });
    }
    setBulkInstalling(false);
    setBulkProgress(null);
    cancelInstallRef.current = false;
  };

  const handleRemoveAll = async () => {
    const toRemove = nsfwDatabase.filter(g => installedSet.has(g.appid));
    if (toRemove.length === 0) return;
    cancelRemoveRef.current = false;
    setBulkRemoving(true);
    setBulkProgress({ done: 0, total: toRemove.length });
    for (let i = 0; i < toRemove.length; i++) {
      if (cancelRemoveRef.current) break;
      const game = toRemove[i];
      setRemovingIds(prev => new Set(prev).add(game.appid));
      try { await onRemove(game.appid, game.name); } catch {}
      setRemovingIds(prev => { const n = new Set(prev); n.delete(game.appid); return n; });
      setBulkProgress({ done: i + 1, total: toRemove.length });
    }
    setBulkRemoving(false);
    setBulkProgress(null);
    cancelRemoveRef.current = false;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Warning banner */}
      <div style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.22)', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,45,120,0.12)', border: '1px solid rgba(255,45,120,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '18px', fontWeight: 700, color: '#ff4d8a', fontFamily: 'Syne, sans-serif' }}>18</div>
        <div>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#ff4d8a', marginBottom: '1px' }}>Conteúdo para maiores de 18 anos</p>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>Ao continuar você confirma ter 18 anos ou mais. {nsfwDatabase.length.toLocaleString()} jogos adultos disponíveis.</p>
        </div>
      </div>

      {/* Premium lock banner for non-access users */}
      {!hasNsfwAccess && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: 'var(--neon-dim)', border: '1px solid var(--neon-border)' }}>
          <IconCrown size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1px' }}>Você está no modo visualização</p>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Jogos <strong style={{ color: 'var(--neon-bright)' }}>+18</strong> são bloqueados. Adquira acesso para instalar conteúdo adulto.</p>
          </div>
          <button onClick={onPremiumBlock} style={{ flexShrink: 0, padding: '7px 14px', background: 'linear-gradient(135deg, #7c5cfc, #ff2d78)', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
            Adquirir →
          </button>
        </div>
      )}

      {/* Search + stats + bulk actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div className="my-games-search" style={{ margin: 0, flex: 1 }}>
          <span className="search-icon" style={{ display: 'flex', alignItems: 'center' }}><IconSearch size={12} /></span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar jogos +18..."
          />
        </div>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
          {searchQuery ? `${filtered.length.toLocaleString()} resultado${filtered.length !== 1 ? 's' : ''}` : `${nsfwDatabase.length.toLocaleString()} jogos`}
        </span>

        {/* Instalar Todos */}
        <button
          onClick={handleInstallAll}
          disabled={bulkInstalling || bulkRemoving || isLoading || nsfwDatabase.length === 0}
          style={{
            flexShrink: 0, padding: '7px 12px',
            background: bulkInstalling ? 'rgba(255,45,120,0.08)' : 'linear-gradient(135deg, rgba(255,45,120,0.18), rgba(255,45,120,0.08))',
            border: '1px solid rgba(255,45,120,0.35)', borderRadius: '7px',
            color: (bulkInstalling || bulkRemoving) ? 'rgba(255,77,138,0.4)' : '#ff4d8a',
            fontSize: '11px', fontWeight: 700,
            cursor: (bulkInstalling || bulkRemoving) ? 'not-allowed' : 'pointer',
            fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}
        >
          {bulkInstalling
            ? <><Loader2 className="animate-spin" style={{ width: '10px', height: '10px' }} /> {bulkProgress?.done}/{bulkProgress?.total}</>
            : <><IconDownload size={10} /> Instalar Todos</>}
        </button>

        {/* Parar instalação */}
        {bulkInstalling && (
          <button
            onClick={() => { cancelInstallRef.current = true; }}
            style={{
              flexShrink: 0, padding: '7px 12px',
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: '7px', color: '#f87171', fontSize: '11px', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            Parar
          </button>
        )}

        {/* Remover Todos */}
        <button
          onClick={handleRemoveAll}
          disabled={bulkInstalling || bulkRemoving || isLoading || installedSet.size === 0}
          style={{
            flexShrink: 0, padding: '7px 12px',
            background: bulkRemoving ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.30)', borderRadius: '7px',
            color: (bulkInstalling || bulkRemoving || installedSet.size === 0) ? 'rgba(248,113,113,0.4)' : '#f87171',
            fontSize: '11px', fontWeight: 700,
            cursor: (bulkInstalling || bulkRemoving || installedSet.size === 0) ? 'not-allowed' : 'pointer',
            fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}
        >
          {bulkRemoving
            ? <><Loader2 className="animate-spin" style={{ width: '10px', height: '10px' }} /> {bulkProgress?.done}/{bulkProgress?.total}</>
            : <><IconTrash size={10} /> Remover Todos</>}
        </button>

        {/* Sincronizar coleção +18 no Steam */}
        <button
          onClick={handleSyncSteamCollection}
          disabled={bulkInstalling || bulkRemoving || syncingCollection || installedSet.size === 0}
          title="Adiciona todos os jogos +18 instalados à coleção +18 da biblioteca Steam"
          style={{
            flexShrink: 0, padding: '7px 12px',
            background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.35)',
            borderRadius: '7px', color: syncingCollection ? 'rgba(251,113,133,0.4)' : '#fb7185',
            fontSize: '11px', fontWeight: 700,
            cursor: (bulkInstalling || bulkRemoving || syncingCollection || installedSet.size === 0) ? 'not-allowed' : 'pointer',
            fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}
        >
          {syncingCollection
            ? <><Loader2 className="animate-spin" style={{ width: '10px', height: '10px' }} /> Sincronizando...</>
            : <>🔞 Categ. Steam</>}
        </button>

        {/* Parar remoção */}
        {bulkRemoving && (
          <button
            onClick={() => { cancelRemoveRef.current = true; }}
            style={{
              flexShrink: 0, padding: '7px 12px',
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: '7px', color: '#f87171', fontSize: '11px', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            Parar
          </button>
        )}
      </div>

      {syncMsg && (
        <div style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.25)', color: '#fb7185' }}>
          {syncMsg}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="my-games-grid">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="my-game-skeleton">
              <div className="skel-thumb loading" style={{ aspectRatio: '460/215', background: 'linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
              <div className="skel-body"><div className="skel-line" /><div className="skel-line skel-line-short" /></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.30)' }}>Nenhum jogo encontrado</p>
        </div>
      ) : (
        <div ref={wrapperRef} style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, maxHeight: '70vh' }}>
          <div className="my-games-grid">
            {displayed.map(game => {
              const isInstalled = installedSet.has(game.appid);
              const isInstalling = installingIds.has(game.appid);
              return (
                <div key={game.appid} className="my-game-card">
                  {game.drm && (
                    <div style={{ position: 'absolute', top: '5px', right: '5px', zIndex: 2, background: 'rgba(15,5,10,0.88)', border: '1px solid rgba(255,45,120,0.45)', borderRadius: '4px', padding: '1px 5px', fontSize: '8px', fontWeight: 700, color: '#ff4d8a' }}>DENUVO</div>
                  )}
                  <div className="thumb-wrap">
                    <img
                      src={game.header_image}
                      alt={game.name}
                      loading="lazy"
                      onError={e => { (e.target as HTMLImageElement).src = 'https://ryuu.lol/manifests/placeholder.png'; }}
                    />
                  </div>
                  <div className="game-info">
                    <div className="game-name" title={game.name}>{game.name}</div>
                    <div className="game-appid">ID: {game.appid}</div>
                  </div>
                  <div className="game-actions" style={{ display: 'flex', gap: '5px' }}>
                    {isInstalled ? (
                      <button
                        className="btn-update"
                        disabled={removingIds.has(game.appid)}
                        style={{
                          flex: 1,
                          background: removingIds.has(game.appid) ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.10)',
                          borderColor: 'rgba(239,68,68,0.30)',
                          color: removingIds.has(game.appid) ? 'rgba(248,113,113,0.5)' : '#f87171',
                          cursor: removingIds.has(game.appid) ? 'not-allowed' : 'pointer',
                        }}
                        onClick={async () => {
                          if (removingIds.has(game.appid)) return;
                          setRemovingIds(prev => new Set(prev).add(game.appid));
                          try { await onRemove(game.appid, game.name); }
                          finally { setRemovingIds(prev => { const n = new Set(prev); n.delete(game.appid); return n; }); }
                        }}
                      >
                        {removingIds.has(game.appid) ? (
                          <><Loader2 className="animate-spin" style={{ width: '10px', height: '10px' }} /> Removendo...</>
                        ) : (
                          <><IconTrash size={10} /> Remover</>
                        )}
                      </button>
                    ) : (
                      <button
                        className="btn-update"
                        disabled={isInstalling}
                        onClick={async () => {
                          if (isInstalling) return;
                          if (!hasNsfwAccess) { onPremiumBlock(); return; }
                          setInstallingIds(prev => new Set(prev).add(game.appid));
                          try { await onInstall(game.appid, game.name); }
                          finally { setInstallingIds(prev => { const n = new Set(prev); n.delete(game.appid); return n; }); }
                        }}
                      >
                        {isInstalling ? (
                          <><Loader2 className="animate-spin" style={{ width: '10px', height: '10px' }} /> Instalando...</>
                        ) : !hasNsfwAccess ? (
                          <><IconLock size={10} /> Premium</>
                        ) : (
                          <><IconDownload size={10} /> Instalar</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Sentinel */}
          {displayLimit < filtered.length && (
            <div ref={sentinelRef} style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--neon)', animation: `pulse 1s ${i * 0.2}s ease-in-out infinite alternate` }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ===================== PACOTE PREMIUM — catálogo com instalar individual =====================

const PREMIUM_PAGE_SIZE = 40;

interface PremiumGamesPageProps {
  gamesDatabase: Array<{ appid: string; name: string; header_image: string; drm?: boolean }>;
  isLoading: boolean;
  myGames: Array<{ appid: string; name: string | null; thumb: string | null }>;
  adultAppIds: Set<string>;
  onInstall: (appid: string, name: string) => Promise<void>;
  onRemove: (appid: string) => Promise<void>;
  onRefreshMyGames: () => Promise<void>;
  onInstallBasePack: () => void;
  isInstallingBasePack: boolean;
  basePackMessage: { type: string; text: string } | null;
  steamPath: string | null;
  isBlocked: boolean;
}

const PremiumGamesPage: React.FC<PremiumGamesPageProps> = ({
  gamesDatabase, isLoading, myGames, adultAppIds, onInstall, onRemove, onRefreshMyGames,
  onInstallBasePack, isInstallingBasePack, basePackMessage, steamPath, isBlocked,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'installed' | 'notinstalled'>('all');
  const [displayLimit, setDisplayLimit] = useState(PREMIUM_PAGE_SIZE);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [bulkOp, setBulkOp] = useState<{ type: 'remove' | 'original'; done: number; total: number } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const cancelBulkRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [syncingAdult, setSyncingAdult] = useState(false);
  const [adultMsg, setAdultMsg] = useState<string | null>(null);

  const installedSet = useMemo(() => new Set(myGames.map(g => g.appid)), [myGames]);

  const filtered = useMemo(() => {
    let list = gamesDatabase;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(g => g.name.toLowerCase().includes(q) || g.appid.includes(q));
    }
    if (filter === 'installed') list = list.filter(g => installedSet.has(g.appid));
    if (filter === 'notinstalled') list = list.filter(g => !installedSet.has(g.appid));
    return list;
  }, [gamesDatabase, search, filter, installedSet]);

  const displayed = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);

  useEffect(() => { setDisplayLimit(PREMIUM_PAGE_SIZE); }, [search, filter]);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (!sentinelRef.current || displayLimit >= filtered.length) return;
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setDisplayLimit(prev => Math.min(prev + PREMIUM_PAGE_SIZE, filtered.length));
    }, { threshold: 0.1 });
    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [displayLimit, filtered.length]);

  const handleInstall = async (appid: string, name: string) => {
    setInstallingIds(prev => new Set(prev).add(appid));
    try { await onInstall(appid, name); } finally {
      setInstallingIds(prev => { const s = new Set(prev); s.delete(appid); return s; });
    }
  };

  const handleRemoveSingle = async (appid: string) => {
    setRemovingIds(prev => new Set(prev).add(appid));
    try { await onRemove(appid); } finally {
      setRemovingIds(prev => { const s = new Set(prev); s.delete(appid); return s; });
    }
  };

  const handleRemoveAll = async () => {
    if (!window.confirm(`Remover todos os ${installedSet.size.toLocaleString()} jogos instalados?`)) return;
    cancelBulkRef.current = false;
    setBulkMsg(null);
    const toRemove = [...installedSet];
    setBulkOp({ type: 'remove', done: 0, total: toRemove.length });
    let done = 0;
    for (const appid of toRemove) {
      if (cancelBulkRef.current) break;
      await window.electron.removeGame(appid).catch(() => {});
      done++;
      setBulkOp({ type: 'remove', done, total: toRemove.length });
    }
    await onRefreshMyGames();
    setBulkOp(null);
    setBulkMsg(cancelBulkRef.current ? 'Remoção cancelada.' : `${done.toLocaleString()} jogos removidos.`);
  };

  const handleInstallOriginal = () => {
    setBulkMsg(null);
    onInstallBasePack();
  };

  const handleSyncAdult = async () => {
    setSyncingAdult(true);
    setAdultMsg(null);
    // Passa todos os appids +18 instalados — o renderer já sabe quais são
    const installedNsfwIds = myGames
      .map(g => g.appid)
      .filter(id => adultAppIds.has(id));
    if (installedNsfwIds.length === 0) {
      setAdultMsg('Nenhum jogo +18 instalado encontrado.');
      setSyncingAdult(false);
      return;
    }
    try {
      const r = await window.electron.syncAdultCategories(installedNsfwIds);
      setAdultMsg(r.success
        ? `✓ ${installedNsfwIds.length} jogo(s) adicionados à coleção +18 no Steam`
        : `Erro: ${r.error}`);
    } catch { setAdultMsg('Erro ao categorizar'); }
    finally { setSyncingAdult(false); }
  };

  const bulkPct = bulkOp ? Math.round((bulkOp.done / bulkOp.total) * 100) : 0;
  const isBusy = !!bulkOp || isInstallingBasePack;

  return (
    <div className="h-full flex flex-col" style={{ minHeight: 0 }}>
      {/* Cabeçalho fixo */}
      <div style={{ padding: '0 0 10px 0', flexShrink: 0 }}>
        <div className="flex items-center justify-between mb-2" style={{ gap: '8px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              placeholder="Buscar jogo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 30px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'Syne, sans-serif', outline: 'none' }}
            />
            <svg style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div className="flex" style={{ gap: '4px', flexShrink: 0 }}>
            {(['all', 'notinstalled', 'installed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 9px', fontSize: '11px', fontWeight: 600, borderRadius: '6px', border: '1px solid', cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: filter === f ? 'rgba(124,92,252,0.18)' : 'var(--bg-input)', borderColor: filter === f ? 'rgba(124,92,252,0.5)' : 'var(--border)', color: filter === f ? '#a78bfa' : 'var(--text-secondary)' }}>
                {f === 'all' ? 'Todos' : f === 'installed' ? 'Instalados' : 'Faltando'}
              </button>
            ))}
          </div>
        </div>

        {/* Linha de stats + ações em lote */}
        <div className="flex items-center justify-between" style={{ gap: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
            {isLoading ? 'Carregando...' : <>{filtered.length.toLocaleString()} jogos · {installedSet.size.toLocaleString()} instalados</>}
          </div>
          <div className="flex" style={{ gap: '4px' }}>
            <button
              onClick={handleInstallOriginal}
              disabled={isBusy || isLoading || !steamPath || isBlocked}
              style={{ padding: '4px 9px', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: '1px solid rgba(124,92,252,0.4)', background: 'rgba(124,92,252,0.12)', color: '#a78bfa', cursor: isBusy ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif', opacity: isBusy ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {isInstallingBasePack ? <><Loader2 style={{ width: '9px', height: '9px' }} className="animate-spin" /> Instalando...</> : <>📦 Pack Original (~1k)</>}
            </button>
            <button
              onClick={handleRemoveAll}
              disabled={isBusy || installedSet.size === 0}
              style={{ padding: '4px 9px', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: (isBusy || installedSet.size === 0) ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif', opacity: (isBusy || installedSet.size === 0) ? 0.5 : 1 }}
            >
              🗑 Remover Instalados
            </button>
            <button
              onClick={handleSyncAdult}
              disabled={isBusy || syncingAdult || installedSet.size === 0}
              title="Cria coleção '+18' na biblioteca Steam para todos os jogos adultos instalados"
              style={{ padding: '4px 9px', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: '1px solid rgba(251,113,133,0.4)', background: 'rgba(251,113,133,0.08)', color: '#fb7185', cursor: 'pointer', fontFamily: 'Syne, sans-serif', opacity: (isBusy || syncingAdult || installedSet.size === 0) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {syncingAdult ? <><Loader2 style={{ width: '9px', height: '9px' }} className="animate-spin" /> Sincronizando...</> : <>🔞 Categ. +18</>}
            </button>
            {isBusy && (
              <button
                onClick={() => { cancelBulkRef.current = true; }}
                style={{ padding: '4px 9px', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
              >
                Parar
              </button>
            )}
          </div>
        </div>

        {/* Barra de progresso bulk */}
        {bulkOp && (
          <div style={{ marginTop: '6px' }}>
            <div className="flex justify-between" style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
              <span>{bulkOp.type === 'remove' ? 'Removendo' : 'Instalando original'}: {bulkOp.done.toLocaleString()} / {bulkOp.total.toLocaleString()}</span>
              <span>{bulkPct}%</span>
            </div>
            <div style={{ height: '3px', background: 'var(--bg-input)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${bulkPct}%`, background: bulkOp.type === 'remove' ? '#f87171' : 'var(--accent)', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Mensagem de conclusão / base pack */}
        {(bulkMsg && !bulkOp) && (
          <div style={{ marginTop: '6px', fontSize: '11px', padding: '5px 9px', borderRadius: '5px', background: 'rgba(124,92,252,0.08)', border: '1px solid rgba(124,92,252,0.2)', color: 'var(--text-secondary)' }}>
            {bulkMsg}
          </div>
        )}
        {basePackMessage && (
          <div className={basePackMessage.type === 'success' ? 'alert-warning' : 'alert-danger'} style={{ marginTop: '6px', fontSize: '11px', padding: '5px 9px' }}>
            {basePackMessage.text}
          </div>
        )}
        {adultMsg && (
          <div style={{ marginTop: '6px', fontSize: '11px', padding: '5px 9px', borderRadius: '5px', background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.25)', color: '#fb7185' }}>
            {adultMsg}
          </div>
        )}
      </div>

      {/* Grid de jogos */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading ? (
          <div className="flex items-center justify-center" style={{ height: '200px' }}>
            <Loader2 className="animate-spin" style={{ width: '24px', height: '24px', color: 'var(--accent)' }} />
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', padding: '40px 0' }}>Nenhum jogo encontrado</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', paddingBottom: '8px' }}>
              {displayed.map(game => {
                const installed = installedSet.has(game.appid);
                const installing = installingIds.has(game.appid);
                const removing = removingIds.has(game.appid);
                return (
                  <div key={game.appid} style={{ background: 'var(--bg-card)', border: `1px solid ${installed && adultAppIds.has(game.appid) ? 'rgba(251,113,133,0.3)' : installed ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`, borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ aspectRatio: '460/215', background: 'var(--bg-input)', overflow: 'hidden', position: 'relative' }}>
                      <img src={game.header_image} alt={game.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      {adultAppIds.has(game.appid) && <span style={{ position: 'absolute', top: '4px', right: '4px', fontSize: '9px', fontWeight: 800, color: '#fb7185', background: 'rgba(10,10,15,0.85)', border: '1px solid rgba(251,113,133,0.5)', borderRadius: '3px', padding: '1px 4px', lineHeight: 1.4 }}>+18</span>}
                    </div>
                    <div style={{ padding: '6px 7px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{game.name}</p>
                      <div className="flex" style={{ gap: '3px', marginTop: 'auto' }}>
                        <button
                          onClick={() => !installed && !installing && handleInstall(game.appid, game.name)}
                          disabled={installed || installing || !steamPath || isBlocked}
                          style={{ flex: 1, padding: '4px 0', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: 'none', cursor: installed || installing ? 'default' : 'pointer', fontFamily: 'Syne, sans-serif', background: installed ? 'rgba(34,197,94,0.12)' : installing ? 'rgba(124,92,252,0.12)' : 'rgba(124,92,252,0.20)', color: installed ? '#4ade80' : installing ? '#a78bfa' : '#c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}
                        >
                          {installing ? <><Loader2 style={{ width: '8px', height: '8px' }} className="animate-spin" /></> : installed ? '✓' : '⬇'}
                          <span>{installing ? 'Instalando' : installed ? 'Instalado' : 'Instalar'}</span>
                        </button>
                        {installed && (
                          <button
                            onClick={() => !removing && handleRemoveSingle(game.appid)}
                            disabled={removing}
                            title="Remover"
                            style={{ padding: '4px 6px', fontSize: '10px', borderRadius: '5px', border: 'none', cursor: removing ? 'default' : 'pointer', background: 'rgba(239,68,68,0.10)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {removing ? <Loader2 style={{ width: '8px', height: '8px' }} className="animate-spin" /> : '✕'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={sentinelRef} style={{ height: '1px' }} />
            {displayLimit < filtered.length && (
              <div style={{ textAlign: 'center', padding: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                Mostrando {displayLimit.toLocaleString()} de {filtered.length.toLocaleString()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Rodapé: info sobre primeira vez */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '6px' }}>
        <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: 0 }}>
          Primeira vez? Use <strong>📦 Pack Original (~1k)</strong> para instalar o pacote base com DLLs e ~1000 jogos pré-configurados.
        </p>
      </div>
    </div>
  );
};

export default Launcher;
