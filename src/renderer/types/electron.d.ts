export interface PixOrderResponse {
  success: boolean;
  error?: string;
  order?: {
    id: string;
    txid: string;
    productType?: string;
    productName?: string;
    amount: number;
    originalAmount: number;
    couponCode: string | null;
    qrCodeText: string;
    qrCodeImage: string;
    expiresAt: string;
  };
}

export interface ElectronAPI {
  // License
  licenseValidate: (licenseKey: string, hwid: string) => Promise<{ success: boolean; message: string; license?: any; isSuspended?: boolean; errorCode?: string }>;
  licenseCheckStatus: (licenseKey: string, hwid: string) => Promise<{ success: boolean; active: boolean; message: string; license?: any }>;
  licenseGetInfo: (licenseKey: string) => Promise<any | null>;
  licenseWatch: (licenseKey: string) => Promise<{ success: boolean }>;
  licenseUnwatch: () => Promise<{ success: boolean }>;
  onLicenseChanged: (callback: (license: any) => void) => void;
  offLicenseChanged: () => void;

  // Denuvo (compat)
  denuvoListGames: () => Promise<{ success: boolean; games?: Array<{ id: string; name: string; game_id: string; price: number; active: boolean }>; error?: string }>;
  denuvoCreateOrder: (payload: {
    licenseKey: string;
    licenseName?: string;
    gameId: string;
    gameName: string;
    couponCode?: string;
  }) => Promise<PixOrderResponse>;
  denuvoCheckStatus: (txid: string) => Promise<{ success: boolean; paid: boolean; status?: string; error?: string }>;
  denuvoListMyOrders: (licenseKey: string) => Promise<{ success: boolean; orders: any[] }>;

  // PIX Universal
  pixCreateOrder: (payload: {
    licenseKey: string;
    licenseName?: string;
    productType: string;
    productRef?: string;
    couponCode?: string;
  }) => Promise<PixOrderResponse>;
  pixCheckStatus: (txid: string) => Promise<{ success: boolean; paid: boolean; status?: string; error?: string }>;
  pixListMyOrders: (licenseKey: string) => Promise<{ success: boolean; orders: any[] }>;
  productsList: () => Promise<{ success: boolean; products: Array<{ id: string; type: string; name: string; description: string | null; price: number; permission_field: string; duration_days: number | null }> }>;

  tutorialsList: () => Promise<{ success: boolean; tutorials: Array<{ id: string; name: string; video_url: string; description: string | null; category: string | null; display_order: number }> }>;
  lookupCep: (cep: string) => Promise<{ success: boolean; cep?: string; street?: string; neighborhood?: string; city?: string; state?: string; error?: string }>;

  // CARD
  cardInstallments: (payload: { productType: string; productRef?: string; couponCode?: string; brand: string }) =>
    Promise<{
      success: boolean;
      baseAmount?: number;
      freeWithCoupon?: boolean;
      options?: Array<{ installments: number; has_interest: boolean; installment_value_cents: number; total_value_cents: number; rate: string }>;
      error?: string;
    }>;
  cardCreateOrder: (payload: {
    licenseKey: string;
    productType: string;
    productRef?: string;
    couponCode?: string;
    installments: number;
    brand: string;
    paymentToken: string;
    customer: { name: string; cpf: string; phone_number: string; email: string; birth?: string };
    billingAddress: { street: string; number: string | number; neighborhood: string; zipcode: string; city: string; state: string };
  }) => Promise<{
    success: boolean;
    free?: boolean;
    error?: string;
    order?: { id?: string; txid: string; chargeId?: number; status: string; total: number; installments?: number };
  }>;
  cardCheckStatus: (chargeId: number) => Promise<{ success: boolean; paid?: boolean; contested?: boolean; status?: string }>;
  onChargebackDetected: (callback: (data: { orderId: string; licenseKey: string; productType: string; action: string }) => void) => void;

