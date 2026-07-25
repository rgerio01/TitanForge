import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';
import { cacheManager } from './cache';

const execAsync = promisify(exec);

/**
 * Fecha o processo Steam se estiver em execução
 */
export async function closeSteam(): Promise<void> {
  try {
    console.log('Verificando se Steam está em execução...');
    await execAsync('taskkill /IM steam.exe /F');
    console.log('Steam fechada com sucesso');
    // Aguardar 2 segundos para garantir que o processo foi fechado
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    // Se o processo não existir, taskkill retorna erro - isso é ok
    console.log('Steam não estava em execução ou já foi fechada');
  }
}

/**
 * Abre o Steam
 */
export async function openSteam(steamPath: string): Promise<void> {
  try {
    console.log('Abrindo Steam...');
    const steamExePath = path.join(steamPath, 'steam.exe');
    exec(`"${steamExePath}"`);
    console.log('Steam iniciada');
  } catch (error) {
    console.error('Erro ao abrir Steam:', error);
  }
}

/**
 * Abre Steam Big Picture Mode
 * Copia arquivos do cache para Steam antes de abrir
 */
export async function openSteamBigPicture(
  steamPath: string,
  mainWindow: BrowserWindow | null
): Promise<void> {
  try {
    console.log('🎮 Preparando para abrir Steam Big Picture...');

    // Enviar status: Verificando arquivos
    if (mainWindow) {
      mainWindow.webContents.send('steam-status', 'Verificando arquivos...');
    }

    // Verificar se tem arquivos em cache
    if (!cacheManager) {
      throw new Error('Cache manager not initialized');
    }

    if (cacheManager.hasCachedFiles()) {
      console.log('📋 Copiando arquivos do cache para Steam...');
      if (mainWindow) {
        mainWindow.webContents.send('steam-status', 'Copiando arquivos...');
      }

      // Fechar Steam antes de copiar arquivos
      await closeSteam();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Copiar do cache para Steam
      await cacheManager.copyCachedFilesToSteam(steamPath);
    } else {
      console.log('⚠️ Nenhum arquivo em cache - usuário precisa instalar um pack primeiro');
      throw new Error('Nenhum pack instalado. Instale um pack primeiro.');
    }

    // Enviar status: Abrindo Steam
    if (mainWindow) {
      mainWindow.webContents.send('steam-status', 'Abrindo Steam...');
    }

    // Abrir Steam em Big Picture
    console.log('🎮 Abrindo Steam Big Picture Mode...');
    const steamExePath = path.join(steamPath, 'steam.exe');
    exec(`"${steamExePath}" -bigpicture`);

    // Aguardar 2 segundos e enviar conclusão
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (mainWindow) {
      mainWindow.webContents.send('steam-opened');
    }

    console.log('✅ Steam Big Picture aberta com sucesso');
  } catch (error) {
    console.error('❌ Erro ao abrir Steam Big Picture:', error);
    if (mainWindow) {
      mainWindow.webContents.send('steam-error', error instanceof Error ? error.message : 'Erro desconhecido');
    }
    throw error;
  }
}

/**
 * Detecta todos os drives lógicos disponíveis no sistema
 */
function getAllLogicalDrives(): string[] {
  const drives: string[] = [];

  // Verificar drives de A a Z
  for (let charCode = 65; charCode <= 90; charCode++) {
    const driveLetter = String.fromCharCode(charCode);
    const drivePath = `${driveLetter}:\\`;

    try {
      if (fs.existsSync(drivePath)) {
        drives.push(drivePath);
      }
    } catch (error) {
      // Drive inacessível ou não montado
      continue;
    }
  }

  console.log(`✓ Drives detectados: ${drives.join(', ')}`);
  return drives;
}

/**
 * Detecta Steam SINCRONAMENTE (caminhos comuns + varredura de drives)
 * Para uso emergencial (Task Manager)
 */
export function detectSteamPathSync(): string | null {
  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ];

  // Verifica caminhos comuns primeiro (otimização)
  for (const steamPath of commonPaths) {
    if (fs.existsSync(steamPath) && fs.existsSync(path.join(steamPath, 'steam.exe'))) {
      console.log('✓ Steam encontrada (SYNC) em:', steamPath);
      return steamPath;
    }
  }

  // Varrer todos os drives
  const allDrives = getAllLogicalDrives();

  for (const drive of allDrives) {
    // Verificar na raiz do drive
    const steamPath = path.join(drive, 'Steam');
    if (fs.existsSync(steamPath) && fs.existsSync(path.join(steamPath, 'steam.exe'))) {
      console.log(`✓ Steam encontrada (SYNC) em drive ${drive}:`, steamPath);
      return steamPath;
    }

    // Verificar em Program Files (x86) do drive
    const programFiles86 = path.join(drive, 'Program Files (x86)', 'Steam');
    if (fs.existsSync(programFiles86) && fs.existsSync(path.join(programFiles86, 'steam.exe'))) {
      console.log(`✓ Steam encontrada (SYNC) em Program Files (x86) do drive ${drive}`);
      return programFiles86;
    }
  }

  console.log('❌ Steam não encontrada (SYNC)');
  return null;
}

