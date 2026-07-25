import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import extract from 'extract-zip';

/**
 * CacheManager - Gerencia o cache local dos arquivos da Steam
 * Armazena arquivos em %APPDATA%\Vortex Launcher\cache\steam-files\
 */
export class CacheManager {
  private cacheDir: string | null = null;
  private steamFilesDir: string | null = null;

  constructor() {
    // Não inicializar aqui - paths serão inicializados lazy
    // app.getPath() só funciona após app.whenReady()
  }

  /**
   * Inicializa os caminhos do cache (lazy initialization)
   * Só chama app.getPath() quando realmente necessário
   */
  private initializePaths(): void {
    if (this.cacheDir) return; // Já inicializado

    // %APPDATA%\Vortex Launcher\cache\steam-files\
    this.cacheDir = path.join(app.getPath('userData'), 'cache');
    this.steamFilesDir = path.join(this.cacheDir, 'steam-files');
  }

  /**
   * Garante que o diretório de cache existe
   */
  async ensureCacheDirectory(): Promise<void> {
    this.initializePaths(); // ✅ Inicializa paths primeiro

    if (!this.cacheDir || !this.steamFilesDir) {
      throw new Error('Cache paths not initialized');
    }

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      console.log('📁 Diretório de cache criado:', this.cacheDir);
    }

    if (!fs.existsSync(this.steamFilesDir)) {
      fs.mkdirSync(this.steamFilesDir, { recursive: true });
      console.log('📁 Diretório steam-files criado:', this.steamFilesDir);
    }
  }

  /**
   * Verifica se os arquivos já estão em cache
   */
  hasCachedFiles(): boolean {
    this.initializePaths(); // ✅ Inicializa paths primeiro

    if (!this.steamFilesDir) return false;

    const xinputDllPath = path.join(this.steamFilesDir, 'xinput1_4.dll');
    const configPath = path.join(this.steamFilesDir, 'config');
    const depotCachePath = path.join(configPath, 'depotcache');
    const stplugInPath = path.join(configPath, 'stplug-in');

    const hasXinputDll = fs.existsSync(xinputDllPath);
    const hasDepotCache = fs.existsSync(depotCachePath);
    const hasStplugIn = fs.existsSync(stplugInPath);

    console.log('🔍 Verificando cache:');
    console.log('  - xinput1_4.dll:', hasXinputDll);
    console.log('  - config/depotcache:', hasDepotCache);
    console.log('  - config/stplug-in:', hasStplugIn);

    return hasXinputDll && hasDepotCache && hasStplugIn;
  }

  /**
   * Copia arquivos do cache para o diretório da Steam
   */
  async copyCachedFilesToSteam(steamPath: string): Promise<void> {
    this.initializePaths(); // ✅ Inicializa paths primeiro
    console.log('📋 Copiando arquivos do cache para Steam...');

    await this.ensureCacheDirectory();

    if (!this.hasCachedFiles()) {
      throw new Error('Arquivos não encontrados no cache');
    }

    if (!this.steamFilesDir) {
      throw new Error('Steam files directory not initialized');
    }

    // Use local variable to help TypeScript understand it's non-null
    const steamFilesDir = this.steamFilesDir;

    // Garantir que pasta config existe na Steam
    const steamConfigPath = path.join(steamPath, 'config');
    if (!fs.existsSync(steamConfigPath)) {
      fs.mkdirSync(steamConfigPath, { recursive: true });
    }

    const filesToCopy = [
      {
        src: path.join(steamFilesDir, 'xinput1_4.dll'),
        dest: path.join(steamPath, 'xinput1_4.dll'),
      },
    ];

    const foldersToSync = [
      {
        src: path.join(steamFilesDir, 'config', 'depotcache'),
        dest: path.join(steamPath, 'config', 'depotcache'),
      },
      {
        src: path.join(steamFilesDir, 'config', 'stplug-in'),
        dest: path.join(steamPath, 'config', 'stplug-in'),
      },
    ];

    // Copiar xinput1_4.dll
    for (const { src, dest } of filesToCopy) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`  ✅ Copiado: ${path.basename(src)}`);
      }
    }

    // Sincronizar pastas
    for (const { src, dest } of foldersToSync) {
      if (fs.existsSync(src)) {
        this.syncDirectory(src, dest);
        console.log(`  ✅ Sincronizado: ${path.basename(src)}`);
      }
    }

    console.log('✅ Arquivos copiados do cache para Steam');
  }

  /**
   * Salva arquivos extraídos do ZIP para o cache
   */
  async saveToCacheFromZip(zipPath: string): Promise<void> {
    this.initializePaths(); // ✅ Inicializa paths primeiro
    console.log('💾 Salvando arquivos no cache...');

    await this.ensureCacheDirectory();

    if (!this.cacheDir) {
      throw new Error('Cache directory not initialized');
    }

    // Criar diretório temporário para extração
    const tempExtractDir = path.join(this.cacheDir, 'temp-extract');
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });

    try {
      // Extrair ZIP para diretório temporário
      await extract(zipPath, { dir: tempExtractDir });
      console.log('  📦 ZIP extraído para temp');

      // Verificar se há uma pasta intermediária (como UMBRATEST, ARENA, etc.)
      let extractedFiles = fs.readdirSync(tempExtractDir);
      let sourceDir = tempExtractDir;

      // Se há apenas 1 item e é uma pasta, usar essa pasta como source
      if (extractedFiles.length === 1) {
        const potentialFolder = path.join(tempExtractDir, extractedFiles[0]);
        const stats = fs.statSync(potentialFolder);

        if (stats.isDirectory()) {
          console.log(`  📁 Detectada pasta intermediária: ${extractedFiles[0]}`);
          sourceDir = potentialFolder;
          extractedFiles = fs.readdirSync(sourceDir);
        }
      }

      if (!this.steamFilesDir) {
        throw new Error('Steam files directory not initialized');
      }

      // Use local variable to help TypeScript understand it's non-null
      const steamFilesDir = this.steamFilesDir;

      // Mover arquivos para cache permanente
      for (const file of extractedFiles) {
        const srcPath = path.join(sourceDir, file);
        const destPath = path.join(steamFilesDir, file);

        if (fs.existsSync(destPath)) {
          // Remover destino existente
          const stats = fs.statSync(destPath);
          if (stats.isDirectory()) {
            fs.rmSync(destPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(destPath);
          }
        }

        // Copiar arquivo/pasta (usar copyFileSync para arquivos, syncDirectory para pastas)
        const srcStats = fs.statSync(srcPath);
        if (srcStats.isDirectory()) {
          this.syncDirectory(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
        console.log(`  ✅ Salvo em cache: ${file}`);
      }

      console.log('✅ Arquivos salvos no cache com sucesso');
    } finally {
      // Limpar diretório temporário
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Sincroniza diretório recursivamente
   */
  private syncDirectory(src: string, dest: string): void {
    // Criar diretório de destino se não existir
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.syncDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Obtém o caminho do diretório de cache
   */
  getCacheDirectory(): string {
    this.initializePaths(); // ✅ Inicializa paths primeiro

    if (!this.steamFilesDir) {
      throw new Error('Cache directory not initialized');
    }

    return this.steamFilesDir;
  }
}

// Singleton instance - será criado DEPOIS de app.whenReady() em index.ts
export let cacheManager: CacheManager | null = null;

export function initCacheManager(): void {
  if (!cacheManager) {
    cacheManager = new CacheManager();
  }
}
