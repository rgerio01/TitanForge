import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';
import { autoUpdater } from 'electron-updater';
import { getHWID } from './hwid';
import { detectSteamPath, detectSteamPathSync, installSteamFiles, disableHidDll, disableHidDllSync, enableHidDll, openSteam, restartSteam, closeSteam } from './steam';
import { downloadFromGoogleDrive } from './download';
import { CacheManager, initCacheManager } from './cache';
import AdmZip = require('adm-zip');
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import { createPixCharge, getChargeStatus, getCardInstallments, createCardCharge, getCardChargeStatus, type CardBrand } from './efi';
import { notifyDenuvoOrder, notifyChargeback } from './discordWebhook';
import { extractBypass } from './bypassExtractor';

// Main process usa service_role pra bypassar RLS — nunca exposto ao renderer.
// Fallback pra anon key apenas se service_key estiver ausente (não deveria acontecer em prod).
// NOTA: este cliente NÃO é mais usado para licença/acesso (ver supabaseLicense abaixo) —
// continua servindo pagamentos, referral, fórum, denuvo etc. no projeto Supabase original.
const supabaseMain = createClient(
  process.env.SUPABASE_URL as string,
  (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY) as string,
  { realtime: { params: { eventsPerSecond: 5 } } }
);

// Cliente dedicado à validação de licença/acesso, no projeto Supabase TitanForge.
// Usa só a publishable/anon key — a tabela `licenses` não tem nenhuma policy de RLS
// liberada, então essa chave NÃO consegue ler/escrever a tabela direto, só chamar as
// funções RPC (validate_license/check_license_status/get_license_info), que rodam com
// SECURITY DEFINER no Postgres. Diferente do supabaseMain, aqui nunca existe service key
// no cliente — elimina o vazamento de chave privilegiada que existia antes.
const supabaseLicense = createClient(
  process.env.TITANFORGE_SUPABASE_URL as string,
  process.env.TITANFORGE_SUPABASE_ANON_KEY as string
);

// ============================================
// LICENSE REALTIME — sem precisar relogar
// O renderer chama 'license-watch' uma vez. Se algo mudar na linha
// dessa licença, mandamos 'license-changed' pro renderer recarregar.
// ============================================
let licenseRealtimeKey: string | null = null;
let licenseRealtimeFallback: NodeJS.Timeout | null = null;
let licenseRealtimeLastSnapshot: string = '';

function snapshotKey(row: any): string {
  if (!row) return '';
  // Campos relevantes para detectar mudança útil
  return [
    row.status, row.bypass, row.premiumaccounts, row.multiplayer, row.nsfw, row.add_games,
    row.expires_at, row.nome, row.email, row.numero,
  ].join('|');
}

async function emitLicenseSnapshot() {
  if (!licenseRealtimeKey || !mainWindow) return;
  try {
    const { data } = await supabaseLicense.rpc('get_license_info', { p_key: licenseRealtimeKey });
    if (!data) return;
    const snap = snapshotKey(data);
    if (snap === licenseRealtimeLastSnapshot) return;
    licenseRealtimeLastSnapshot = snap;
    mainWindow.webContents.send('license-changed', data);
  } catch {}
}

let mainWindow: BrowserWindow | null = null;

// Anti-burla: Variáveis para controle de integridade da DLL
let dllIntegrityTimer: NodeJS.Timeout | null = null;
let originalDllHash: string | null = null;
let dllExpectedActive: boolean = false;

// ============================================
// AUTO-UPDATE CONFIGURATION
// ============================================

function configureAutoUpdater() {
  // Repo privado: usa GH_TOKEN para autenticar; sem token retorna 404
  const ghToken = process.env.GH_TOKEN;
  // @ts-ignore - electron-updater internal property
  autoUpdater.requestHeaders = ghToken
    ? { Authorization: `token ${ghToken}` }
    : {};

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Sem certificado de code signing — desabilita verificação de assinatura
  (autoUpdater as any).verifyUpdateCodeSignature = false;
  (autoUpdater as any).disableWebInstaller = false;

  console.log('🔄 AutoUpdater configurado (repositório público)');

  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Verificando atualizações...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('✅ Atualização disponível:', info.version);
    mainWindow?.webContents.send('update-available', {
      currentVersion: app.getVersion(),
      newVersion: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('ℹ️ Nenhuma atualização disponível');
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`📥 Download: ${progressObj.percent.toFixed(2)}%`);
    mainWindow?.webContents.send('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Atualização baixada:', info.version, '— reinício forçado em 5s');
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
    });
    // Atualização OBRIGATÓRIA: aplica e reinicia automaticamente.
    // O renderer mostra countdown de 5s pro usuário ver o que tá acontecendo.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true); // silent=true, restartAfterInstall=true
      } catch (e) {
        console.error('Falha ao reiniciar pra atualizar:', e);
      }
    }, 5000);
  });

  autoUpdater.on('error', (error) => {
    console.error('❌ Erro no AutoUpdater:', error);
    mainWindow?.webContents.send('update-error', {
      message: error.message,
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 720, // Suporte para resolução HD ready (1280x720)
    frame: false,
    resizable: true,
    backgroundColor: '#0A0A14', // Cor dark/amethyst
    show: false, // Não mostrar até estar pronto
    center: true, // Centralizar na tela
    icon: path.join(__dirname, '../assets/icons/icon.ico'), // Ícone da taskbar
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // Melhor performance
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // Debug: logs de posição e visibilidade
  const bounds = mainWindow.getBounds();
  console.log('📍 Posição da janela:', bounds);
  console.log('👁️ Janela visível?', mainWindow.isVisible());
  console.log('🖥️ Display:', require('electron').screen.getPrimaryDisplay().bounds);

  // SEGURANÇA: Bloquear atalhos de reload (Ctrl+R, F5, Ctrl+Shift+R, Ctrl+F5) em produção
  if (process.env.NODE_ENV === 'production') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      const isReloadKey =
        key === 'f5' ||
        (input.control && key === 'r') ||
        (input.meta && key === 'r');
      if (isReloadKey) {
        event.preventDefault();
      }
    });

    // Bloquear botões "voltar/avançar/refresh" do mouse e teclado de mídia
    mainWindow.on('app-command', (e, cmd) => {
      if (cmd === 'browser-backward' || cmd === 'browser-forward' || cmd === 'browser-refresh') {
        e.preventDefault();
      }
    });
  }

  // SEGURANÇA: Bloquear DevTools em produção (EXCETO Ctrl+Shift+F12 para debug)
  if (process.env.NODE_ENV === 'production') {
    // Desabilitar menu de contexto
    mainWindow.webContents.on('context-menu', (e) => {
      e.preventDefault();
    });

    // Bloquear abertura de DevTools NORMAL
    mainWindow.webContents.on('devtools-opened', () => {
      // Não fechar se foi aberto com Ctrl+Shift+F12 (checado abaixo)
      // mainWindow?.webContents.closeDevTools();
    });

    // PERMITIR Ctrl+Shift+F12 para debug em produção
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12' && input.control && input.shift) {
        mainWindow?.webContents.toggleDevTools();
      }
    });
  } else {
    // Em desenvolvimento, permitir F12 para DevTools
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools();
      }
    });
  }

  // Mostrar janela quando pronto
  mainWindow.once('ready-to-show', () => {
    console.log('✅ Janela pronta, mostrando...');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true); // Trazer para frente
      setTimeout(() => mainWindow?.setAlwaysOnTop(false), 1000); // Remover após 1s
      console.log('✅ Janela mostrada! Visível?', mainWindow.isVisible());
      console.log('✅ Bounds:', mainWindow.getBounds());
    }
  });

  // Fallback: mostrar após 3 segundos se não carregar
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('⚠️ Fallback: forçando exibição da janela...');
      console.log('⚠️ Posição atual:', mainWindow.getBounds());
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => mainWindow?.setAlwaysOnTop(false), 1000);
      console.log('⚠️ Após forçar - Visível?', mainWindow.isVisible());
    } else if (mainWindow) {
      console.log('✅ Janela já está visível (fallback não necessário)');
    }
  }, 3000);

  if (process.env.NODE_ENV === 'development') {
    console.log('Modo desenvolvimento: carregando http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
  } else {
    console.log('Modo produção: carregando arquivo local');
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Log de erros de carregamento
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Falha ao carregar:', errorCode, errorDescription);
  });

  // Variável para controlar se já está fechando
  let isClosing = false;

  mainWindow.on('close', (event) => {
    if (isClosing) return;

    event.preventDefault();

    // Enviar modal de fechamento
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-closing');
    }

    (async () => {
      try {
        console.log('🔒 Desabilitando DLL...');
        const steamPath = await detectSteamPath();

        if (steamPath) {
          // DESABILITAR DLL (rename para .disabled)
          await disableHidDll(steamPath);
        }
      } catch (error) {
        console.error('❌ Erro:', error);
      } finally {
        isClosing = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        mainWindow = null;
      }
    })();
  });
}

app.whenReady().then(async () => {
  // ANTI-BURLA: Limpar DLL ao iniciar
  await startupDllCleanup();

  // ANTI-BURLA: Iniciar monitoramento
  startDllIntegrityMonitoring();

  // Inicializar CacheManager singleton após app estar pronto
  initCacheManager();

  // AUTO-UPDATE: Configure
  configureAutoUpdater();

  createWindow();

  // ANTI-CHARGEBACK: monitora pagamentos por cartão e revoga licença em caso de contestação
  startChargebackPolling();

  // AUTO-UPDATE: Check inicial (3s após boot) + recheck a cada 30 minutos
  const runUpdateCheck = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('❌ Erro ao verificar atualizações:', error);
    });
  };

  setTimeout(() => {
    console.log('🔄 Iniciando verificação de atualizações...');
    console.log('📍 NODE_ENV:', process.env.NODE_ENV);
    console.log('📍 Is packaged:', app.isPackaged);
    runUpdateCheck();
  }, 3000);

  // Recheck periódico a cada 3 minutos — captura update rápido sem precisar reiniciar
  setInterval(runUpdateCheck, 3 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// CRÍTICO: Desabilitar DLL de forma SÍNCRONA ao fechar
let dllAlreadyDisabled = false;

function disableDllEmergency() {
  if (dllAlreadyDisabled) return;

  console.log('🚨 EMERGÊNCIA: Desabilitando DLL...');
  try {
    const steamPath = detectSteamPathSync();
    if (steamPath) {
      // Versão SÍNCRONA - executar IMEDIATAMENTE
      disableHidDllSync(steamPath);
      dllAlreadyDisabled = true;
      console.log('✅ DLL desabilitada (emergência)');
    }
  } catch (error) {
    console.error('❌ Erro ao desabilitar DLL (emergência):', error);
  }
}

// ============================================
// ANTI-BURLA: Sistema de proteção da xinput1_4.dll
// ============================================

/**
 * Calcula hash MD5 de um arquivo para verificar integridade
 */
function calculateFileHash(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    console.error('❌ Erro ao calcular hash:', error);
    return null;
  }
}

/**
 * Monitora integridade da DLL a cada 30 segundos
 * Previne que usuário copie DLL manualmente sem o launcher
 */
function startDllIntegrityMonitoring() {
  // Limpar timer anterior se existir
  if (dllIntegrityTimer) {
    clearInterval(dllIntegrityTimer);
  }

  console.log('🛡️ Iniciando monitoramento de integridade da DLL...');

  dllIntegrityTimer = setInterval(async () => {
    try {
      const steamPath = await detectSteamPath();
      if (!steamPath) return;

      const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
      const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

      // Se DLL não deveria estar ativa mas está presente
      if (!dllExpectedActive && fs.existsSync(hidDllPath)) {
        console.log('⚠️ ATENÇÃO: DLL detectada sem autorização! Desabilitando...');

        // Desabilitar imediatamente
        if (fs.existsSync(hidDllPath)) {
          fs.renameSync(hidDllPath, hidDllDisabled);
          console.log('✅ DLL não autorizada foi desabilitada');
        }
      }

      // Se DLL deveria estar ativa, verificar integridade
      if (dllExpectedActive && fs.existsSync(hidDllPath)) {
        const currentHash = calculateFileHash(hidDllPath);

        // Na primeira verificação, salvar hash original
        if (!originalDllHash && currentHash) {
          originalDllHash = currentHash;
          console.log('🔒 Hash original da DLL registrado');
        }

        // Verificar se DLL foi modificada
        if (originalDllHash && currentHash && currentHash !== originalDllHash) {
          console.log('⚠️ ATENÇÃO: DLL foi modificada! Restaurando versão original...');

          // Remover DLL adulterada
          fs.unlinkSync(hidDllPath);

          // Copiar versão original de assets
          const isDev = process.env.NODE_ENV === 'development';
          let assetsPath: string;
          
          if (isDev) {
            assetsPath = path.join(process.cwd(), 'assets');
          } else {
            // Tentar asarUnpack primeiro
            const asarUnpackAssets = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');
            if (fs.existsSync(asarUnpackAssets)) {
              assetsPath = asarUnpackAssets;
            } else {
              assetsPath = path.join(process.resourcesPath, 'assets');
            }
          }

          const hidDllSource = path.join(assetsPath, 'xinput1_4.dll');

          if (fs.existsSync(hidDllSource)) {
            fs.copyFileSync(hidDllSource, hidDllPath);
            originalDllHash = calculateFileHash(hidDllPath);
            console.log('✅ DLL original restaurada');
          }
        }
      }
    } catch (error) {
      console.error('❌ Erro no monitoramento de integridade:', error);
    }
  }, 30000); // Verificar a cada 30 segundos
}

/**
 * Para monitoramento e desabilita DLL
 */
function stopDllIntegrityMonitoring() {
  if (dllIntegrityTimer) {
    clearInterval(dllIntegrityTimer);
    dllIntegrityTimer = null;
    console.log('🛡️ Monitoramento de integridade parado');
  }

  dllExpectedActive = false;
  originalDllHash = null;
}

/**
 * Cleanup ao iniciar: desabilita qualquer DLL existente
 * Previne que DLL fique ativa após reinstalação do launcher
 */
async function startupDllCleanup() {
  try {
    console.log('🧹 Iniciando limpeza de DLL ao iniciar...');
    const steamPath = await detectSteamPath();

    if (steamPath) {
      const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
      const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

      // Se DLL existe, desabilitar
      if (fs.existsSync(hidDllPath)) {
        fs.renameSync(hidDllPath, hidDllDisabled);
        console.log('✅ DLL existente desabilitada no startup');
      }
    }
  } catch (error) {
    console.error('❌ Erro no cleanup de startup:', error);
  }
}