  // Coupons
  couponValidate: (code: string, productType?: string) => Promise<{ success: boolean; message: string; discount_type?: 'percent' | 'fixed'; discount_value?: number }>;

  // Signup
  signupCreatePix: (payload: { nome: string; email: string; numero: string; referredBy?: string; couponCode?: string }) => Promise<{
    success: boolean;
    free?: boolean;
    licenseKey?: string;
    friendCode?: string;
    error?: string;
    order?: {
      txid: string;
      amount: number;
      originalAmount: number;
      qrCodeText: string;
      qrCodeImage: string;
      expiresAt: string;
      couponCode: string | null;
    };
  }>;
  signupCheckStatus: (txid: string) => Promise<{ success: boolean; paid: boolean; licenseKey?: string; error?: string }>;
  signupCreateCard: (payload: {
    nome: string; email: string; numero: string;
    referredBy?: string; couponCode?: string;
    installments: number;
    brand: string;
    paymentToken: string;
    cpf: string;
    birth?: string;
    billingAddress: { street: string; number: string | number; neighborhood: string; zipcode: string; city: string; state: string; complement?: string };
  }) => Promise<{ success: boolean; free?: boolean; licenseKey?: string; friendCode?: string; error?: string }>;

  // Referrals
  referralGetInfo: (licenseKey: string) => Promise<{
    success: boolean;
    friendCode?: string;
    referredBy?: string | null;
    referralCount?: number;
    referralBalance?: number;
  }>;
  referralList: (friendCode: string) => Promise<{
    success: boolean;
    list: Array<{ referred_license_key: string; status: string; bonus_amount: number; created_at: string }>;
  }>;
  referralValidateCode: (code: string) => Promise<{ success: boolean; message?: string; referrerName?: string }>;

  // Profile
  profileUpdate: (payload: { licenseKey: string; nome?: string; email?: string; numero?: string }) =>
    Promise<{ success: boolean; updated?: number; error?: string }>;

  // Redemption
  redemptionInfo: (licenseKey: string) => Promise<{
    success: boolean;
    available?: number;
    history?: Array<{ id: string; amount: number; status: string; pix_key: string; created_at: string; paid_at: string | null }>;
  }>;
  redemptionRequest: (payload: { licenseKey: string; pixKey: string; pixKeyType?: string }) =>
    Promise<{ success: boolean; error?: string; redemptionId?: string }>;

  // User settings
  getPublicIp: () => Promise<{ success: boolean; ip: string }>;

  // Bypass extraction
  bypassPickFolder: () => Promise<{ success: boolean; folder?: string; canceled?: boolean; error?: string }>;
  bypassExtract: (url: string, destinationFolder: string) => Promise<{
    success: boolean;
    format?: 'zip' | 'rar' | '7z' | 'torrent' | 'unknown';
    filesExtracted?: number;
    openedExternally?: boolean;
    error?: string;
  }>;
  onBypassProgress: (callback: (data: { stage: 'downloading' | 'extracting' | 'opening' | 'done'; percent?: number }) => void) => void;