/**
 * Detecta automaticamente o diretório de instalação da Steam
 * Verifica caminhos comuns, todos os drives (A-Z) e o registro do Windows
 * RETORNA NULL se não encontrar (não rejeita promise)
 */
export async function detectSteamPath(): Promise<string | null> {
  console.log('🔍 Iniciando detecção da Steam...');

  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ];

  // 1. Verificar caminhos comuns primeiro (otimização)
  for (const steamPath of commonPaths) {
    if (fs.existsSync(steamPath) && fs.existsSync(path.join(steamPath, 'steam.exe'))) {
      console.log('✓ Steam encontrada (caminho comum):', steamPath);
      return steamPath;
    }
  }

  // 2. Varrer todos os drives lógicos
  const allDrives = getAllLogicalDrives();

  for (const drive of allDrives) {
    // Verificar na raiz do drive
    const steamPath = path.join(drive, 'Steam');
    const steamExePath = path.join(steamPath, 'steam.exe');

    if (fs.existsSync(steamPath) && fs.existsSync(steamExePath)) {
      console.log(`✓ Steam encontrada em drive ${drive}:`, steamPath);
      return steamPath;
    }

    // Verificar também em Program Files (x86) no drive
    const programFiles86 = path.join(drive, 'Program Files (x86)', 'Steam');
    if (fs.existsSync(programFiles86) && fs.existsSync(path.join(programFiles86, 'steam.exe'))) {
      console.log(`✓ Steam encontrada em Program Files (x86) do drive ${drive}`);
      return programFiles86;
    }

    // Verificar em Program Files no drive
    const programFiles = path.join(drive, 'Program Files', 'Steam');
    if (fs.existsSync(programFiles) && fs.existsSync(path.join(programFiles, 'steam.exe'))) {
      console.log(`✓ Steam encontrada em Program Files do drive ${drive}`);
      return programFiles;
    }
  }

  // 3. Fallback: Verificar Registry do Windows
  try {
    const regedit = require('regedit');

    return new Promise((resolve) => {
      regedit.list('HKCU\\Software\\Valve\\Steam', (err: any, result: any) => {
        if (err) {
          console.log('❌ Steam não encontrada no registro');
          resolve(null);
          return;
        }

        const steamPath = result['HKCU\\Software\\Valve\\Steam']?.values?.SteamPath?.value;

        if (steamPath && fs.existsSync(steamPath)) {
          console.log('✓ Steam encontrada via registro:', steamPath);
          resolve(steamPath);
        } else {
          console.log('❌ Caminho da Steam inválido no registro');
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.log('❌ Erro ao acessar registro:', error);
    return null;
  }
}

/**
 * Instala os arquivos baixados na pasta da Steam
 * Extrai ARENA.zip, salva no cache local e copia para Steam
 */
export async function installSteamFiles(downloadPath: string, steamPath: string): Promise<void> {
  try {
    console.log('📦 Iniciando instalação dos arquivos...');
    console.log('Download path:', downloadPath);
    console.log('Steam path:', steamPath);

    if (!cacheManager) {
      throw new Error('Cache manager not initialized');
    }

    // Fechar Steam antes de instalar
    await closeSteam();

    // 1. SALVAR NO CACHE LOCAL (persistente)
    console.log('💾 Salvando arquivos no cache local...');
    await cacheManager.saveToCacheFromZip(downloadPath);
    console.log('✅ Arquivos salvos no cache!');

    // 2. COPIAR DO CACHE PARA STEAM
    console.log('📋 Copiando arquivos do cache para Steam...');
    await cacheManager.copyCachedFilesToSteam(steamPath);
    console.log('✅ Arquivos copiados para Steam!');

    console.log('✅ Instalação concluída com sucesso!');

    // Abrir Steam novamente
    await openSteam(steamPath);
  } catch (error) {
    console.error('❌ Erro durante instalação:', error);
    throw error;
  }
}

/**
 * Remove os arquivos instalados da Steam (quando licença ficar inativa)
 * FECHA A STEAM ANTES de remover os arquivos
 */
export async function cleanupSteamFiles(steamPath: string): Promise<void> {
  try {
    console.log('🧹 Iniciando limpeza dos arquivos da Steam...');

    // FECHAR STEAM PRIMEIRO - CRÍTICO para liberar xinput1_4.dll
    console.log('🛑 Fechando Steam antes de remover arquivos...');
    await closeSteam();

    // Aguardar 3 segundos para garantir que Steam fechou completamente
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Remover xinput1_4.dll
    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    if (fs.existsSync(hidDllPath)) {
      try {
        fs.unlinkSync(hidDllPath);
        console.log('✅ xinput1_4.dll removido');
      } catch (error) {
        console.error('❌ Erro ao remover xinput1_4.dll (pode estar em uso):', error);
        // Tentar forçar com PowerShell
        try {
          const { execSync } = require('child_process');
          execSync(`powershell -Command "Remove-Item -Path '${hidDllPath}' -Force"`, { timeout: 5000 });
          console.log('✅ xinput1_4.dll removido com PowerShell');
        } catch (psError) {
          console.error('❌ Falha ao remover xinput1_4.dll mesmo com PowerShell:', psError);
        }
      }
    } else {
      console.log('ℹ️ xinput1_4.dll não encontrada (já foi removida?)');
    }

    // Remover depotcache
    const depotcachePath = path.join(steamPath, 'config', 'depotcache');
    if (fs.existsSync(depotcachePath)) {
      fs.rmSync(depotcachePath, { recursive: true, force: true });
      console.log('✅ depotcache removido');
    } else {
      console.log('ℹ️ depotcache não encontrada');
    }

    // Remover stplug-in
    const stpluginPath = path.join(steamPath, 'config', 'stplug-in');
    if (fs.existsSync(stpluginPath)) {
      fs.rmSync(stpluginPath, { recursive: true, force: true });
      console.log('✅ stplug-in removido');
    } else {
      console.log('ℹ️ stplug-in não encontrada');
    }

    console.log('✅ Limpeza concluída com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante limpeza:', error);
    // NÃO REJEITA - apenas loga o erro
  }
}

/**
 * Desabilita xinput1_4.dll renomeando para .disabled (VERSÃO SÍNCRONA)
 * Para uso emergencial quando app está sendo morto (Task Manager)
 */
export function disableHidDllSync(steamPath: string): void {
  try {
    console.log('🚨 EMERGÊNCIA: Desabilitando xinput1_4.dll IMEDIATAMENTE...');

    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

    // Renomear IMEDIATAMENTE sem fechar Steam
    if (fs.existsSync(hidDllPath)) {
      fs.renameSync(hidDllPath, hidDllDisabled);
      console.log('✅ xinput1_4.dll → xinput1_4.dll.disabled (SYNC)');
    } else {
      console.log('ℹ️ xinput1_4.dll já está desabilitada');
    }
  } catch (error) {
    console.error('❌ Erro ao desabilitar xinput1_4.dll (SYNC):', error);
  }
}

/**
 * Desabilita xinput1_4.dll renomeando para .disabled
 * Steam não carrega DLLs com extensão diferente
 */
export async function disableHidDll(steamPath: string): Promise<void> {
  try {
    console.log('🔒 Desabilitando xinput1_4.dll...');

    // Fechar Steam primeiro
    await closeSteam();
    await new Promise(resolve => setTimeout(resolve, 2000));

    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

    // Se xinput1_4.dll existe, renomear
    if (fs.existsSync(hidDllPath)) {
      fs.renameSync(hidDllPath, hidDllDisabled);
      console.log('✅ xinput1_4.dll → xinput1_4.dll.disabled');
    } else {
      console.log('ℹ️ xinput1_4.dll já está desabilitada');
    }
  } catch (error) {
    console.error('❌ Erro ao desabilitar xinput1_4.dll:', error);
  }
}

/**
 * Habilita xinput1_4.dll renomeando de .disabled
 */
export async function enableHidDll(steamPath: string): Promise<void> {
  try {
    console.log('🔓 Habilitando xinput1_4.dll...');

    const hidDllPath = path.join(steamPath, 'xinput1_4.dll');
    const hidDllDisabled = path.join(steamPath, 'xinput1_4.dll.disabled');

    // Se .disabled existe, renomear para .dll
    if (fs.existsSync(hidDllDisabled)) {
      fs.renameSync(hidDllDisabled, hidDllPath);
      console.log('✅ xinput1_4.dll.disabled → xinput1_4.dll');
    } else if (fs.existsSync(hidDllPath)) {
      console.log('✅ xinput1_4.dll já está habilitada');
    } else {
      console.log('⚠️ Nenhum arquivo encontrado - cache será usado');
    }
  } catch (error) {
    console.error('❌ Erro ao habilitar xinput1_4.dll:', error);
  }
}

/**
 * Reinicia a Steam (fecha e abre novamente)
 */
export async function restartSteam(steamPath: string): Promise<void> {
  try {
    console.log('🔄 Reiniciando Steam...');
    await closeSteam();
    await new Promise(resolve => setTimeout(resolve, 3000)); // Aguardar 3s
    await openSteam(steamPath);
    console.log('✅ Steam reiniciada');
  } catch (error) {
    console.error('❌ Erro ao reiniciar Steam:', error);
    throw error;
  }
}