app.on('window-all-closed', () => {
  // Parar monitoramento
  stopDllIntegrityMonitoring();
  stopChargebackPolling();
  // Desabilitar DLL ANTES de fechar
  disableDllEmergency();

  // Fechar imediatamente no Windows/Linux
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// CRÍTICO: Handler para quando app fecha (Task Manager, Ctrl+C, etc)
app.on('before-quit', () => {
  console.log('🚨 before-quit - Desabilitando DLL...');
  stopDllIntegrityMonitoring();
  disableDllEmergency();
});

// CRÍTICO: Handler adicional para will-quit
app.on('will-quit', () => {
  console.log('🚨 will-quit - Desabilitando DLL...');
  stopDllIntegrityMonitoring();
  disableDllEmergency();
});

// CRÍTICO: Handler para sinais de processo (Windows)
process.on('SIGINT', () => {
  console.log('🚨 SIGINT - Desabilitando DLL...');
  stopDllIntegrityMonitoring();
  disableDllEmergency();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🚨 SIGTERM - Desabilitando DLL...');
  stopDllIntegrityMonitoring();
  disableDllEmergency();
  process.exit(0);
});

// Handler para requisições à API do DepotBox (evita CORS)
// ============================================
// LICENSE IPC HANDLERS (main process → Supabase via Node.js, sem CORS)
// ============================================

// Licença/acesso validado no Supabase TitanForge, via RPC (SECURITY DEFINER) — o
// processo main nunca lê/escreve a tabela `licenses` direto, só chama as funções.
// Toda a lógica (status, expiração, vínculo de HWID, ativação) mora na RPC agora.
ipcMain.handle('license-validate', async (_, { licenseKey, hwid }: { licenseKey: string; hwid: string }) => {
  try {
    const normalizedKey = licenseKey.trim().toUpperCase();

    const { data, error } = await supabaseLicense.rpc('validate_license', {
      p_key: normalizedKey,
      p_hwid: hwid,
    });

    if (error) {
      console.error('Erro ao validar licença:', error);
      return { success: false, message: 'Não foi possível validar sua licença' };
    }

    return data;
  } catch (error: any) {
    console.error('Erro ao validar licença:', error);
    return { success: false, message: 'Não foi possível validar sua licença' };
  }
});

ipcMain.handle('license-check-status', async (_, { licenseKey, hwid }: { licenseKey: string; hwid: string }) => {
  try {
    const normalizedKey = licenseKey.trim().toUpperCase();

    const { data, error } = await supabaseLicense.rpc('check_license_status', {
      p_key: normalizedKey,
      p_hwid: hwid,
    });

    if (error) {
      console.error('Erro ao verificar licença:', error);
      return { success: false, active: false, message: 'Não foi possível verificar sua licença' };
    }

    return data;
  } catch (error: any) {
    console.error('Erro ao verificar licença:', error);
    return { success: false, active: false, message: 'Não foi possível verificar sua licença' };
  }
});

ipcMain.handle('license-get-info', async (_, { licenseKey }: { licenseKey: string }) => {
  try {
    const normalizedKey = licenseKey.trim().toUpperCase();
    const { data, error } = await supabaseLicense.rpc('get_license_info', { p_key: normalizedKey });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
});

// Watch de licença via polling (15s). O projeto TitanForge não expõe a tabela `licenses`
// a nenhuma policy de RLS (nem SELECT), de propósito — então Realtime (postgres_changes)
// não é uma opção aqui (ele respeita RLS e não veria nenhuma mudança). Trocamos o antigo
// Realtime + fallback pelo polling puro via RPC get_license_info, que é o mesmo caminho
// seguro usado pra tudo mais de licença.
ipcMain.handle('license-watch', async (_, licenseKey: string) => {
  const key = (licenseKey || '').trim().toUpperCase();
  if (!key) return { success: false };

  if (licenseRealtimeFallback) {
    clearInterval(licenseRealtimeFallback);
    licenseRealtimeFallback = null;
  }

  licenseRealtimeKey = key;
  licenseRealtimeLastSnapshot = '';

  licenseRealtimeFallback = setInterval(emitLicenseSnapshot, 15000);
  // Snapshot inicial pra estabelecer o baseline
  emitLicenseSnapshot();

  return { success: true };
});

ipcMain.handle('license-unwatch', async () => {
  licenseRealtimeKey = null;
  if (licenseRealtimeFallback) {
    clearInterval(licenseRealtimeFallback);
    licenseRealtimeFallback = null;
  }
  return { success: true };
});

// ============================================
// DENUVO REMOVAL — listar jogos, criar order, polling, cupons
// ============================================

ipcMain.handle('denuvo-list-games', async () => {
  try {
    const { data, error } = await supabaseMain
      .from('denuvo_games')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    return { success: true, games: data || [] };
  } catch (e: any) {
    console.error('denuvo-list-games:', e);
    return { success: false, error: 'Não foi possível carregar os jogos' };
  }
});

// ----- Validação de cupom (genérico, com escopo de produto) -----
ipcMain.handle('coupon-validate', async (_, payload: { code: string; productType?: string }) => {
  try {
    const code = (typeof payload === 'string' ? payload : payload?.code || '').trim();
    const productType = typeof payload === 'object' ? payload?.productType : undefined;
    if (!code) return { success: false, message: 'Cupom vazio' };

    const { data, error } = await supabaseMain.rpc('validate_coupon', {
      p_code: code,
      p_product_type: productType || null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { success: false, message: 'Cupom inválido' };

    return {
      success: row.ok === true,
      message: row.msg || 'OK',
      discount_type: row.d_type || undefined,
      discount_value: row.d_value != null ? Number(row.d_value) : undefined,
    };
  } catch (e: any) {
    console.error('coupon-validate:', e);
    return { success: false, message: 'Não foi possível validar o cupom' };
  }
});

// ----- Helpers de pricing/fulfillment (usados pelo PIX universal) -----
async function fetchProductByType(type: string) {
  const { data, error } = await supabaseMain
    .from('products')
    .select('*')
    .eq('type', type)
    .eq('active', true)
    .single();
  if (error || !data) return null;
  return data;
}

async function fetchDenuvoGameById(gameId: string) {
  const { data, error } = await supabaseMain
    .from('denuvo_games')
    .select('*')
    .eq('game_id', gameId)
    .eq('active', true)
    .single();
  if (error || !data) return null;
  return data;
}


// ----- PIX UNIVERSAL: cria pedido para qualquer produto -----
// IMPORTANTE: o cliente NÃO envia preço. Servidor sempre busca de products / denuvo_games.
ipcMain.handle('pix-create-order', async (_, payload: {
  licenseKey: string;
  licenseName?: string;
  productType: string;     // 'denuvo' | 'bypass' | 'premiumaccounts' | 'multiplayer' | 'nsfw' | 'add_games'
  productRef?: string;     // p/ denuvo: gameId
  couponCode?: string;
}) => {
  try {
    if (!payload?.licenseKey || !payload?.productType) {
      return { success: false, error: 'Dados incompletos' };
    }
    return await createPixOrderInternal(payload);
  } catch (e: any) {
    console.error('pix-create-order:', e?.response?.data || e?.message || e);
    return { success: false, error: 'Não foi possível processar sua compra' };
  }
});

// Polling: atualiza status, e se PAGO, libera permissão automaticamente
ipcMain.handle('pix-check-status', async (_, txid: string) => {
  try {
    const status = await getChargeStatus(txid);

    if (status.paid) {
      const { data: order } = await supabaseMain
        .from('pix_orders')
        .select('*')
        .eq('txid', txid)
        .single();

      if (order && order.status === 'pending') {
        await supabaseMain
          .from('pix_orders')
          .update({ status: 'paid', paid_at: status.paidAt || new Date().toISOString() })
          .eq('txid', txid);

        // FULFILLMENT: libera permissão / processa denuvo
        if (order.product_type !== 'denuvo') {
          const product = await fetchProductByType(order.product_type);
          if (product?.permission_field) {
            const { error: grantErr } = await supabaseMain.rpc('grant_license_permission', {
              p_license_key: order.license_key,
              p_permission_field: product.permission_field,
              p_duration_days: product.duration_days,
            });
            if (!grantErr) {
              await supabaseMain
                .from('pix_orders')
                .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
                .eq('txid', txid);
            }
          }
        }

        notifyDenuvoOrder({
          status: 'paid',
          licenseKey: order.license_key,
          gameName: order.product_name,
          gameId: order.product_ref || order.product_type,
          amount: Number(order.amount),
          originalAmount: Number(order.original_amount),
          couponCode: order.coupon_code,
          txid: order.txid,
        }).catch(() => {});
      }
    }

    return { success: true, paid: status.paid, status: status.status };
  } catch (e: any) {
    console.error('pix-check-status:', e?.response?.data || e?.message || e);
    return { success: false, paid: false, error: 'Falha ao consultar pagamento' };
  }
});

// ----- Listar pedidos do usuário -----
ipcMain.handle('pix-list-my-orders', async (_, licenseKey: string) => {
  try {
    const { data, error } = await supabaseMain
      .from('pix_orders')
      .select('*')
      .eq('license_key', licenseKey)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return { success: true, orders: data || [] };
  } catch (e: any) {
    console.error('pix-list-my-orders:', e);
    return { success: false, orders: [] };
  }
});

// ============================================
// CARD PAYMENTS (com pass-through de juros + antifraude EFI)
// ============================================

// Lista parcelas com valores dinâmicos para uma bandeira (cliente cobre o juros)
ipcMain.handle('card-installments', async (_, payload: { productType: string; productRef?: string; couponCode?: string; brand: string }) => {
  try {
    if (!payload?.productType || !payload?.brand) return { success: false, error: 'Dados incompletos' };

    // Calcula o preço final no servidor (mesma regra do PIX)
    let baseAmount = 0;
    if (payload.productType === 'denuvo') {
      if (!payload.productRef) return { success: false, error: 'Jogo não informado' };
      const g = await fetchDenuvoGameById(payload.productRef);
      if (!g) return { success: false, error: 'Jogo indisponível' };
      baseAmount = Number(g.price);
    } else {
      const p = await fetchProductByType(payload.productType);
      if (!p) return { success: false, error: 'Produto indisponível' };
      baseAmount = Number(p.price);
    }

    // Aplica cupom (sem debitar — só preview)
    if (payload.couponCode && payload.couponCode.trim()) {
      const { data, error } = await supabaseMain.rpc('validate_coupon', {
        p_code: payload.couponCode.trim(),
        p_product_type: payload.productType,
      });
      if (!error) {
        const r: any = Array.isArray(data) ? data[0] : data;
        if (r?.ok) {
          const dValue = Number(r.d_value);
          baseAmount = r.d_type === 'percent'
            ? Math.max(0.01, baseAmount * (1 - dValue / 100))
            : Math.max(0.01, baseAmount - dValue);
          baseAmount = +baseAmount.toFixed(2);
        }
      }
    }

    const amountCents = Math.round(baseAmount * 100);
    if (amountCents <= 0) {
      return { success: true, baseAmount, options: [], freeWithCoupon: true };
    }

    const brandLower = payload.brand.toLowerCase() as CardBrand;
    const options = await getCardInstallments(amountCents, brandLower);
    return {
      success: true,
      baseAmount,
      options: options.map(o => ({
        installments: o.installments,
        has_interest: o.has_interest,
        installment_value_cents: o.installment_value,
        total_value_cents: o.total_value,
        rate: o.rate,
      })),
    };
  } catch (e: any) {
    console.error('card-installments:', e?.response?.data || e?.message || e);
    return { success: false, error: 'Não foi possível calcular as parcelas' };
  }
});

// Cria cobrança de cartão. Cliente NÃO informa preço (servidor recalcula).
// Cobra os juros para o cliente: total = options.total_value_cents da parcela escolhida.
ipcMain.handle('card-create-order', async (_, payload: {
  licenseKey: string;
  productType: string;
  productRef?: string;
  couponCode?: string;
  installments: number;
  brand: string;
  paymentToken: string;
  customer: {
    name: string; cpf: string; phone_number: string; email: string; birth?: string;
  };
  billingAddress: {
    street: string; number: string | number; neighborhood: string; zipcode: string; city: string; state: string;
  };
}) => {
  try {
    if (!payload?.licenseKey) return { success: false, error: 'Licença ausente' };
    if (!payload?.paymentToken) return { success: false, error: 'Token do cartão ausente' };
    if (!payload?.installments || payload.installments < 1 || payload.installments > 12) {
      return { success: false, error: 'Parcelamento inválido' };
    }

    // 1. Recalcula preço no servidor (sempre fonte da verdade)
    let originalAmount = 0;
    let productName = '';
    let productRef: string | null = null;

    if (payload.productType === 'denuvo') {
      if (!payload.productRef) return { success: false, error: 'Jogo não informado' };
      const g = await fetchDenuvoGameById(payload.productRef);
      if (!g) return { success: false, error: 'Jogo indisponível' };
      originalAmount = Number(g.price);
      productName = `Remoção Denuvo: ${g.name}`;
      productRef = String(g.game_id);
    } else {
      const p = await fetchProductByType(payload.productType);
      if (!p) return { success: false, error: 'Produto indisponível' };
      originalAmount = Number(p.price);
      productName = p.name;
    }

    // 2. Aplica cupom (debita uso atomicamente)
    let amount = originalAmount;
    let appliedCoupon: string | null = null;

    if (payload.couponCode && payload.couponCode.trim()) {
      const { data, error } = await supabaseMain.rpc('redeem_coupon', {
        p_code: payload.couponCode.trim(),
        p_product_type: payload.productType,
      });
      if (error) throw error;
      const r: any = Array.isArray(data) ? data[0] : data;
      if (!r?.ok) return { success: false, error: r?.msg || 'Cupom inválido' };
      const dValue = Number(r.d_value);
      const raw = r.d_type === 'percent'
        ? originalAmount * (1 - dValue / 100)
        : originalAmount - dValue;
      if (raw <= 0) {
        // 100% off — não cobra cartão, libera direto
        // Cria order paid + auto fulfill
        const fakeId = 'CARDFREE-' + crypto.randomBytes(8).toString('hex');
        const { data: ord } = await supabaseMain
          .from('pix_orders')
          .insert({
            license_key: payload.licenseKey,
            product_type: payload.productType,
            product_ref: productRef,
            product_name: productName,
            amount: 0,
            original_amount: originalAmount,
            coupon_code: payload.couponCode.trim().toUpperCase(),
            txid: fakeId,
            status: 'paid',
            paid_at: new Date().toISOString(),
            payment_method: 'card',
          })
          .select()
          .single();

        if (ord && payload.productType !== 'denuvo') {
          const fulfilled = await fulfillProductPermission(payload.productType, payload.licenseKey);
          if (fulfilled) {
            await supabaseMain.from('pix_orders')
              .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
              .eq('id', ord.id);
          }
        }
        return { success: true, free: true, order: { txid: fakeId, status: 'paid', total: 0 } };
      }
      amount = Math.max(0.01, +raw.toFixed(2));
      appliedCoupon = payload.couponCode.trim().toUpperCase();
    }

    const amountCents = Math.round(amount * 100);

    // 3. Cria cobrança real na EFI (one-step)
    const charge = await createCardCharge({
      amountCents,
      installments: payload.installments,
      paymentToken: payload.paymentToken,
      customer: {
        name: payload.customer.name.slice(0, 80),
        cpf: payload.customer.cpf.replace(/\D/g, ''),
        phone_number: payload.customer.phone_number.replace(/\D/g, ''),
        email: payload.customer.email.toLowerCase().slice(0, 120),
        ...(payload.customer.birth ? { birth: payload.customer.birth } : {}),
      },
      billingAddress: {
        street: String(payload.billingAddress.street).slice(0, 80),
        number: payload.billingAddress.number,
        neighborhood: String(payload.billingAddress.neighborhood).slice(0, 80),
        zipcode: String(payload.billingAddress.zipcode).replace(/\D/g, ''),
        city: String(payload.billingAddress.city).slice(0, 80),
        state: String(payload.billingAddress.state).slice(0, 2).toUpperCase(),
        ...((payload.billingAddress as any).complement
          ? { complement: String((payload.billingAddress as any).complement).slice(0, 80) }
          : {}),
      } as any,
      description: productName,
    });

    // 4. Persiste pedido
    const totalReais = +(charge.totalCents / 100).toFixed(2);
    const { data: order, error: insErr } = await supabaseMain
      .from('pix_orders')
      .insert({
        license_key: payload.licenseKey,
        product_type: payload.productType,
        product_ref: productRef,
        product_name: productName,
        amount,
        original_amount: originalAmount,
        coupon_code: appliedCoupon,
        txid: 'CARD-' + charge.chargeId,
        status: charge.status === 'paid' || charge.status === 'approved' ? 'paid' : 'pending',
        payment_method: 'card',
        card_brand: payload.brand,
        card_installments: charge.installments,
        card_charge_id: charge.chargeId,
        card_total_amount: totalReais,
        paid_at: charge.status === 'paid' || charge.status === 'approved' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (insErr) {
      console.error('card-create-order insert:', insErr);
      return { success: false, error: 'Cobrança criada na EFI mas falhou ao salvar' };
    }

    // 5. Se já está aprovada → libera permissão imediatamente
    if (order && (charge.status === 'paid' || charge.status === 'approved')) {
      if (payload.productType !== 'denuvo') {
        const fulfilled = await fulfillProductPermission(payload.productType, payload.licenseKey);
        if (fulfilled) {
          await supabaseMain.from('pix_orders')
            .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
            .eq('id', order.id);
        }
      }
    }

    notifyDenuvoOrder({
      status: (charge.status === 'paid' || charge.status === 'approved') ? 'paid' : 'created',
      licenseKey: payload.licenseKey,
      licenseName: payload.customer.name,
      gameName: `💳 ${productName} (${payload.installments}x)`,
      gameId: productRef || payload.productType,
      amount: totalReais,
      originalAmount,
      couponCode: appliedCoupon,
      txid: 'CARD-' + charge.chargeId,
    }).catch(() => {});

    return {
      success: true,
      free: false,
      order: {
        id: order?.id,
        txid: 'CARD-' + charge.chargeId,
        chargeId: charge.chargeId,
        status: charge.status,
        total: totalReais,
        installments: charge.installments,
        installmentValueCents: charge.installmentValueCents,
      },
    };
  } catch (e: any) {
    console.error('card-create-order:', e?.response?.data || e?.message || e);
    const efiErr = e?.response?.data?.error_description || e?.response?.data?.message;
    return {
      success: false,
      error: efiErr || 'Pagamento recusado. Verifique os dados do cartão.',
    };
  }
});

// Status atual de cobrança de cartão
ipcMain.handle('card-check-status', async (_, chargeId: number) => {
  try {
    const status = await getCardChargeStatus(Number(chargeId));
    return { success: true, paid: status.paid, contested: status.contested, status: status.status };
  } catch (e: any) {
    console.error('card-check-status:', e?.message || e);
    return { success: false };
  }
});

// ============================================
// CHARGEBACK POLLING — verifica todos os pagamentos por cartão e revoga em caso de chargeback
// ============================================

async function pollChargebacks() {
  try {
    // Pega cobranças de cartão dos últimos 200 dias com status 'paid' ou 'fulfilled' (que ainda podem virar chargeback)
    const { data: orders, error } = await supabaseMain
      .from('pix_orders')
      .select('id, card_charge_id, license_key, product_name, product_type, amount, card_total_amount')
      .eq('payment_method', 'card')
      .in('status', ['paid', 'fulfilled', 'pending'])
      .not('card_charge_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString())
      .limit(200);
    if (error) { console.error('pollChargebacks query:', error); return; }
    if (!orders || orders.length === 0) return;

    for (const order of orders) {
      try {
        const status = await getCardChargeStatus(Number(order.card_charge_id));

        // Se está em contestação ou foi revertido → REVOGA NA HORA
        if (status.contested || status.refunded || ['contested', 'unpaid', 'canceled', 'refunded'].includes(status.status)) {
          const { data: rData, error: rErr } = await supabaseMain.rpc('revoke_license_on_chargeback', {
            p_order_id: order.id,
            p_efi_status: status.status,
            p_reason: status.refunded ? 'refunded' : 'contested',
          });
          if (rErr) { console.error('revoke RPC:', rErr); continue; }

          const action = (Array.isArray(rData) ? rData[0]?.action : rData?.action) || 'order_marked';

          // Notifica Discord
          await notifyChargeback({
            licenseKey: order.license_key,
            productName: order.product_name,
            productType: order.product_type,
            amount: Number(order.card_total_amount || order.amount),
            efiStatus: status.status,
            reason: status.refunded ? 'Cobrança estornada' : 'Cobrança contestada (chargeback)',
            action,
            permissionRevoked: action === 'permission_revoked' ? null : null,
          });

          // Marca como notificada
          await supabaseMain
            .from('chargeback_events')
            .update({ discord_notified: true })
            .eq('order_id', order.id);

          // Avisa o renderer (se a janela estiver aberta) para refletir na hora
          mainWindow?.webContents.send('chargeback-detected', {
            orderId: order.id,
            licenseKey: order.license_key,
            productType: order.product_type,
            action,
          });
        }

        // Pequeno delay entre requests pra não estourar rate limit
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        console.error('pollChargebacks iter:', e);
      }
    }
  } catch (e: any) {
    console.error('pollChargebacks:', e);
  }
}

// Roda a cada 30 minutos enquanto o app estiver aberto
let chargebackPollTimer: NodeJS.Timeout | null = null;
function startChargebackPolling() {
  if (chargebackPollTimer) return;
  // Primeira verificação 30s após o app abrir
  setTimeout(() => pollChargebacks(), 30000);
  chargebackPollTimer = setInterval(pollChargebacks, 30 * 60 * 1000);
}
function stopChargebackPolling() {
  if (chargebackPollTimer) { clearInterval(chargebackPollTimer); chargebackPollTimer = null; }
}

// ----- Listar produtos premium ativos -----
// ============================================
// TUTORIAIS
// ============================================
ipcMain.handle('tutorials-list', async () => {
  try {
    const { data, error } = await supabaseMain
      .from('tutorials')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return { success: true, tutorials: data || [] };
  } catch (e: any) {
    console.error('tutorials-list:', e);
    return { success: false, tutorials: [] };
  }
});

// ============================================
// CEP (ViaCEP) — proxy via main process p/ não ter CORS
// ============================================
ipcMain.handle('lookup-cep', async (_, cep: string) => {
  try {
    const cleaned = (cep || '').replace(/\D/g, '');
    if (cleaned.length !== 8) return { success: false, error: 'CEP inválido' };
    const r = await axios.get(`https://viacep.com.br/ws/${cleaned}/json/`, { timeout: 8000 });
    if (!r.data || r.data.erro) return { success: false, error: 'CEP não encontrado' };
    return {
      success: true,
      cep: r.data.cep,
      street: r.data.logradouro || '',
      neighborhood: r.data.bairro || '',
      city: r.data.localidade || '',
      state: r.data.uf || '',
    };
  } catch {
    return { success: false, error: 'Falha ao consultar CEP' };
  }
});

ipcMain.handle('products-list', async () => {
  try {
    const { data, error } = await supabaseMain
      .from('products')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    return { success: true, products: data || [] };
  } catch (e: any) {
    console.error('products-list:', e);
    return { success: false, products: [] };
  }
});

// ============================================
// SIGNUP — cria licença automaticamente após pagar PIX
// ============================================

ipcMain.handle('signup-create-pix', async (_, payload: {
  nome: string; email: string; numero: string; referredBy?: string; couponCode?: string;
}) => {
  try {
    if (!payload.nome || !payload.email || !payload.numero) {
      return { success: false, error: 'Preencha nome, e-mail e telefone' };
    }
    // Sanitização leve
    const nome = payload.nome.trim().slice(0, 120);
    const email = payload.email.trim().toLowerCase().slice(0, 120);
    const numero = payload.numero.trim().slice(0, 30);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      return { success: false, error: 'E-mail inválido' };
    }

    // Busca o produto "licenca_login" / "licenca_vitalicia"
    const product = await fetchProductByType('licenca_vitalicia');
    if (!product) return { success: false, error: 'Plano indisponível' };

    let amount = Number(product.price);
    let appliedCoupon: string | null = null;

    if (payload.couponCode && payload.couponCode.trim()) {
      const { data, error } = await supabaseMain.rpc('redeem_coupon', {
        p_code: payload.couponCode.trim(),
        p_product_type: 'licenca_vitalicia',
      });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      if (!r?.ok) return { success: false, error: r?.msg || 'Cupom inválido' };
      const dType = r.d_type as 'percent' | 'fixed';
      const dValue = Number(r.d_value);
      const raw = dType === 'percent'
        ? Number(product.price) * (1 - dValue / 100)
        : Number(product.price) - dValue;
      appliedCoupon = payload.couponCode.trim().toUpperCase();
      amount = raw <= 0 ? 0 : Math.max(0.01, +raw.toFixed(2));
    }

    // Caso 100% off: cria licença direto, sem PIX
    if (amount === 0) {
      const { data: lic, error: licErr } = await supabaseMain.rpc('create_license_from_signup', {
        p_nome: nome, p_email: email, p_numero: numero,
        p_referred_by: payload.referredBy || null,
        p_license_type: 2,
      });
      if (licErr) throw licErr;
      const row = Array.isArray(lic) ? lic[0] : lic;

      if (payload.referredBy) {
        try {
          await supabaseMain.rpc('register_referral', {
            p_referred_license_key: row.license_key,
            p_referrer_friend_code: payload.referredBy,
          });
        } catch {}
      }

      return {
        success: true,
        free: true,
        licenseKey: row.license_key,
        friendCode: row.friend_code,
      };
    }

    // Caso normal: gera PIX. A licença será criada quando confirmar pagamento.
    const charge = await createPixCharge({
      amount,
      description: `Umbra - Licença Vitalícia (${nome.split(' ')[0]})`,
      payerName: nome,
    });

    // Salva pedido com license_key vazia (será preenchida ao pagar)
    const { data: order, error: insErr } = await supabaseMain
      .from('pix_orders')
      .insert({
        license_key: 'PENDING-' + charge.txid.slice(0, 12),
        product_type: 'licenca_vitalicia',
        product_ref: JSON.stringify({ nome, email, numero, referredBy: payload.referredBy || null }),
        product_name: 'Licença Vitalícia Umbra',
        amount,
        original_amount: Number(product.price),
        coupon_code: appliedCoupon,
        txid: charge.txid,
        status: 'pending',
        qr_code_text: charge.qrCodeText,
        qr_code_image: charge.qrCodeImage,
      })
      .select()
      .single();

    if (insErr) {
      console.error('signup-create-pix insert:', insErr);
      return { success: false, error: 'Não foi possível criar o pedido' };
    }

    notifyDenuvoOrder({
      status: 'created',
      licenseKey: order.license_key,
      licenseName: nome,
      gameName: 'Licença Vitalícia',
      gameId: 'signup',
      amount,
      originalAmount: Number(product.price),
      couponCode: appliedCoupon,
      txid: charge.txid,
    }).catch(() => {});

    return {
      success: true,
      free: false,
      order: {
        txid: charge.txid,
        amount,
        originalAmount: Number(product.price),
        qrCodeText: charge.qrCodeText,
        qrCodeImage: charge.qrCodeImage,
        expiresAt: charge.expiresAt,
        couponCode: appliedCoupon,
      },
    };
  } catch (e: any) {
    console.error('signup-create-pix:', e?.message || e);
    return { success: false, error: 'Não foi possível processar o cadastro' };
  }
});

// Polling do signup: confirma pagamento, cria licença, retorna a key gerada
// Signup com cartão de crédito → cobrança one-step + criação imediata de licença se aprovado
ipcMain.handle('signup-create-card', async (_, payload: {
  nome: string; email: string; numero: string;
  referredBy?: string; couponCode?: string;
  installments: number;
  brand: string;
  paymentToken: string;
  cpf: string;
  birth?: string;
  billingAddress: { street: string; number: string | number; neighborhood: string; zipcode: string; city: string; state: string; complement?: string };
}) => {
  try {
    if (!payload.nome || !payload.email || !payload.numero) {
      return { success: false, error: 'Preencha nome, e-mail e telefone' };
    }
    if (!payload.paymentToken) return { success: false, error: 'Token do cartão ausente' };
    if (!payload.installments || payload.installments < 1 || payload.installments > 12) {
      return { success: false, error: 'Parcelamento inválido' };
    }

    const nome = payload.nome.trim().slice(0, 120);
    const email = payload.email.trim().toLowerCase().slice(0, 120);
    const numero = payload.numero.trim().slice(0, 30);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return { success: false, error: 'E-mail inválido' };

    const product = await fetchProductByType('licenca_vitalicia');
    if (!product) return { success: false, error: 'Plano indisponível' };

    let amount = Number(product.price);
    let appliedCoupon: string | null = null;

    // Aplica cupom (debita)
    if (payload.couponCode && payload.couponCode.trim()) {
      const { data, error } = await supabaseMain.rpc('redeem_coupon', {
        p_code: payload.couponCode.trim(),
        p_product_type: 'licenca_vitalicia',
      });
      if (error) throw error;
      const r: any = Array.isArray(data) ? data[0] : data;
      if (!r?.ok) return { success: false, error: r?.msg || 'Cupom inválido' };
      const dValue = Number(r.d_value);
      const raw = r.d_type === 'percent'
        ? Number(product.price) * (1 - dValue / 100)
        : Number(product.price) - dValue;
      appliedCoupon = payload.couponCode.trim().toUpperCase();
      // 100% off → cria licença direto sem cobrar cartão
      if (raw <= 0) {
        const { data: lic, error: licErr } = await supabaseMain.rpc('create_license_from_signup', {
          p_nome: nome, p_email: email, p_numero: numero,
          p_referred_by: payload.referredBy || null,
          p_license_type: 2,
        });
        if (licErr) throw licErr;
        const row: any = Array.isArray(lic) ? lic[0] : lic;

        if (payload.referredBy) {
          try {
            await supabaseMain.rpc('register_referral', {
              p_referred_license_key: row.license_key,
              p_referrer_friend_code: payload.referredBy,
            });
          } catch {}
        }
        return { success: true, free: true, licenseKey: row.license_key, friendCode: row.friend_code };
      }
      amount = Math.max(0.01, +raw.toFixed(2));
    }

    const amountCents = Math.round(amount * 100);

    // Cobra no cartão
    const charge = await createCardCharge({
      amountCents,
      installments: payload.installments,
      paymentToken: payload.paymentToken,
      customer: {
        name: nome,
        cpf: String(payload.cpf || '').replace(/\D/g, ''),
        phone_number: numero.replace(/\D/g, ''),
        email,
        ...(payload.birth ? { birth: payload.birth } : {}),
      },
      billingAddress: {
        street: String(payload.billingAddress.street).slice(0, 80),
        number: payload.billingAddress.number,
        neighborhood: String(payload.billingAddress.neighborhood).slice(0, 80),
        zipcode: String(payload.billingAddress.zipcode).replace(/\D/g, ''),
        city: String(payload.billingAddress.city).slice(0, 80),
        state: String(payload.billingAddress.state).slice(0, 2).toUpperCase(),
        ...(payload.billingAddress.complement ? { complement: payload.billingAddress.complement.slice(0, 80) } : {}),
      } as any,
      description: 'Licença Vitalícia Umbra',
    });

    // Pago/aprovado → cria licença na hora
    if (charge.status === 'paid' || charge.status === 'approved') {
      const { data: lic, error: licErr } = await supabaseMain.rpc('create_license_from_signup', {
        p_nome: nome, p_email: email, p_numero: numero,
        p_referred_by: payload.referredBy || null,
        p_license_type: 2,
      });
      if (licErr) throw licErr;
      const row: any = Array.isArray(lic) ? lic[0] : lic;

      // Persiste pedido vinculado à licença criada
      const totalReais = +(charge.totalCents / 100).toFixed(2);
      await supabaseMain.from('pix_orders').insert({
        license_key: row.license_key,
        product_type: 'licenca_vitalicia',
        product_ref: null,
        product_name: 'Licença Vitalícia Umbra',
        amount,
        original_amount: Number(product.price),
        coupon_code: appliedCoupon,
        txid: 'CARD-' + charge.chargeId,
        status: 'fulfilled',
        payment_method: 'card',
        card_brand: payload.brand,
        card_installments: charge.installments,
        card_charge_id: charge.chargeId,
        card_total_amount: totalReais,
        paid_at: new Date().toISOString(),
        fulfilled_at: new Date().toISOString(),
      });

      if (payload.referredBy) {
        try {
          await supabaseMain.rpc('register_referral', {
            p_referred_license_key: row.license_key,
            p_referrer_friend_code: payload.referredBy,
          });
        } catch {}
      }

      notifyDenuvoOrder({
        status: 'paid',
        licenseKey: row.license_key,
        licenseName: nome,
        gameName: `💳 Licença Vitalícia (${charge.installments}x)`,
        gameId: 'signup',
        amount: totalReais,
        originalAmount: Number(product.price),
        couponCode: appliedCoupon,
        txid: 'CARD-' + charge.chargeId,
      }).catch(() => {});

      return { success: true, free: false, licenseKey: row.license_key, friendCode: row.friend_code };
    }

    // Outros status (raro em one-step) → recusa
    return { success: false, error: 'Pagamento não aprovado pela operadora' };
  } catch (e: any) {
    console.error('signup-create-card:', e?.response?.data || e?.message || e);
    const efiErr = e?.response?.data?.error_description || e?.response?.data?.message;
    return { success: false, error: efiErr || 'Pagamento recusado pela operadora.' };
  }
});

ipcMain.handle('signup-check-status', async (_, txid: string) => {
  try {
    const status = await getChargeStatus(txid);
    if (!status.paid) return { success: true, paid: false };

    const { data: order } = await supabaseMain
      .from('pix_orders')
      .select('*')
      .eq('txid', txid)
      .single();

    if (!order) return { success: false, paid: false, error: 'Pedido não encontrado' };

    // Já fulfilled? retorna a key existente
    if (order.status === 'fulfilled' && order.license_key && !order.license_key.startsWith('PENDING-')) {
      return { success: true, paid: true, licenseKey: order.license_key };
    }

    // Cria a licença agora
    let signupData: any = {};
    try { signupData = JSON.parse(order.product_ref || '{}'); } catch {}

    const { data: lic, error: licErr } = await supabaseMain.rpc('create_license_from_signup', {
      p_nome: signupData.nome || 'Usuário',
      p_email: signupData.email || '',
      p_numero: signupData.numero || '',
      p_referred_by: signupData.referredBy || null,
      p_license_type: 2,
    });
    if (licErr) {
      console.error('signup-check-status create license:', licErr);
      return { success: false, paid: true, error: 'Falha ao criar licença' };
    }
    const row = Array.isArray(lic) ? lic[0] : lic;

    // Atualiza pedido com a license_key real
    await supabaseMain.from('pix_orders').update({
      license_key: row.license_key,
      status: 'fulfilled',
      paid_at: status.paidAt || new Date().toISOString(),
      fulfilled_at: new Date().toISOString(),
    }).eq('txid', txid);

    if (signupData.referredBy) {
      try {
        await supabaseMain.rpc('register_referral', {
          p_referred_license_key: row.license_key,
          p_referrer_friend_code: signupData.referredBy,
        });
      } catch {}
    }

    notifyDenuvoOrder({
      status: 'paid',
      licenseKey: row.license_key,
      licenseName: signupData.nome,
      gameName: 'Licença Vitalícia (cadastro novo)',
      gameId: 'signup',
      amount: Number(order.amount),
      originalAmount: Number(order.original_amount),
      couponCode: order.coupon_code,
      txid: order.txid,
    }).catch(() => {});

    return { success: true, paid: true, licenseKey: row.license_key };
  } catch (e: any) {
    console.error('signup-check-status:', e?.message || e);
    return { success: false, paid: false, error: 'Falha ao consultar pagamento' };
  }
});

// ============================================
// REFERRALS — info do usuário e lista
// ============================================

ipcMain.handle('referral-get-info', async (_, licenseKey: string) => {
  try {
    const { data, error } = await supabaseMain
      .from('keyvortex')
      .select('friend_code, referred_by, referral_count, referral_balance')
      .ilike('key', licenseKey)
      .single();
    if (error || !data) return { success: false };
    return {
      success: true,
      friendCode: data.friend_code,
      referredBy: data.referred_by,
      referralCount: data.referral_count || 0,
      referralBalance: Number(data.referral_balance || 0),
    };
  } catch (e: any) {
    console.error('referral-get-info:', e);
    return { success: false };
  }
});

ipcMain.handle('referral-list', async (_, friendCode: string) => {
  try {
    const { data, error } = await supabaseMain
      .from('referrals')
      .select('referred_license_key, status, bonus_amount, created_at')
      .eq('referrer_friend_code', friendCode)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return { success: true, list: data || [] };
  } catch (e: any) {
    console.error('referral-list:', e);
    return { success: false, list: [] };
  }
});

// Validar código de amigo (no signup)
ipcMain.handle('referral-validate-code', async (_, code: string) => {
  try {
    const c = (code || '').trim().toUpperCase();
    if (!c) return { success: false, message: 'Código vazio' };
    const { data, error } = await supabaseMain
      .from('keyvortex')
      .select('friend_code, nome')
      .eq('friend_code', c)
      .single();
    if (error || !data) return { success: false, message: 'Código inválido' };
    return { success: true, referrerName: data.nome ? String(data.nome).split(' ')[0] : 'amigo' };
  } catch {
    return { success: false, message: 'Código inválido' };
  }
});

// ============================================
// PROFILE UPDATE — completar/editar nome/email/telefone (nome só se vazio)
// ============================================

ipcMain.handle('profile-update', async (_, payload: {
  licenseKey: string; nome?: string; email?: string; numero?: string;
}) => {
  try {
    if (!payload.licenseKey) return { success: false, error: 'Licença ausente' };

    // Busca licença atual
    const { data: lic, error: fetchErr } = await supabaseMain
      .from('keyvortex')
      .select('nome, email, numero')
      .ilike('key', payload.licenseKey)
      .single();
    if (fetchErr || !lic) return { success: false, error: 'Licença não encontrada' };

    const update: Record<string, any> = {};

    // Nome só pode ser definido se ainda não existe
    if (payload.nome && (!lic.nome || lic.nome.trim() === '')) {
      const n = payload.nome.trim();
      if (n.split(/\s+/).length < 2) return { success: false, error: 'Informe nome completo' };
      update.nome = n.slice(0, 120);
    }

    if (payload.email !== undefined && payload.email !== null) {
      const e = String(payload.email).trim().toLowerCase();
      if (!e) return { success: false, error: 'E-mail inválido' };
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return { success: false, error: 'E-mail inválido' };
      update.email = e.slice(0, 120);
    }

    if (payload.numero !== undefined && payload.numero !== null) {
      const n = String(payload.numero).trim();
      const cleaned = n.replace(/\D/g, '');
      if (cleaned.length < 10) return { success: false, error: 'Telefone inválido' };
      update.numero = n.slice(0, 30);
    }

    if (Object.keys(update).length === 0) {
      return { success: true, updated: 0 };
    }
    update.updated_at = new Date().toISOString();

    const { error: upErr } = await supabaseMain
      .from('keyvortex')
      .update(update)
      .ilike('key', payload.licenseKey);
    if (upErr) return { success: false, error: 'Falha ao salvar' };

    return { success: true, updated: Object.keys(update).length - 1 };
  } catch (e: any) {
    console.error('profile-update:', e);
    return { success: false, error: 'Não foi possível salvar' };
  }
});

// ============================================
// REFERRAL REDEMPTION — resgate R$50 a cada 4 indicações
// ============================================

ipcMain.handle('redemption-request', async (_, payload: {
  licenseKey: string; pixKey: string; pixKeyType?: string;
}) => {
  try {
    if (!payload.licenseKey || !payload.pixKey || payload.pixKey.trim().length < 5) {
      return { success: false, error: 'Informe sua chave PIX' };
    }

    const { data, error } = await supabaseMain.rpc('request_referral_redemption', {
      p_license_key: payload.licenseKey,
      p_pix_key: payload.pixKey.trim(),
      p_pix_key_type: payload.pixKeyType || null,
    });
    if (error) {
      console.error('redemption-request RPC:', error);
      return { success: false, error: 'Não foi possível processar o resgate' };
    }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r?.success) return { success: false, error: r?.message || 'Resgate negado' };

    // Busca dados pra notificar Discord
    const { data: lic } = await supabaseMain
      .from('keyvortex')
      .select('nome, friend_code')
      .ilike('key', payload.licenseKey)
      .single();

    // Webhook de resgates
    const REDEMPTION_WEBHOOK = process.env.DISCORD_WEBHOOK_REDEMPTIONS || '';
    if (REDEMPTION_WEBHOOK) try {
      await axios.post(
        REDEMPTION_WEBHOOK,
        {
          embeds: [{
            title: '💸 Novo resgate de indicação — R$ 50,00',
            color: 0xfbbf24,
            fields: [
              { name: 'Cliente', value: lic?.nome || 'Sem nome', inline: true },
              { name: 'Código de amigo', value: `\`${lic?.friend_code || '?'}\``, inline: true },
              { name: 'Licença', value: `\`${payload.licenseKey}\``, inline: false },
              { name: 'Chave PIX', value: `\`${payload.pixKey.trim()}\`${payload.pixKeyType ? ` (${payload.pixKeyType})` : ''}`, inline: false },
              { name: 'Valor', value: 'R$ 50,00', inline: true },
              { name: 'Indicações consumidas', value: '4', inline: true },
              { name: 'ID do resgate', value: `\`${r.redemption_id}\``, inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'TitanForge Launcher · Programa de Indicação' },
          }],
        },
        { timeout: 10000 }
      );
    } catch (e: any) {
      console.error('Discord webhook (redemption):', e?.message || e);
    }

    return { success: true, redemptionId: r.redemption_id };
  } catch (e: any) {
    console.error('redemption-request:', e);
    return { success: false, error: 'Não foi possível processar o resgate' };
  }
});

// Conta indicações disponíveis (não-resgatadas) e lista resgates anteriores
ipcMain.handle('redemption-info', async (_, licenseKey: string) => {
  try {
    const { data: lic } = await supabaseMain
      .from('keyvortex')
      .select('friend_code')
      .ilike('key', licenseKey)
      .single();
    if (!lic?.friend_code) return { success: false };

    const { data: avail, error: aErr } = await supabaseMain.rpc('available_referrals_count', {
      p_friend_code: lic.friend_code,
    });
    if (aErr) throw aErr;

    const { data: history } = await supabaseMain
      .from('referral_redemptions')
      .select('id, amount, status, pix_key, created_at, paid_at')
      .eq('friend_code', lic.friend_code)
      .order('created_at', { ascending: false })
      .limit(20);

    return {
      success: true,
      available: Number(avail || 0),
      history: history || [],
    };
  } catch (e: any) {
    console.error('redemption-info:', e);
    return { success: false, available: 0, history: [] };
  }
});

// ----- BACKWARD COMPAT: handler antigo de Denuvo agora cria um pedido PIX universal -----
async function fulfillProductPermission(productType: string, licenseKey: string): Promise<boolean> {
  if (productType === 'denuvo') return false; // Denuvo não libera permissão automática
  const product = await fetchProductByType(productType);
  if (!product?.permission_field) return false;
  const { error } = await supabaseMain.rpc('grant_license_permission', {
    p_license_key: licenseKey,
    p_permission_field: product.permission_field,
    p_duration_days: product.duration_days,
  });
  return !error;
}

async function createPixOrderInternal(payload: {
  licenseKey: string; licenseName?: string; productType: string; productRef?: string; couponCode?: string;
}) {
  let originalAmount = 0;
  let productName = '';
  let productRef: string | null = null;

  if (payload.productType === 'denuvo') {
    if (!payload.productRef) return { success: false, error: 'Jogo não informado' };
    const g = await fetchDenuvoGameById(payload.productRef);
    if (!g) return { success: false, error: 'Jogo indisponível' };
    originalAmount = Number(g.price);
    productName = `Remoção Denuvo: ${g.name}`;
    productRef = String(g.game_id);
  } else {
    const p = await fetchProductByType(payload.productType);
    if (!p) return { success: false, error: 'Produto indisponível' };
    originalAmount = Number(p.price);
    productName = p.name;
  }

  let amount = originalAmount;
  let appliedCoupon: string | null = null;

  if (payload.couponCode && payload.couponCode.trim().length > 0) {
    const { data: redeemData, error: redeemErr } = await supabaseMain.rpc('redeem_coupon', {
      p_code: payload.couponCode.trim(),
      p_product_type: payload.productType,
    });
    if (redeemErr) throw redeemErr;
    const r = Array.isArray(redeemData) ? redeemData[0] : redeemData;
    if (!r?.ok) return { success: false, error: r?.msg || 'Cupom inválido' };

    // Calcula desconto bruto (sem o piso de 0.01) para detectar 100% off
    const dType = r.d_type as 'percent' | 'fixed';
    const dValue = Number(r.d_value);
    const rawDiscounted = dType === 'percent'
      ? originalAmount * (1 - dValue / 100)
      : originalAmount - dValue;

    appliedCoupon = payload.couponCode.trim().toUpperCase();

    // CUPOM 100% OFF (ou maior) → libera direto sem gerar QR Code, sem cobrar EFI
    if (rawDiscounted <= 0) {
      // Para denuvo o auto-fulfill não faz sentido (precisa do humano processar)
      // — mas marca como pago/grátis
      const fakeTxid = 'FREE-' + crypto.randomBytes(12).toString('hex');
      const { data: order, error: insErr } = await supabaseMain
        .from('pix_orders')
        .insert({
          license_key: payload.licenseKey,
          product_type: payload.productType,
          product_ref: productRef,
          product_name: productName,
          amount: 0,
          original_amount: originalAmount,
          coupon_code: appliedCoupon,
          txid: fakeTxid,
          status: 'paid',
          paid_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insErr) {
        console.error('free coupon insert:', insErr);
        return { success: false, error: 'Não foi possível processar o cupom' };
      }

      // Auto-libera permissão (para produtos premium)
      let fulfilled = false;
      if (payload.productType !== 'denuvo') {
        fulfilled = await fulfillProductPermission(payload.productType, payload.licenseKey);
        if (fulfilled) {
          await supabaseMain.from('pix_orders')
            .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
            .eq('id', order.id);
        }
      }

      notifyDenuvoOrder({
        status: 'paid',
        licenseKey: payload.licenseKey,
        licenseName: payload.licenseName || null,
        gameName: productName + ' (CUPOM 100%)',
        gameId: productRef || payload.productType,
        amount: 0,
        originalAmount,
        couponCode: appliedCoupon,
        txid: fakeTxid,
      }).catch(() => {});

      return {
        success: true,
        free: true,
        order: {
          id: order.id,
          txid: fakeTxid,
          productType: payload.productType,
          productName,
          amount: 0,
          originalAmount,
          couponCode: appliedCoupon,
          qrCodeText: '',
          qrCodeImage: '',
          expiresAt: new Date().toISOString(),
        },
      };
    }

    amount = Math.max(0.01, +rawDiscounted.toFixed(2));
  }

  const charge = await createPixCharge({
    amount,
    description: `Umbra - ${productName.slice(0, 60)}`,
    payerName: payload.licenseName || undefined,
  });

  const { data: order, error: insErr } = await supabaseMain
    .from('pix_orders')
    .insert({
      license_key: payload.licenseKey,
      product_type: payload.productType,
      product_ref: productRef,
      product_name: productName,
      amount,
      original_amount: originalAmount,
      coupon_code: appliedCoupon,
      txid: charge.txid,
      status: 'pending',
      qr_code_text: charge.qrCodeText,
      qr_code_image: charge.qrCodeImage,
    })
    .select()
    .single();

  if (insErr) {
    console.error('createPixOrderInternal insert:', insErr);
    return { success: false, error: 'Não foi possível criar o pedido' };
  }

  notifyDenuvoOrder({
    status: 'created',
    licenseKey: payload.licenseKey,
    licenseName: payload.licenseName || null,
    gameName: productName,
    gameId: productRef || payload.productType,
    amount,
    originalAmount,
    couponCode: appliedCoupon,
    txid: charge.txid,
  }).catch(() => {});

  return {
    success: true,
    free: false,
    order: {
      id: order.id,
      txid: charge.txid,
      productType: payload.productType,
      productName,
      amount,
      originalAmount,
      couponCode: appliedCoupon,
      qrCodeText: charge.qrCodeText,
      qrCodeImage: charge.qrCodeImage,
      expiresAt: charge.expiresAt,
    },
  };
}

ipcMain.handle('denuvo-create-order', async (_, payload: any) => {
  try {
    return await createPixOrderInternal({
      licenseKey: payload.licenseKey,
      licenseName: payload.licenseName,
      productType: 'denuvo',
      productRef: payload.gameId,
      couponCode: payload.couponCode,
    });
  } catch (e: any) {
    console.error('denuvo-create-order:', e?.message || e);
    return { success: false, error: 'Não foi possível processar sua compra' };
  }
});

ipcMain.handle('denuvo-check-status', async (_, txid: string) => {
  // Mesma lógica do pix-check-status — apenas alias
  try {
    const status = await getChargeStatus(txid);
    if (status.paid) {
      const { data: order } = await supabaseMain.from('pix_orders').select('*').eq('txid', txid).single();
      if (order && order.status === 'pending') {
        await supabaseMain.from('pix_orders')
          .update({ status: 'paid', paid_at: status.paidAt || new Date().toISOString() })
          .eq('txid', txid);
      }
    }
    return { success: true, paid: status.paid, status: status.status };
  } catch (e: any) {
    return { success: false, paid: false, error: 'Falha ao consultar pagamento' };
  }
});

ipcMain.handle('denuvo-list-my-orders', async (_, licenseKey: string) => {
  try {
    const { data, error } = await supabaseMain
      .from('pix_orders')
      .select('*')
      .eq('license_key', licenseKey)
      .eq('product_type', 'denuvo')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return { success: true, orders: data || [] };
  } catch (e: any) {
    console.error('denuvo-list-my-orders:', e);
    return { success: false, orders: [] };
  }
});

// ============================================
// USER SETTINGS — IP público (executado no main para evitar CORS)
// ============================================

ipcMain.handle('get-public-ip', async () => {
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    return { success: true, ip: r.data.ip as string };
  } catch {
    return { success: false, ip: 'unknown' };
  }
});

// ============================================
// BYPASS EXTRACTION — escolha pasta + extrai (.zip/.rar/.7z/.torrent)
// ============================================

ipcMain.handle('bypass-pick-folder', async () => {
  try {
    if (!mainWindow) return { success: false, error: 'Janela indisponível' };
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a pasta de instalação do jogo',
      buttonLabel: 'Selecionar pasta',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) {
      return { success: false, canceled: true };
    }
    return { success: true, folder: r.filePaths[0] };
  } catch (e: any) {
    return { success: false, error: 'Não foi possível abrir o seletor' };
  }
});

ipcMain.handle('bypass-extract', async (_, payload: { url: string; destinationFolder: string }) => {
  try {
    const result = await extractBypass(payload, mainWindow);
    return result;
  } catch (e: any) {
    console.error('bypass-extract:', e);
    return { success: false, error: 'Falha ao instalar o bypass' };
  }
});

ipcMain.handle('depotbox-api-request', async (_, endpoint: string, options: any) => {
  try {
    const url = `https://depotbox.org/api${endpoint}`;
    console.log('🌐 [Main] DepotBox API Request:', url);

    const response = await axios({
      method: options.method || 'GET',
      url,
      headers: {
        'X-API-Key': process.env.DEPOTBOX_API_KEY || '',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      data: options.body ? JSON.parse(options.body) : undefined,
      validateStatus: () => true, // Não lançar erro em status !== 2xx
    });

    console.log('✅ [Main] DepotBox API Response:', response.status);

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      data: response.data,
    };
  } catch (error: any) {
    console.error('❌ [Main] DepotBox API Error:', error.message);
    throw error;
  }
});

// IPC Handlers

// Obter HWID da máquina
ipcMain.handle('get-hwid', async () => {
  try {
    const hwid = await getHWID();
    return { success: true, hwid };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Carregar banco de dados de jogos (games.json)
ipcMain.handle('load-games-database', async () => {
  try {
    const gamesPath = path.join(__dirname, '../renderer/games.json');

    if (!fs.existsSync(gamesPath)) {
      console.warn('⚠️ games.json não encontrado em:', gamesPath);
      return [];
    }

    const gamesData = fs.readFileSync(gamesPath, 'utf-8');
    const games = JSON.parse(gamesData);
    console.log(`✅ ${games.length} jogos carregados do banco de dados local`);
    return games;
  } catch (error: any) {
    console.error('❌ Erro ao carregar banco de dados de jogos:', error);
    return [];
  }
});

// Cache em memória do games.json da Ryuu (reduz requests)
let ryuuGamesCache: { data: any[]; fetchedAt: number } | null = null;
const RYUU_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

ipcMain.handle('fetch-ryuu-games', async () => {
  console.log('🌐 [IPC] fetch-ryuu-games chamado');
  try {
    const now = Date.now();
    if (ryuuGamesCache && now - ryuuGamesCache.fetchedAt < RYUU_CACHE_TTL_MS) {
      console.log(`📦 [IPC] Retornando cache (${ryuuGamesCache.data.length} entradas)`);
      return { success: true, games: ryuuGamesCache.data };
    }

    console.log('🌐 [IPC] Carregando banco de dados de jogos...');
    const response = await axios.get('https://generator.ryuu.lol/files/games.json', {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
      responseType: 'json',
      validateStatus: (status) => status >= 200 && status < 300,
    });

    console.log(`📥 [IPC] Banco de dados carregado`);
    const data = response.data;
    const games = Array.isArray(data) ? data : [];
    ryuuGamesCache = { data: games, fetchedAt: now };
    console.log(`✅ [IPC] Banco de dados: ${games.length} entradas`);
    if (games.length > 0) {
      console.log(`🔍 [IPC] Primeira entrada processada`);
    }
    return { success: true, games };
  } catch (error: any) {
    console.error('❌ [IPC] Erro ao carregar banco de dados:', error?.message || error);
    if (error?.response) {
      console.error('❌ [IPC] HTTP Status:', error.response.status);
    }
    return { success: false, error: 'Não foi possível carregar o banco de dados' };
  }
});

// Handler para buscar dados da Steam API (sem CORS - main process)
ipcMain.handle('fetch-steam-game-data', async (_event, appId: string) => {
  try {
    const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=BR&l=portuguese`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(steamUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data[appId]?.success && data[appId]?.data) {
      return {
        success: true,
        gameData: {
          steam_appid: data[appId].data.steam_appid,
          name: data[appId].data.name,
          header_image: data[appId].data.header_image
        }
      };
    }

    return { success: false, error: 'No data from Steam' };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Timeout' };
    }
    return { success: false, error: error.message };
  }
});

// Detectar caminho da Steam
ipcMain.handle('detect-steam-path', async () => {
  try {
    const steamPath = await detectSteamPath();
    return { success: true, path: steamPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Download e instalação dos arquivos da Steam
ipcMain.handle('update-steam', async (_event, { steamPath, downloadUrl }) => {
  try {
    // Validar URL
    if (!downloadUrl) {
      throw new Error('URL de download não fornecida');
    }

    // Enviar progresso para o renderer
    const onProgress = (progress: number) => {
      mainWindow?.webContents.send('update-progress', progress);
    };

    // Download do Google Drive (URL vem do backend)
    mainWindow?.webContents.send('update-status', 'Baixando arquivos...');
    const downloadPath = await downloadFromGoogleDrive(downloadUrl, onProgress);

    // Instalar arquivos na Steam
    mainWindow?.webContents.send('update-status', 'Instalando arquivos...');
    await installSteamFiles(downloadPath, steamPath);

    mainWindow?.webContents.send('update-status', 'Concluído!');
    return { success: true };
  } catch (error: any) {
    console.error('Erro ao atualizar Steam:', error);
    return { success: false, error: error.message };
  }
});

// Abrir Steam NORMAL (sem Big Picture, sem verificação de pacotes)
ipcMain.handle('open-steam', async (_event, { steamPath }) => {
  try {
    await openSteam(steamPath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Fechar Steam
ipcMain.handle('close-steam', async () => {
  try {
    await closeSteam();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Fechar aplicação
ipcMain.handle('close-app', () => {
  app.quit();
});

// Minimizar janela
ipcMain.handle('minimize-app', () => {
  mainWindow?.minimize();
});

// Redimensionar janela após login
ipcMain.handle('resize-window', (_event, { width, height }) => {
  if (mainWindow) {
    mainWindow.setResizable(true);
    mainWindow.setSize(width, height);
    mainWindow.center();
    mainWindow.setResizable(false);
  }
});

// Maximizar/Restaurar janela
ipcMain.handle('maximize-app', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// Verificar se janela está maximizada
ipcMain.handle('is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Executar comando PowerShell
ipcMain.handle('run-powershell-command', async (_event, { command }) => {
  try {
    const { spawn } = require('child_process');

    console.log('Executando comando PowerShell (invisível)');

    return new Promise((resolve) => {
      // Sempre janela escondida — usuário nunca vê janela do PowerShell, mesmo em erro
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-Command', command,
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      ps.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      ps.on('error', (err: Error) => {
        console.error('Falha ao iniciar PowerShell:', err);
        resolve({ success: false, error: 'Não foi possível executar a atualização' });
      });

      ps.on('close', (code: number) => {
        if (stderr) console.error('PowerShell stderr:', stderr);
        if (code === 0 || stdout.length > 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({ success: false, error: 'Não foi possível concluir a atualização' });
        }
      });

      // Enviar "y" para stdin automaticamente após 1 segundo
      setTimeout(() => {
        try { ps.stdin.write('y\n'); ps.stdin.end(); } catch {}
      }, 1000);
    });
  } catch (error: any) {
    console.error('Erro ao executar PowerShell:', error);
    return { success: false, error: 'Não foi possível executar a atualização' };
  }
});

// Desabilitar DLL quando licença suspensa
ipcMain.handle('disable-hid-dll', async () => {
  try {
    const steamPath = await detectSteamPath();
    if (steamPath) {
      await disableHidDll(steamPath);

      // CRÍTICO: Marcar DLL como NÃO esperada para que o monitoramento saiba que ela deve estar desabilitada
      dllExpectedActive = false;
      originalDllHash = null;
      console.log('✅ DLL marcada como desautorizada');
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Habilitar DLL quando login for validado
ipcMain.handle('enable-hid-dll', async () => {
  try {
    const steamPath = await detectSteamPath();
    if (steamPath) {
      await enableHidDll(steamPath);

      // CRÍTICO: Marcar DLL como esperada e calcular hash para prevenir desativação pelo monitoramento
      dllExpectedActive = true;
      const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
      if (fs.existsSync(hidDllPath)) {
        originalDllHash = calculateFileHash(hidDllPath);
        console.log('✅ DLL marcada como autorizada - monitoramento não irá desabilitar');
      }
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Garantir que xinput1_4.dll está ativo antes de "ATUALIZAR AGORA"
ipcMain.handle('ensure-hid-dll-active', async () => {
  try {
    // 1. Detectar Steam
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

    // 2. Verificar se xinput1_4.dll já existe (ativo)
    if (fs.existsSync(hidDllPath)) {
      console.log('✅ xinput1_4.dll já está ativo');
      return { success: true };
    }

    // 3. Se .disabled existe, renomear
    if (fs.existsSync(hidDllDisabled)) {
      fs.renameSync(hidDllDisabled, hidDllPath);
      console.log('✅ xinput1_4.dll.disabled → xinput1_4.dll');
      return { success: true };
    }

    // 4. Se não existe nem ativo nem disabled, copiar do cache
    const cacheManager = new CacheManager();
    if (!cacheManager.hasCachedFiles()) {
      return { success: false, error: 'Antes de atualizar o launcher, baixe nosso Pacote Premium primeiro!' };
    }

    // Copiar APENAS xinput1_4.dll do cache (não as pastas config)
    const steamFilesCacheDir = cacheManager.getCacheDirectory();
    const hidDllCachePath = path.join(steamFilesCacheDir, 'xinput1_4.dll');
    if (fs.existsSync(hidDllCachePath)) {
      fs.copyFileSync(hidDllCachePath, hidDllPath);
      console.log('✅ xinput1_4.dll copiado do cache');
      return { success: true };
    } else {
      return { success: false, error: 'Antes de atualizar o launcher, baixe nosso Pacote Premium primeiro!' };
    }

  } catch (error: any) {
    console.error('❌ Erro ao garantir xinput1_4.dll ativo:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Codifica uma string em Base32
 * Baseado no algoritmo usado pelo steamtools.pages.dev
 * Converte cada caractere para binário (8 bits), processa em chunks de 5 bits
 * NOTA: Não mais necessário com Puppeteer, mantido comentado para possível uso futuro
 */
/*
function encodeBase32(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  // Converter cada caractere para binário de 8 bits
  let bits = '';
  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);
    bits += charCode.toString(2).padStart(8, '0');
  }

  // Processar em chunks de 5 bits
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substr(i, 5).padEnd(5, '0');
    const value = parseInt(chunk, 2);
    result += alphabet[value];
  }

  // Remover padding '=' se houver
  return result.replace(/=+$/, '');
}
*/

// ─────────────────────────────────────────────────────────────────────────────
// VDF HELPERS — Coleção Steam (localconfig.vdf WebStorage)
// ─────────────────────────────────────────────────────────────────────────────
function parseVdf(input: string): Record<string, any> {
  let i = 0;
  function skip(): void {
    while (i < input.length) {
      const c = input[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && input[i + 1] === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
      break;
    }
  }
  function readStr(): string {
    skip();
    if (input[i] !== '"') throw new Error(`VDF: expected " at ${i}`);
    i++;
    let s = '';
    while (i < input.length && input[i] !== '"') {
      if (input[i] === '\\') { i++; s += input[i] ?? ''; i++; } else { s += input[i]; i++; }
    }
    i++;
    return s;
  }
  function readObj(): Record<string, any> {
    skip();
    if (input[i] !== '{') throw new Error(`VDF: expected { at ${i}`);
    i++;
    const obj: Record<string, any> = {};
    while (true) {
      skip();
      if (i >= input.length || input[i] === '}') { i++; break; }
      const key = readStr(); skip();
      obj[key] = input[i] === '{' ? readObj() : readStr();
    }
    return obj;
  }
  const result: Record<string, any> = {};
  while (true) {
    skip(); if (i >= input.length) break;
    const key = readStr(); skip();
    result[key] = readObj();
  }
  return result;
}

function escapeVdfStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeVdf(obj: Record<string, any>, depth = 0): string {
  const t = '\t'.repeat(depth);
  return Object.entries(obj).map(([k, v]) =>
    v !== null && typeof v === 'object'
      ? `${t}"${escapeVdfStr(k)}"\n${t}{\n${serializeVdf(v as Record<string, any>, depth + 1)}${t}}\n`
      : `${t}"${escapeVdfStr(k)}"\t\t"${escapeVdfStr(String(v))}"\n`
  ).join('');
}

function getSteamLocalConfigPath(steamPath: string): string | null {
  const userdataPath = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataPath)) return null;
  let bestPath: string | null = null; let bestTime = 0;
  for (const dir of fs.readdirSync(userdataPath)) {
    if (!/^\d+$/.test(dir)) continue;
    const cfgPath = path.join(userdataPath, dir, 'config', 'localconfig.vdf');
    if (!fs.existsSync(cfgPath)) continue;
    const t = fs.statSync(cfgPath).mtimeMs;
    if (t > bestTime) { bestTime = t; bestPath = cfgPath; }
  }
  return bestPath;
}

// Cria ou atualiza a coleção "+18" no localconfig.vdf (WebStorage) — Steam novo
function addGamesToSteamCollection(steamPath: string, appIds: string[]): number {
  const cfgPath = getSteamLocalConfigPath(steamPath);
  if (!cfgPath) return 0;
  const COLLECTION_ID = 'titanforge-plus18';
  const COLLECTION_KEY = `user-collections.${COLLECTION_ID}`;
  try {
    const cfg = parseVdf(fs.readFileSync(cfgPath, 'utf8'));
    const rootKey = Object.keys(cfg)[0]; // "UserLocalConfigStore"
    const root = cfg[rootKey];
    if (!root.WebStorage) root.WebStorage = {};
    const ws = root.WebStorage as Record<string, string>;

    // Ler coleção existente
    let currentAdded: string[] = [];
    if (ws[COLLECTION_KEY]) {
      try { currentAdded = JSON.parse(ws[COLLECTION_KEY]).added ?? []; } catch {}
    }

    // Adicionar novos appIds
    let added = 0;
    for (const id of appIds) {
      if (!currentAdded.includes(id)) { currentAdded.push(id); added++; }
    }
    if (added === 0) return 0;

    ws[COLLECTION_KEY] = JSON.stringify({ id: COLLECTION_ID, name: '+18', added: currentAdded, removed: [] });
    fs.writeFileSync(cfgPath, `"${rootKey}"\n{\n${serializeVdf(root, 1)}}\n`, 'utf8');
    console.log(`✅ Coleção +18 atualizada: ${currentAdded.length} jogos`);
    return added;
  } catch (e) {
    console.error('[addGamesToSteamCollection]', e);
    return 0;
  }
}

let adultAppIdsCache: { ids: Set<string>; fetchedAt: number } | null = null;
const ADULT_IDS_TTL_MS = 30 * 60 * 1000;

async function fetchAdultAppIds(): Promise<Set<string>> {
  const now = Date.now();
  if (adultAppIdsCache && now - adultAppIdsCache.fetchedAt < ADULT_IDS_TTL_MS) return adultAppIdsCache.ids;
  try {
    let games = ryuuGamesCache?.data ?? [];
    if (games.length === 0) {
      const res = await axios.get('https://generator.ryuu.lol/files/games.json', { timeout: 15000 });
      games = Array.isArray(res.data) ? res.data : [];
      ryuuGamesCache = { data: games, fetchedAt: now };
    }
    const ids = new Set<string>(
      games.filter((g: any) => g.nsfw === true).map((g: any) => String(g.appid))
    );
    adultAppIdsCache = { ids, fetchedAt: now };
    return ids;
  } catch { return new Set(); }
}

/**
 * Baixar jogo do GitHub ManifestHub (via manifest.youngzm.com)
 * Tenta 3 mirrors: GitHub direto, ghproxy.net, ghfast.top
 */
async function downloadGameFromManifestHub(appId: string): Promise<Buffer | null> {
  // Nova API: Ryuu Generator
  const url = `https://generator.ryuu.lol/secure_download?appid=${appId}&auth_code=devguime`;

  try {
    console.log(`🌐 Baixando do Ryuu Generator`);
    console.log(`📥 URL: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://generator.ryuu.lol/',
        'Origin': 'https://generator.ryuu.lol',
      },
      redirect: 'follow',
    });

    console.log(`📊 Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'não foi possível ler');
      console.error(`❌ Ryuu Generator retornou status ${response.status}`);
      console.error(`📄 Resposta:`, errorText.substring(0, 500));
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    console.log(`📦 Arquivo recebido: ${zipBuffer.length} bytes`);

    // Verificar assinatura ZIP (50 4B 03 04)
    if (zipBuffer.length >= 4 &&
        zipBuffer[0] === 0x50 &&
        zipBuffer[1] === 0x4B &&
        zipBuffer[2] === 0x03 &&
        zipBuffer[3] === 0x04) {
      console.log(`✅ ZIP válido baixado do Ryuu Generator (${zipBuffer.length} bytes)`);
      return zipBuffer;
    } else {
      console.log(`⚠️ Arquivo não é um ZIP válido`);
      console.log(`🔍 Primeiros bytes (hex):`, zipBuffer.slice(0, 4).toString('hex'));
      // Log body as text for debugging
      const bodyText = zipBuffer.toString('utf8').substring(0, 300);
      console.log(`📄 Corpo da resposta:`, bodyText);
      return null;
    }

  } catch (error: any) {
    console.error(`❌ Erro ao baixar do Ryuu Generator: ${error.message}`);
    return null;
  }
}

// Baixar e instalar jogo do steamtools.pages.dev
ipcMain.handle('download-manifestor-lua', async (_, appId: string, gameName: string, skipRestart = false) => {
  try {
    console.log(`📥 Baixando jogo AppID: ${appId}`);

    // Detectar Steam
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    // VERIFICAR se xinput1_4.dll está presente
    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

    if (!fs.existsSync(hidDllPath)) {
      // Se não existe xinput1_4.dll, tentar ativar
      if (fs.existsSync(hidDllDisabled)) {
        fs.renameSync(hidDllDisabled, hidDllPath);
        console.log('✅ xinput1_4.dll.disabled → xinput1_4.dll');
        // ANTI-BURLA: Marcar DLL como esperada e calcular hash
        dllExpectedActive = true;
        originalDllHash = calculateFileHash(hidDllPath);
      } else {
        // Se não existe nem .dll nem .disabled, copiar de assets
        const isDev = process.env.NODE_ENV === 'development';
        let assetsPath: string;
        
        if (isDev) {
          assetsPath = path.join(process.cwd(), 'assets');
        } else {
          // Tentar asarUnpack primeiro
          const asarUnpackAssets = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');
          if (fs.existsSync(asarUnpackAssets)) {
            assetsPath = asarUnpackAssets;
          } else {
            assetsPath = path.join(process.resourcesPath, 'assets');
          }
        }

        const hidDllSource = path.join(assetsPath, 'xinput1_4.dll');

        if (fs.existsSync(hidDllSource)) {
          fs.copyFileSync(hidDllSource, hidDllPath);
          console.log('✅ xinput1_4.dll copiado de assets para Steam');
          // ANTI-BURLA: Marcar DLL como esperada e calcular hash
          dllExpectedActive = true;
          originalDllHash = calculateFileHash(hidDllPath);
        } else {
          return { success: false, error: 'Arquivo do sistema não encontrado. Reinstale o launcher.' };
        }
      }
    } else {
      // ANTI-BURLA: Se DLL já existe, marcar como esperada
      dllExpectedActive = true;
      if (!originalDllHash) {
        originalDllHash = calculateFileHash(hidDllPath);
      }
    }

    // Buscar nome do jogo na API da Steam
    let gameNameFromSteam = gameName;
    try {
      const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
      const steamResponse = await fetch(steamApiUrl);
      const steamData = await steamResponse.json();

      if (steamData[appId]?.success && steamData[appId]?.data?.name) {
        gameNameFromSteam = steamData[appId].data.name;
        console.log(`🎮 Nome do jogo: ${gameNameFromSteam}`);
      }
    } catch (error) {
      console.log('⚠️ Não foi possível buscar nome do jogo na Steam API');
    }

    // Baixar jogo do GitHub ManifestHub
    console.log(`🚀 Iniciando download do ManifestHub...`);
    const zipBuffer = await downloadGameFromManifestHub(appId);

    if (!zipBuffer) {
      return { success: false, error: 'Não foi possível baixar o jogo. O ID pode estar incorreto ou o jogo ainda não está disponível.' };
    }

    // Salvar .zip temporariamente
    const tempZipPath = path.join(os.tmpdir(), `game_${appId}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);
    console.log(`💾 .zip salvo temporariamente em: ${tempZipPath}`);

    // Extrair .zip
    const zip = new AdmZip(tempZipPath);
    const zipEntries = zip.getEntries();

    console.log(`📦 Extraindo ${zipEntries.length} arquivos...`);

    // Criar diretórios se não existirem
    const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
    const depotcachePath = path.join(steamPath, 'config', 'depotcache');

    if (!fs.existsSync(stplugInPath)) {
      fs.mkdirSync(stplugInPath, { recursive: true });
      console.log('📁 Diretório stplug-in criado');
    }

    if (!fs.existsSync(depotcachePath)) {
      fs.mkdirSync(depotcachePath, { recursive: true });
      console.log('📁 Diretório depotcache criado');
    }

    // Processar cada arquivo
    let luaCount = 0;
    let manifestCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.lua') {
        // Salvar .lua em stplug-in
        const destPath = path.join(stplugInPath, fileName);
        fs.writeFileSync(destPath, entry.getData());
        console.log(`✅ .lua salvo: ${fileName}`);
        luaCount++;
      } else if (ext === '.manifest') {
        // Salvar .manifest em depotcache
        const destPath = path.join(depotcachePath, fileName);
        fs.writeFileSync(destPath, entry.getData());
        console.log(`✅ .manifest salvo: ${fileName}`);
        manifestCount++;
      }
    }

    // Remover .zip temporário
    fs.unlinkSync(tempZipPath);
    console.log('🗑️ Arquivo temporário removido');

    console.log(`✅ Instalação concluída: ${luaCount} .lua, ${manifestCount} .manifest`);

    // REINICIAR STEAM automaticamente (apenas se não for bulk download)
    if (!skipRestart) {
      console.log('🔄 Reiniciando Steam...');
      await closeSteam();
      try {
        const adultIds = await fetchAdultAppIds();
        if (adultIds.has(appId)) {
          addGamesToSteamCollection(steamPath, [appId]);
          console.log(`🔞 Jogo ${appId} categorizado como +18 no Steam`);
        }
      } catch {}
      await openSteam(steamPath);
    } else {
      console.log('⏭️ Steam restart pulado (bulk download)');
    }

    return {
      success: true,
      filePath: stplugInPath,
      gameName: gameNameFromSteam,
      luaCount,
      manifestCount,
    };
  } catch (error: any) {
    console.error('❌ Erro ao baixar jogo:', error);
    return { success: false, error: error.message };
  }
});

// ── INSTALL FULL PACK ────────────────────────────────────────────────────────
let fullPackCancelFlag = false;

ipcMain.handle('cancel-full-pack', async () => {
  fullPackCancelFlag = true;
  return { success: true };
});

ipcMain.handle('install-full-pack', async (_event, appIds: string[]) => {
  fullPackCancelFlag = false;

  const steamPath = await detectSteamPath();
  if (!steamPath) return { success: false, error: 'Steam não encontrada' };

  // Fechar Steam antes de escrever qualquer arquivo para evitar corrupção de estado
  try { await closeSteam(); } catch { /* já fechada */ }
  await new Promise(resolve => setTimeout(resolve, 2000));

  const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
  const depotcachePath = path.join(steamPath, 'config', 'depotcache');
  fs.mkdirSync(stplugInPath, { recursive: true });
  fs.mkdirSync(depotcachePath, { recursive: true });

  const total = appIds.length;
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 50;
  let idx = 0;

  const sendProgress = () => {
    mainWindow?.webContents.send('full-pack-progress', { done, total, failed });
  };

  async function processOne(appId: string): Promise<void> {
    if (fullPackCancelFlag) return;
    try {
      const zipBuffer = await downloadGameFromManifestHub(appId);
      if (!zipBuffer) { failed++; return; }
      const zip = new AdmZip(zipBuffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const fileName = path.basename(entry.entryName);
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.lua') {
          fs.writeFileSync(path.join(stplugInPath, fileName), entry.getData());
        } else if (ext === '.manifest') {
          fs.writeFileSync(path.join(depotcachePath, fileName), entry.getData());
        }
      }
    } catch {
      failed++;
    } finally {
      done++;
      if (done % 25 === 0 || done === total) sendProgress();
    }
  }

  async function worker(): Promise<void> {
    while (idx < appIds.length && !fullPackCancelFlag) {
      const appId = appIds[idx++];
      await processOne(appId);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  if (!fullPackCancelFlag) {
    try {
      const adultIds = await fetchAdultAppIds();
      const toTag = appIds.filter(id => adultIds.has(id));
      if (toTag.length > 0) {
        addGamesToSteamCollection(steamPath, toTag);
        console.log(`🔞 ${toTag.length} jogos categorizados como +18`);
      }
    } catch {}
    try { await restartSteam(steamPath); } catch {}
  }

  mainWindow?.webContents.send('full-pack-progress', { done, total, failed, finished: true });
  return { success: true, installed: done - failed, failed, canceled: fullPackCancelFlag };
});
// Buscar IDs de jogos adultos do Supabase
ipcMain.handle('fetch-adult-appids', async () => {
  const ids = await fetchAdultAppIds();
  return { success: true, appIds: Array.from(ids) };
});

// Sincronizar categorias +18 no Steam (fecha Steam, tag VDF, reabre)
// appIds vem direto do renderer (nsfwDatabase já filtrado por instalados)
ipcMain.handle('sync-adult-categories', async (_event, appIds: string[]) => {
  if (!Array.isArray(appIds) || appIds.length === 0) return { success: true, tagged: 0 };
  const steamPath = await detectSteamPath();
  if (!steamPath) return { success: false, error: 'Steam não encontrada' };
  try { await closeSteam(); } catch {}
  await new Promise(resolve => setTimeout(resolve, 1500));
  const tagged = addGamesToSteamCollection(steamPath, appIds);
  try { await restartSteam(steamPath); } catch {}
  return { success: true, tagged };
});

// ─────────────────────────────────────────────────────────────────────────────

// Baixar apenas os .manifest de uma DLC específica (não instala .lua do jogo base)
/**
 * Instala uma DLC específica:
 *  - Baixa o ZIP do JOGO BASE (baseGameAppId)
 *  - Extrai o .lua do jogo base → stplug-in/
 *  - Extrai APENAS o(s) .manifest cujo nome começa com dlcAppId → depotcache/
 */
ipcMain.handle('download-dlc-manifest', async (_, dlcAppId: string, baseGameAppId: string) => {
  try {
    console.log(`\n🧩 ====== INSTALANDO DLC ======`);
    console.log(`🧩 DLC AppID:       ${dlcAppId}`);
    console.log(`🧩 Jogo base AppID: ${baseGameAppId}`);

    const steamPath = await detectSteamPath();
    if (!steamPath) return { success: false, error: 'Steam não encontrada' };

    // Baixar ZIP do JOGO BASE (que contém o .lua do base + todos os .manifest incluindo os da DLC)
    console.log(`📥 Baixando ZIP do jogo base (${baseGameAppId})...`);
    const zipBuffer = await downloadGameFromManifestHub(baseGameAppId);
    if (!zipBuffer) {
      return { success: false, error: `Jogo base ${baseGameAppId} não encontrado no servidor.` };
    }
    console.log(`✅ ZIP baixado: ${zipBuffer.length} bytes`);

    const tempZipPath = path.join(os.tmpdir(), `dlc_${dlcAppId}_base${baseGameAppId}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);

    const zip = new AdmZip(tempZipPath);
    const zipEntries = zip.getEntries();

    // Log all files in zip for debugging
    console.log(`📦 Arquivos no ZIP (${zipEntries.length}):`);
    zipEntries.forEach(e => {
      if (!e.isDirectory) console.log(`   - ${path.basename(e.entryName)}`);
    });

    const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
    const depotcachePath = path.join(steamPath, 'config', 'depotcache');
    if (!fs.existsSync(stplugInPath)) fs.mkdirSync(stplugInPath, { recursive: true });
    if (!fs.existsSync(depotcachePath)) fs.mkdirSync(depotcachePath, { recursive: true });

    let luaInstalled = false;
    let manifestCount = 0;
    const installedFiles: string[] = [];

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();

      // 1. .lua do jogo base → sempre instalar
      if (ext === '.lua') {
        const dest = path.join(stplugInPath, fileName);
        fs.writeFileSync(dest, entry.getData());
        luaInstalled = true;
        installedFiles.push(`[LUA] ${fileName}`);
        console.log(`✅ .lua instalado: ${fileName}`);
      }

      // 2. .manifest que começa com o dlcAppId → instalar
      else if (ext === '.manifest' && fileName.startsWith(`${dlcAppId}_`)) {
        const dest = path.join(depotcachePath, fileName);
        fs.writeFileSync(dest, entry.getData());
        manifestCount++;
        installedFiles.push(`[MANIFEST] ${fileName}`);
        console.log(`✅ .manifest DLC instalado: ${fileName}`);
      }
    }

    fs.unlinkSync(tempZipPath);

    console.log(`\n🧩 ====== RESULTADO DLC ======`);
    console.log(`   .lua instalado:      ${luaInstalled}`);
    console.log(`   .manifest DLC:       ${manifestCount}`);
    console.log(`   Arquivos instalados: ${installedFiles.join(', ')}`);

    if (manifestCount === 0) {
      console.warn(`⚠️ Nenhum .manifest encontrado para DLC ${dlcAppId} no ZIP do jogo base ${baseGameAppId}`);
      return {
        success: false,
        error: `Manifests da DLC ${dlcAppId} não encontrados no pacote do jogo base.`,
        luaInstalled,
        manifestCount,
      };
    }

    // Reiniciar Steam para aplicar a DLC
    console.log(`♻️ Reiniciando Steam para aplicar DLC...`);
    try {
      await restartSteam(steamPath);
      console.log(`✅ Steam reiniciado com sucesso`);
    } catch (restartErr: any) {
      console.warn(`⚠️ Não foi possível reiniciar Steam automaticamente: ${restartErr.message}`);
    }

    return { success: true, luaInstalled, manifestCount, installedFiles };
  } catch (error: any) {
    console.error('❌ Erro ao instalar DLC:', error);
    return { success: false, error: error.message };
  }
});

// Solicitar adição de um jogo à base Ryuu (reseller request)
ipcMain.handle('request-game-ryuu', async (_, appId: string) => {
  console.log(`📨 Solicitando jogo AppID ${appId}`);
  try {
    if (!appId || !/^\d+$/.test(String(appId))) {
      return { success: false, error: 'Informe um AppID numérico válido.' };
    }

    const url = `https://generator.ryuu.lol/resellerrequest?appid=${appId}&auth_code=devguime`;
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(v) => v],
    });

    const rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    console.log(`📊 Status ${response.status} | Resposta processada`);

    const lower = rawBody.toLowerCase();
    const alreadyInDb = lower.includes('already in database') || lower.includes('already exists') || lower.includes('já está');

    return {
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      alreadyInDb,
    };
  } catch (error: any) {
    console.error('❌ Erro ao solicitar jogo:', error?.message || error);
    return { success: false, error: 'Não foi possível processar sua solicitação' };
  }
});

// Atualizar arquivos de um jogo já instalado. Requer que o .lua do appid já exista.
ipcMain.handle('update-game-files', async (_, appId: string) => {
  try {
    console.log(`♻️ Atualizando jogo AppID: ${appId}`);

    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
    const depotcachePath = path.join(steamPath, 'config', 'depotcache');
    const existingLua = path.join(stplugInPath, `${appId}.lua`);

    if (!fs.existsSync(existingLua)) {
      return {
        success: false,
        error: `Jogo ${appId} não está na sua conta Steam. Você só pode atualizar jogos que já estão na sua pasta Steam.`,
      };
    }

    const zipBuffer = await downloadGameFromManifestHub(appId);
    if (!zipBuffer) {
      return { success: false, error: 'Não foi possível baixar a atualização. O AppID pode estar incorreto ou indisponível.' };
    }

    const tempZipPath = path.join(os.tmpdir(), `update_${appId}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);

    const zip = new AdmZip(tempZipPath);
    const zipEntries = zip.getEntries();

    if (!fs.existsSync(stplugInPath)) fs.mkdirSync(stplugInPath, { recursive: true });
    if (!fs.existsSync(depotcachePath)) fs.mkdirSync(depotcachePath, { recursive: true });

    let luaCount = 0;
    let manifestCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.lua') {
        fs.writeFileSync(path.join(stplugInPath, fileName), entry.getData());
        luaCount++;
      } else if (ext === '.manifest') {
        fs.writeFileSync(path.join(depotcachePath, fileName), entry.getData());
        manifestCount++;
      }
    }

    fs.unlinkSync(tempZipPath);
    console.log(`✅ Atualização aplicada: ${luaCount} .lua, ${manifestCount} .manifest`);

    return { success: true, luaCount, manifestCount };
  } catch (error: any) {
    console.error('❌ Erro ao atualizar jogo:', error);
    return { success: false, error: error.message };
  }
});

// Reiniciar Steam manualmente (para bulk downloads)
ipcMain.handle('restart-steam', async (_, steamPath: string) => {
  try {
    console.log('🔄 Reiniciando Steam manualmente...');
    await restartSteam(steamPath);
    return { success: true };
  } catch (error: any) {
    console.error('❌ Erro ao reiniciar Steam:', error);
    return { success: false, error: error.message };
  }
});

// Remover jogo do stplug-in
ipcMain.handle('remove-game', async (_, appId: string) => {
  try {
    console.log(`🗑️ Removendo jogo AppID: ${appId}`);

    // Detectar Steam
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    // Caminho do arquivo .lua
    const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
    const luaFilePath = path.join(stplugInPath, `${appId}.lua`);

    // Verificar se o arquivo existe
    if (!fs.existsSync(luaFilePath)) {
      return { success: false, error: `Jogo ${appId} não encontrado. Verifique se o ID está correto.` };
    }

    // Remover arquivo .lua (Steam não precisa ser fechada)
    fs.unlinkSync(luaFilePath);
    console.log(`✅ Arquivo removido: ${appId}.lua`);

    return { success: true };
  } catch (error: any) {
    console.error('❌ Erro ao remover jogo:', error);
    return { success: false, error: error.message };
  }
});

// Listar jogos instalados pelo launcher (stplug-in/*.lua cross-ref com steamapps)
ipcMain.handle('get-my-games', async () => {
  try {
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada', games: [] };
    }

    // Lê appids instalados pelo launcher (arquivos .lua em stplug-in)
    const stplugInPath = path.join(steamPath, 'config', 'stplug-in');
    let luaAppIds: Set<string> = new Set();
    if (fs.existsSync(stplugInPath)) {
      const luaFiles = fs.readdirSync(stplugInPath).filter(f => f.endsWith('.lua'));
      for (const f of luaFiles) {
        const id = f.replace('.lua', '');
        if (/^\d+$/.test(id)) luaAppIds.add(id);
      }
    }

    if (luaAppIds.size === 0) {
      return { success: true, games: [] };
    }

    // Lê manifests do Steam para obter nomes instalados
    const steamappsPath = path.join(steamPath, 'steamapps');
    const nameMap: Record<string, string> = {};
    if (fs.existsSync(steamappsPath)) {
      const acfFiles = fs.readdirSync(steamappsPath).filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf'));
      for (const acf of acfFiles) {
        try {
          const content = fs.readFileSync(path.join(steamappsPath, acf), 'utf-8');
          const appidMatch = content.match(/"appid"\s+"(\d+)"/);
          const nameMatch = content.match(/"name"\s+"([^"]+)"/);
          if (appidMatch && nameMatch) {
            nameMap[appidMatch[1]] = nameMatch[1];
          }
        } catch (_) { /* skip unreadable acf */ }
      }
    }

    const games = Array.from(luaAppIds).map(appid => ({
      appid,
      name: nameMap[appid] || null,
    }));

    return { success: true, games };
  } catch (error: any) {
    console.error('❌ Erro ao listar jogos instalados:', error);
    return { success: false, error: error.message, games: [] };
  }
});

// Abrir URL no navegador externo
ipcMain.handle('open-external-url', async (_, url: string) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error: any) {
    console.error('❌ Erro ao abrir URL:', error);
    return { success: false, error: error.message };
  }
});

// Download seguro de arquivos com dialog de salvamento
ipcMain.handle('download-file-with-dialog', async (_, url: string, suggestedName: string) => {
  console.log(`\n📥 === INICIANDO DOWNLOAD ===`);
  console.log(`📥 Nome sugerido: ${suggestedName}`);
  console.log(`📥 URL: ${url}`);

  try {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'URL inválida ou vazia.' };
    }

    const lowerUrl = url.toLowerCase();

    // Mega.nz não é baixável via HTTP direto (usa API JS proprietária + criptografia).
    if (lowerUrl.includes('mega.nz') || lowerUrl.includes('mega.co.nz')) {
      console.log('⚠️ Link Mega.nz detectado - abrindo no navegador');
      await shell.openExternal(url);
      return {
        success: false,
        error: 'Links do Mega.nz não podem ser baixados diretamente. Abri o link no seu navegador — baixe de lá.',
      };
    }

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Salvar arquivo',
      defaultPath: suggestedName,
      filters: [
        { name: 'Arquivos compactados', extensions: ['zip', 'rar', '7z'] },
        { name: 'Executáveis', extensions: ['exe'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) {
      console.log('❌ Download cancelado pelo usuário');
      return { success: false, canceled: true };
    }

    console.log(`📂 Destino: ${filePath}`);

    let response;
    try {
      response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 300000,
        maxRedirects: 10,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        },
        onDownloadProgress: (progressEvent) => {
          const total = progressEvent.total || progressEvent.loaded;
          const percent = total ? Math.round((progressEvent.loaded * 100) / total) : 0;
          mainWindow?.webContents.send('download-progress', {
            fileName: suggestedName,
            progress: percent,
          });
        },
      });
    } catch (requestErr: any) {
      const code = requestErr?.code || '';
      const status = requestErr?.response?.status;
      console.error(`❌ Falha na requisição: code=${code} status=${status} msg=${requestErr?.message}`);
      return {
        success: false,
        error: `Falha ao conectar ao link (${code || status || 'erro de rede'}): ${requestErr?.message || 'desconhecido'}`,
      };
    }

    const finalUrl = response.request?.res?.responseUrl || url;
    const contentType = String(response.headers['content-type'] || '');
    const contentLength = response.headers['content-length'];
    console.log(`📊 status=${response.status} | final=${finalUrl}`);
    console.log(`📄 Content-Type: ${contentType} | Content-Length: ${contentLength || '?'}`);

    if (contentType.toLowerCase().includes('text/html')) {
      try { response.data.destroy?.(); } catch {}
      return {
        success: false,
        error: 'O link retornou uma página HTML. Abra o link no navegador para baixar manualmente.',
      };
    }

    return await new Promise<{ success: boolean; filePath?: string; error?: string }>((resolve) => {
      const writer = fs.createWriteStream(filePath);
      let settled = false;
      const settle = (result: { success: boolean; filePath?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      response.data.on('error', (err: Error) => {
        console.error(`❌ Erro no stream de resposta: ${err.message}`);
        try { writer.destroy(); } catch {}
        fs.unlink(filePath, () => {});
        settle({ success: false, error: `Erro no download: ${err.message}` });
      });

      writer.on('error', (err: Error) => {
        console.error(`❌ Erro ao gravar arquivo: ${err.message}`);
        try { response.data.destroy?.(); } catch {}
        fs.unlink(filePath, () => {});
        settle({ success: false, error: `Erro ao salvar: ${err.message}` });
      });

      writer.on('finish', () => {
        console.log(`✅ Download concluído: ${filePath}`);
        settle({ success: true, filePath });
      });

      response.data.pipe(writer);
    });
  } catch (error: any) {
    console.error('❌ Erro inesperado no download:', error?.message || error);
    return { success: false, error: error?.message || 'Erro desconhecido no download.' };
  }
});

// Garantir que xinput1_4.dll está presente (copiar de assets se necessário)
ipcMain.handle('ensure-hid-dll', async () => {
  // Executar com timeout de 10 segundos para evitar travamento
  return Promise.race([
    (async () => {
      try {
        console.log('🔍 === INICIANDO VERIFICAÇÃO DE xinput1_4.dll ===');

        // Detectar Steam
        const steamPath = await detectSteamPath();
        console.log('📂 Steam path detectado:', steamPath);

        if (!steamPath) {
          console.error('❌ Steam NÃO encontrada!');
          return { success: false, error: 'Steam não encontrada' };
        }

        const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
        const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

        console.log('📍 Caminhos calculados:');
        console.log('  - xinput1_4.dll:', hidDllPath);
        console.log('  - xinput1_4.dll.disabled:', hidDllDisabled);

        // Se já existe xinput1_4.dll ativo, ok
        if (fs.existsSync(hidDllPath)) {
          console.log('✅ xinput1_4.dll JÁ EXISTE no caminho:', hidDllPath);
          // ANTI-BURLA: Marcar DLL como esperada e calcular hash
          dllExpectedActive = true;
          originalDllHash = calculateFileHash(hidDllPath);
          return { success: true };
        }
        console.log('⚠️ xinput1_4.dll NÃO existe em:', hidDllPath);

        // Se existe .disabled, renomear
        if (fs.existsSync(hidDllDisabled)) {
          console.log('🔄 Encontrado xinput1_4.dll.disabled, renomeando...');
          try {
            fs.renameSync(hidDllDisabled, hidDllPath);
            console.log('✅ xinput1_4.dll.disabled → xinput1_4.dll');
            // ANTI-BURLA: Marcar DLL como esperada e calcular hash
            dllExpectedActive = true;
            originalDllHash = calculateFileHash(hidDllPath);
            return { success: true };
          } catch (renameError: any) {
            console.error('⚠️ Erro ao renomear .disabled:', renameError.message);
            // Continuar tentando copiar de assets
          }
        }
        console.log('⚠️ xinput1_4.dll.disabled TAMBÉM NÃO existe ou erro ao renomear');

        // Se não existe nenhum, copiar de assets
        const isDev = process.env.NODE_ENV === 'development';
        let assetsPath: string;
        
        if (isDev) {
          // Em desenvolvimento, procurar em dist/assets e assets
          const distAssetsPath = path.join(process.cwd(), 'dist', 'assets');
          const srcAssetsPath = path.join(process.cwd(), 'assets');
          assetsPath = fs.existsSync(distAssetsPath) ? distAssetsPath : srcAssetsPath;
        } else {
          // Em produção, procurar em múltiplos locais possíveis
          // Ordem de prioridade: asarUnpack > resources > app > root
          const asarUnpackAssets = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');
          const resourcesAssets = path.join(process.resourcesPath, 'assets');
          const appAssetsPath = path.join(process.resourcesPath, '..', '..', 'assets');
          const rootAssetsPath = path.join(process.resourcesPath, '..', 'assets');
          
          // Tentar na ordem de prioridade
          if (fs.existsSync(path.join(asarUnpackAssets, 'xinput1_4.dll'))) {
            assetsPath = asarUnpackAssets;
            console.log('✅ Assets encontrado em app.asar.unpacked');
          } else if (fs.existsSync(path.join(resourcesAssets, 'xinput1_4.dll'))) {
            assetsPath = resourcesAssets;
            console.log('✅ Assets encontrado em resources');
          } else if (fs.existsSync(path.join(appAssetsPath, 'xinput1_4.dll'))) {
            assetsPath = appAssetsPath;
            console.log('✅ Assets encontrado em app path');
          } else if (fs.existsSync(path.join(rootAssetsPath, 'xinput1_4.dll'))) {
            assetsPath = rootAssetsPath;
            console.log('✅ Assets encontrado em root');
          } else {
            assetsPath = asarUnpackAssets; // Default, vai falhar com mensagem clara
            console.log('⚠️ Assets não encontrado em nenhum local padrão, usando:', assetsPath);
          }
        }

        console.log('📦 Modo:', isDev ? 'DESENVOLVIMENTO' : 'PRODUÇÃO');
        console.log('📦 Assets path:', assetsPath);

        const hidDllSource = path.join(assetsPath, 'xinput1_4.dll');
        console.log('📦 Source xinput1_4.dll:', hidDllSource);
        console.log('📦 Source existe?', fs.existsSync(hidDllSource));

        if (fs.existsSync(hidDllSource)) {
          console.log('📋 Copiando de:', hidDllSource);
          console.log('📋 Para:', hidDllPath);
          
          try {
            // Usar copyFile assíncrono com callback para evitar travamento
            await new Promise<void>((resolve, reject) => {
              fs.copyFile(hidDllSource, hidDllPath, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
            
            console.log('✅ CÓPIA CONCLUÍDA!');

            // Verificar se realmente foi copiado
            if (fs.existsSync(hidDllPath)) {
              const stats = fs.statSync(hidDllPath);
              console.log('✅ Arquivo CONFIRMADO no destino! Tamanho:', stats.size, 'bytes');
            } else {
              console.error('❌ ERRO: Arquivo NÃO apareceu no destino após cópia!');
            }

            // ANTI-BURLA: Marcar DLL como esperada e calcular hash
            dllExpectedActive = true;
            originalDllHash = calculateFileHash(hidDllPath);
            return { success: true };
          } catch (copyError: any) {
            console.error('❌ Erro ao copiar xinput1_4.dll:', copyError.message);
            console.error('Stack:', copyError.stack);
            // Retornar sucesso mesmo com erro (para não bloquear o app)
            console.log('⚠️ Continuando mesmo com erro na cópia (permissão ou arquivo em uso)');
            return { success: true, warning: 'DLL pode não estar disponível, mas continuando...' };
          }
        } else {
          console.error('❌ Source xinput1_4.dll NÃO EXISTE em:', hidDllSource);
          console.error('❌ Listando conteúdo de assets:');
          try {
            const files = fs.readdirSync(assetsPath);
            console.error('  Arquivos:', files.join(', '));
          } catch (e) {
            console.error('  Erro ao listar:', e);
          }
          // Retornar sucesso mesmo se DLL não for encontrada (para não bloquear)
          console.log('⚠️ Arquivo não encontrado, continuando mesmo assim...');
          return { success: true, warning: 'Arquivo de sistema não encontrado, mas continuando...' };
        }
      } catch (error: any) {
        console.error('❌ ERRO CRÍTICO ao garantir xinput1_4.dll:', error);
        console.error('Stack:', error.stack);
        // Retornar sucesso mesmo com erro crítico (para não bloquear o app)
        return { success: true, warning: 'Erro ao processar DLL, mas continuando...' };
      }
    })(),
    new Promise(resolve => 
      setTimeout(() => {
        console.warn('⚠️ Timeout na verificação de xinput1_4.dll (10s), continuando mesmo assim...');
        resolve({ success: true, warning: 'Timeout na verificação de DLL' });
      }, 10000)
    )
  ]);
});

// ============================================================
// DEPOTBOX API HANDLERS
// ============================================================

/**
 * Download file from DepotBox and extract to Steam directory
 * This handles the completed download from DepotBox API
 */
ipcMain.handle('depotbox-download-and-extract', async (_, downloadUrl: string, appId: string, gameName: string) => {
  try {
    console.log('📦 [DepotBox] Iniciando download:', gameName, `(${appId})`);

    // Detect Steam path
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    // Close Steam before extraction
    console.log('🛑 Fechando Steam...');
    await closeSteam();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Download the ZIP file from DepotBox
    console.log('⬇️ Baixando arquivo ZIP do DepotBox...');
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      headers: {
        'X-API-Key': process.env.DEPOTBOX_API_KEY || '',
      },
      responseType: 'arraybuffer',
      timeout: 600000, // 10 minutes timeout
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          mainWindow?.webContents.send('depotbox-download-progress', {
            appId,
            percent: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        }
      },
    });

    console.log('✅ Download concluído, extraindo arquivos...');

    // Create temp directory for extraction
    const tempDir = path.join(os.tmpdir(), `depotbox-${appId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save ZIP to temp
    const zipPath = path.join(tempDir, `${appId}.zip`);
    fs.writeFileSync(zipPath, Buffer.from(response.data));

    // Extract ZIP
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    console.log(`📂 Extraindo ${zipEntries.length} arquivos...`);

    let luaCount = 0;
    let manifestCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const fileName = entry.entryName.split('/').pop() || entry.entryName;
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.lua') {
        // Extract .lua to Steam/config/stplug-in/
        const destDir = path.join(steamPath, 'config', 'stplug-in');
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, fileName);
        fs.writeFileSync(destPath, entry.getData());
        luaCount++;
        console.log(`  ✅ .lua → ${destPath}`);
      } else if (ext === '.manifest') {
        // Extract .manifest to Steam/config/depotcache/
        const destDir = path.join(steamPath, 'config', 'depotcache');
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, fileName);
        fs.writeFileSync(destPath, entry.getData());
        manifestCount++;
        console.log(`  ✅ .manifest → ${destPath}`);
      }
    }

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`✅ [DepotBox] Extração concluída: ${luaCount} .lua, ${manifestCount} .manifest`);

    // Restart Steam
    console.log('🔄 Reiniciando Steam...');
    await restartSteam(steamPath);

    return {
      success: true,
      filesExtracted: {
        lua: luaCount,
        manifest: manifestCount,
      },
    };
  } catch (error: any) {
    console.error('❌ [DepotBox] Erro:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Download and extract multiple games from DepotBox (batch)
 */
ipcMain.handle('depotbox-batch-download-and-extract', async (_, downloadUrl: string, appIds: string[], _gameNames: Record<string, string>) => {
  try {
    console.log('📦 [DepotBox] Iniciando download em lote:', appIds.length, 'jogos');

    // Detect Steam path
    const steamPath = await detectSteamPath();
    if (!steamPath) {
      return { success: false, error: 'Steam não encontrada' };
    }

    // Close Steam before extraction
    console.log('🛑 Fechando Steam...');
    await closeSteam();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Download the batch ZIP file from DepotBox
    console.log('⬇️ Baixando arquivo ZIP em lote do DepotBox...');
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      headers: {
        'X-API-Key': process.env.DEPOTBOX_API_KEY || '',
      },
      responseType: 'arraybuffer',
      timeout: 1800000, // 30 minutes timeout for batch
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          mainWindow?.webContents.send('depotbox-download-progress', {
            appIds,
            percent: percentCompleted,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        }
      },
    });

    console.log('✅ Download concluído, extraindo arquivos...');

    // Create temp directory for extraction
    const tempDir = path.join(os.tmpdir(), `depotbox-batch-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save ZIP to temp
    const zipPath = path.join(tempDir, 'batch.zip');
    fs.writeFileSync(zipPath, Buffer.from(response.data));

    // Extract ZIP
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    console.log(`📂 Extraindo ${zipEntries.length} arquivos...`);

    let luaCount = 0;
    let manifestCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const fileName = entry.entryName.split('/').pop() || entry.entryName;
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.lua') {
        const destDir = path.join(steamPath, 'config', 'stplug-in');
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, fileName);
        fs.writeFileSync(destPath, entry.getData());
        luaCount++;
      } else if (ext === '.manifest') {
        const destDir = path.join(steamPath, 'config', 'depotcache');
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, fileName);
        fs.writeFileSync(destPath, entry.getData());
        manifestCount++;
      }
    }

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`✅ [DepotBox] Extração em lote concluída: ${luaCount} .lua, ${manifestCount} .manifest`);

    // Restart Steam
    console.log('🔄 Reiniciando Steam...');
    await restartSteam(steamPath);

    return {
      success: true,
      filesExtracted: {
        lua: luaCount,
        manifest: manifestCount,
      },
    };
  } catch (error: any) {
    console.error('❌ [DepotBox] Erro no download em lote:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================
// AUTO-UPDATE IPC HANDLERS
// ============================================================

ipcMain.handle('restart-and-update', async () => {
  try {
    console.log('🔄 Reiniciando para instalar atualização...');

    // CRITICAL: Disable DLL before restarting
    const steamPath = await detectSteamPath();
    if (steamPath) {
      await disableHidDll(steamPath);
      console.log('✅ DLL desabilitada antes de atualização');
    }

    stopDllIntegrityMonitoring();
    autoUpdater.quitAndInstall(false, true);

    return { success: true };
  } catch (error: any) {
    console.error('❌ Erro ao reiniciar:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return { version: app.getVersion() };
});

ipcMain.handle('check-for-updates-manually', async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } else {
      return { success: false, error: 'Desabilitado em desenvolvimento' };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