  getHWID: () => Promise<{ success: boolean; hwid?: string; error?: string }>;
  loadGamesDatabase: () => Promise<Array<{ appid: number; name: string; header_image: string }>>;
  fetchRyuuGames: () => Promise<{ success: boolean; games?: any[]; error?: string }>;
  fetchSteamGameData: (appId: string) => Promise<{
    success: boolean;
    gameData?: { steam_appid: number; name: string; header_image: string };
    error?: string
  }>;
  detectSteamPath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  updateSteam: (steamPath: string, downloadUrl: string) => Promise<{ success: boolean; error?: string }>;
  cleanupSteamFiles: (steamPath: string) => Promise<{ success: boolean; error?: string }>;
  openSteam: (steamPath: string) => Promise<{ success: boolean; error?: string }>;
  closeSteam: () => Promise<{ success: boolean; error?: string }>;
  onUpdateProgress: (callback: (progress: number) => void) => void;
  onUpdateStatus: (callback: (status: string) => void) => void;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
  closeApp: () => void;
  minimizeApp: () => void;
  maximizeApp: () => void;
  isMaximized: () => Promise<boolean>;
  resizeWindow: (width: number, height: number) => Promise<void>;
  runPowerShellCommand: (command: string) => Promise<{ success: boolean; output?: string; error?: string }>;
  disableHidDll: () => Promise<{ success: boolean; error?: string }>;
  enableHidDll: () => Promise<{ success: boolean; error?: string }>;
  ensureHidDllActive: () => Promise<{ success: boolean; error?: string }>;
  searchManifestorGames: (query: string) => Promise<{ success: boolean; results?: any[]; error?: string }>;
  downloadManifestorLua: (appId: string, gameName: string, skipRestart?: boolean) => Promise<{ success: boolean; filePath?: string; gameName?: string; error?: string }>;
  updateGameFiles: (appId: string) => Promise<{ success: boolean; luaCount?: number; manifestCount?: number; error?: string }>;
  downloadDlcManifest: (dlcAppId: string, baseGameAppId: string) => Promise<{ success: boolean; luaInstalled?: boolean; manifestCount?: number; installedFiles?: string[]; error?: string }>;
  requestGameRyuu: (appId: string) => Promise<{ success: boolean; status?: number; body?: string; alreadyInDb?: boolean; error?: string }>;
  removeGame: (appId: string) => Promise<{ success: boolean; error?: string }>;
  getMyGames: () => Promise<{ success: boolean; games: Array<{ appid: string; name: string | null }>; error?: string }>;
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  downloadFile: (url: string, suggestedName: string) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  onDownloadProgress: (callback: (data: { fileName: string; progress: number }) => void) => void;
  ensureHidDll: () => Promise<{ success: boolean; error?: string }>;
  restartSteam: (steamPath: string) => Promise<{ success: boolean; error?: string }>;

  // Adult categories
  fetchAdultAppIds: () => Promise<{ success: boolean; appIds: string[] }>;
  syncAdultCategories: (appIds: string[]) => Promise<{ success: boolean; tagged?: number; error?: string }>;

  // Full Pack
  installFullPack: (appIds: string[]) => Promise<{ success: boolean; installed?: number; failed?: number; canceled?: boolean; error?: string }>;
  cancelFullPack: () => Promise<{ success: boolean }>;
  onFullPackProgress: (callback: (data: { done: number; total: number; failed: number; finished?: boolean }) => void) => void;

  // DepotBox API
  depotboxApiRequest: (endpoint: string, options: any) => Promise<{ ok: boolean; status: number; statusText: string; data: any }>;
  depotboxDownloadAndExtract: (downloadUrl: string, appId: string, gameName: string) => Promise<{ success: boolean; filesExtracted?: { lua: number; manifest: number }; error?: string }>;
  depotboxBatchDownloadAndExtract: (downloadUrl: string, appIds: string[], gameNames: Record<string, string>) => Promise<{ success: boolean; filesExtracted?: { lua: number; manifest: number }; error?: string }>;
  onDepotboxDownloadProgress: (callback: (data: { appId?: string; appIds?: string[]; percent: number; loaded: number; total: number }) => void) => void;

  // Auto-Update API — só baixa e avisa, nunca instala sozinho
  getAppVersion: () => Promise<{ version: string }>;
  checkForUpdatesManually: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
  openUpdatesFolder: () => Promise<{ success: boolean; message?: string }>;
  onUpdateChecking: (callback: () => void) => void;
  onUpdateAvailable: (callback: (data: { currentVersion: string; newVersion: string }) => void) => void;
  onUpdateNotAvailable: (callback: () => void) => void;
  onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => void;
  onUpdateDownloaded: (callback: (data: { version: string; path: string | null }) => void) => void;
  onUpdateError: (callback: (data: { message: string }) => void) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
