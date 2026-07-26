import { contextBridge, ipcRenderer } from 'electron';

// API exposta para o renderer process
const api = {
  // License (via main process — sem CORS/ERR_NAME_NOT_RESOLVED)
  licenseValidate: (licenseKey: string, hwid: string) =>
    ipcRenderer.invoke('license-validate', { licenseKey, hwid }),
  licenseCheckStatus: (licenseKey: string, hwid: string) =>
    ipcRenderer.invoke('license-check-status', { licenseKey, hwid }),
  licenseGetInfo: (licenseKey: string) =>
    ipcRenderer.invoke('license-get-info', { licenseKey }),

  // Hot-reload: começa a observar mudanças na licença (realtime + polling fallback)
  licenseWatch: (licenseKey: string) => ipcRenderer.invoke('license-watch', licenseKey),
  licenseUnwatch: () => ipcRenderer.invoke('license-unwatch'),
  onLicenseChanged: (callback: (license: any) => void) => {
    ipcRenderer.on('license-changed', (_e, license) => callback(license));
  },
  offLicenseChanged: () => {
    ipcRenderer.removeAllListeners('license-changed');
  },

  // Denuvo Removal (compat)
  denuvoListGames: () => ipcRenderer.invoke('denuvo-list-games'),
  denuvoCreateOrder: (payload: {
    licenseKey: string;
    licenseName?: string;
    gameId: string;
    gameName: string;
    couponCode?: string;
  }) => ipcRenderer.invoke('denuvo-create-order', payload),
  denuvoCheckStatus: (txid: string) => ipcRenderer.invoke('denuvo-check-status', txid),
  denuvoListMyOrders: (licenseKey: string) =>
    ipcRenderer.invoke('denuvo-list-my-orders', licenseKey),

  // PIX Universal (recomendado - bypass/premium/etc)
  pixCreateOrder: (payload: {
    licenseKey: string;
    licenseName?: string;
    productType: string;
    productRef?: string;
    couponCode?: string;
  }) => ipcRenderer.invoke('pix-create-order', payload),
  pixCheckStatus: (txid: string) => ipcRenderer.invoke('pix-check-status', txid),
  pixListMyOrders: (licenseKey: string) => ipcRenderer.invoke('pix-list-my-orders', licenseKey),
  productsList: () => ipcRenderer.invoke('products-list'),

  // Tutoriais & utilidades
  tutorialsList: () => ipcRenderer.invoke('tutorials-list'),
  lookupCep: (cep: string) => ipcRenderer.invoke('lookup-cep', cep),

  // CARD payments (com pass-through de juros + antifraude EFI)
  cardInstallments: (payload: { productType: string; productRef?: string; couponCode?: string; brand: string }) =>
    ipcRenderer.invoke('card-installments', payload),
  cardCreateOrder: (payload: any) => ipcRenderer.invoke('card-create-order', payload),
  cardCheckStatus: (chargeId: number) => ipcRenderer.invoke('card-check-status', chargeId),
  onChargebackDetected: (callback: (data: { orderId: string; licenseKey: string; productType: string; action: string }) => void) => {
    ipcRenderer.on('chargeback-detected', (_e, data) => callback(data));
  },

  // Coupons
  couponValidate: (code: string, productType?: string) =>
    ipcRenderer.invoke('coupon-validate', { code, productType }),

  // Signup (Login → cadastro novo)
  signupCreatePix: (payload: { nome: string; email: string; numero: string; referredBy?: string; couponCode?: string }) =>
    ipcRenderer.invoke('signup-create-pix', payload),
  signupCreateCard: (payload: any) => ipcRenderer.invoke('signup-create-card', payload),
  signupCheckStatus: (txid: string) => ipcRenderer.invoke('signup-check-status', txid),

  // Referrals
  referralGetInfo: (licenseKey: string) => ipcRenderer.invoke('referral-get-info', licenseKey),
  referralList: (friendCode: string) => ipcRenderer.invoke('referral-list', friendCode),
  referralValidateCode: (code: string) => ipcRenderer.invoke('referral-validate-code', code),

  // Profile (completar/editar)
  profileUpdate: (payload: { licenseKey: string; nome?: string; email?: string; numero?: string }) =>
    ipcRenderer.invoke('profile-update', payload),

  // Redemption (R$50 a cada 4 indicações)
  redemptionInfo: (licenseKey: string) => ipcRenderer.invoke('redemption-info', licenseKey),
  redemptionRequest: (payload: { licenseKey: string; pixKey: string; pixKeyType?: string }) =>
    ipcRenderer.invoke('redemption-request', payload),

  // User settings — public IP
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),

  // Bypass — extração (escolhe pasta destino, baixa, extrai)
  bypassPickFolder: () => ipcRenderer.invoke('bypass-pick-folder'),
  bypassExtract: (url: string, destinationFolder: string) =>
    ipcRenderer.invoke('bypass-extract', { url, destinationFolder }),
  onBypassProgress: (callback: (data: { stage: 'downloading' | 'extracting' | 'opening' | 'done'; percent?: number }) => void) => {
    ipcRenderer.on('bypass-progress', (_e, data) => callback(data));
  },

  // HWID
  getHWID: () => ipcRenderer.invoke('get-hwid'),

  // Games Database
  loadGamesDatabase: () => ipcRenderer.invoke('load-games-database'),

  // Ryuu games.json (fonte única de jogos e thumbs)
  fetchRyuuGames: () => ipcRenderer.invoke('fetch-ryuu-games'),

  // Steam API (via main process - sem CORS)
  fetchSteamGameData: (appId: string) => ipcRenderer.invoke('fetch-steam-game-data', appId),

  // Steam
  detectSteamPath: () => ipcRenderer.invoke('detect-steam-path'),
  updateSteam: (steamPath: string, downloadUrl: string) => ipcRenderer.invoke('update-steam', { steamPath, downloadUrl }),
  cleanupSteamFiles: (steamPath: string) => ipcRenderer.invoke('cleanup-steam-files', { steamPath }),
  openSteam: (steamPath: string) => ipcRenderer.invoke('open-steam', { steamPath }),
  closeSteam: () => ipcRenderer.invoke('close-steam'),

  // Listeners para eventos de progresso
  onUpdateProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('update-progress', (_event, progress) => callback(progress));
  },
  onUpdateStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('update-status', (_event, status) => callback(status));
  },

  // Métodos genéricos para listeners
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Controles da janela
  closeApp: () => ipcRenderer.invoke('close-app'),
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  maximizeApp: () => ipcRenderer.invoke('maximize-app'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('resize-window', { width, height }),

  // PowerShell
  runPowerShellCommand: (command: string) => ipcRenderer.invoke('run-powershell-command', { command }),

  // Desabilitar DLL
  disableHidDll: () => ipcRenderer.invoke('disable-hid-dll'),

  // Habilitar DLL
  enableHidDll: () => ipcRenderer.invoke('enable-hid-dll'),

  // Garantir que DLL está ativa
  ensureHidDllActive: () => ipcRenderer.invoke('ensure-hid-dll-active'),

  // Manifestor.cc - Buscar jogos
  searchManifestorGames: (query: string) => ipcRenderer.invoke('search-manifestor-games', query),

  // Manifestor.cc - Baixar arquivo .lua
  downloadManifestorLua: (appId: string, gameName: string, skipRestart?: boolean) => ipcRenderer.invoke('download-manifestor-lua', appId, gameName, skipRestart),

  // Atualizar arquivos de um jogo já instalado
  updateGameFiles: (appId: string) => ipcRenderer.invoke('update-game-files', appId),

  // Instalar DLC: baixa ZIP do jogo base, extrai .lua do base + .manifest da DLC específica
  downloadDlcManifest: (dlcAppId: string, baseGameAppId: string) => ipcRenderer.invoke('download-dlc-manifest', dlcAppId, baseGameAppId),

  // Solicitar inclusão de jogo no banco Ryuu
  requestGameRyuu: (appId: string) => ipcRenderer.invoke('request-game-ryuu', appId),

  // Remover jogo
  removeGame: (appId: string) => ipcRenderer.invoke('remove-game', appId),

  // Listar jogos instalados pelo launcher
  getMyGames: () => ipcRenderer.invoke('get-my-games'),

  // Abrir URL no navegador externo
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

  // Download seguro com dialog
  downloadFile: (url: string, suggestedName: string) =>
    ipcRenderer.invoke('download-file-with-dialog', url, suggestedName),

  // Listener para progresso de download
  onDownloadProgress: (callback: (data: { fileName: string; progress: number }) => void) => {
    ipcRenderer.on('download-progress', (_event, data) => callback(data));
  },

  // Garantir que xinput1_4.dll está presente
  ensureHidDll: () => ipcRenderer.invoke('ensure-hid-dll'),

  // Reiniciar Steam manualmente
  restartSteam: (steamPath: string) => ipcRenderer.invoke('restart-steam', steamPath),

  // Adult categories (+18 Steam collection via sharedconfig.vdf)
  fetchAdultAppIds: () => ipcRenderer.invoke('fetch-adult-appids'),
  syncAdultCategories: (appIds: string[]) => ipcRenderer.invoke('sync-adult-categories', appIds),

  // Full Pack (instalação em lote no main process — 50 paralelos)
  installFullPack: (appIds: string[]) => ipcRenderer.invoke('install-full-pack', appIds),
  cancelFullPack: () => ipcRenderer.invoke('cancel-full-pack'),
  onFullPackProgress: (callback: (data: { done: number; total: number; failed: number; finished?: boolean }) => void) => {
    ipcRenderer.on('full-pack-progress', (_event, data) => callback(data));
  },

  // DepotBox API
  depotboxApiRequest: (endpoint: string, options: any) =>
    ipcRenderer.invoke('depotbox-api-request', endpoint, options),
  depotboxDownloadAndExtract: (downloadUrl: string, appId: string, gameName: string) =>
    ipcRenderer.invoke('depotbox-download-and-extract', downloadUrl, appId, gameName),
  depotboxBatchDownloadAndExtract: (downloadUrl: string, appIds: string[], gameNames: Record<string, string>) =>
    ipcRenderer.invoke('depotbox-batch-download-and-extract', downloadUrl, appIds, gameNames),

  // Listener para progresso de download do DepotBox
  onDepotboxDownloadProgress: (callback: (data: { appId?: string; appIds?: string[]; percent: number; loaded: number; total: number }) => void) => {
    ipcRenderer.on('depotbox-download-progress', (_event, data) => callback(data));
  },

  // ============================================
  // AUTO-UPDATE API
  // ============================================

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdatesManually: () => ipcRenderer.invoke('check-for-updates-manually'),
  openUpdatesFolder: () => ipcRenderer.invoke('open-updates-folder'),

  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on('update-checking', () => callback());
  },
  onUpdateAvailable: (callback: (data: { currentVersion: string; newVersion: string }) => void) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on('update-not-available', () => callback());
  },
  onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => {
    ipcRenderer.on('update-download-progress', (_event, data) => callback(data));
  },
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
    ipcRenderer.on('update-downloaded', (_event, data) => callback(data));
  },
  onUpdateError: (callback: (data: { message: string }) => void) => {
    ipcRenderer.on('update-error', (_event, data) => callback(data));
  },
};

// Expor API no contexto do renderer
contextBridge.exposeInMainWorld('electron', api);

// TypeScript declarations
export type ElectronAPI = typeof api;
