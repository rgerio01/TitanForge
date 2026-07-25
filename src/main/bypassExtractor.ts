import { shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import axios from 'axios';
import AdmZip = require('adm-zip');

/**
 * Sistema de extração de bypass.
 * - Baixa o arquivo (zip/rar/7z/torrent) do link informado
 * - Extrai/instala na pasta destino escolhida pelo usuário
 * - .torrent: abre no cliente padrão do sistema (não há cliente bittorrent embutido)
 */

export type BypassFormat = 'zip' | 'rar' | '7z' | 'torrent' | 'unknown';

export interface BypassExtractInput {
  url: string;
  destinationFolder: string;
}

export interface BypassExtractResult {
  success: boolean;
  format?: BypassFormat;
  filesExtracted?: number;
  error?: string;
  openedExternally?: boolean;
}

function detectFormatFromUrl(url: string): BypassFormat {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.zip')) return 'zip';
  if (u.endsWith('.rar')) return 'rar';
  if (u.endsWith('.7z')) return '7z';
  if (u.endsWith('.torrent')) return 'torrent';
  return 'unknown';
}

function detectFormatFromContentType(contentType: string | undefined): BypassFormat {
  if (!contentType) return 'unknown';
  const c = contentType.toLowerCase();
  if (c.includes('zip')) return 'zip';
  if (c.includes('rar')) return 'rar';
  if (c.includes('7z') || c.includes('x-7z-compressed')) return '7z';
  if (c.includes('bittorrent')) return 'torrent';
  return 'unknown';
}

function detectFormatFromMagicBytes(filePath: string): BypassFormat {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    // ZIP: 50 4B 03 04 / 50 4B 05 06 / 50 4B 07 08
    if (buf[0] === 0x50 && buf[1] === 0x4B) return 'zip';
    // RAR: 52 61 72 21 1A 07
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'rar';
    // 7z: 37 7A BC AF 27 1C
    if (buf[0] === 0x37 && buf[1] === 0x7A && buf[2] === 0xBC && buf[3] === 0xAF) return '7z';
    // .torrent: começa com "d8:announce" ou "d4:info" (bencode)
    const text = buf.toString('utf-8');
    if (text.startsWith('d') && (text.includes('announce') || text.includes('info'))) return 'torrent';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function downloadToTemp(url: string, win: BrowserWindow | null, suggestedExt: string): Promise<{ filePath: string; contentType?: string }> {
  const tempDir = path.join(os.tmpdir(), 'titanforge-bypass');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const fileName = `bypass-${Date.now()}${suggestedExt || ''}`;
  const filePath = path.join(tempDir, fileName);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 600000,
    maxRedirects: 10,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    },
    onDownloadProgress: (p) => {
      const total = p.total || p.loaded;
      const percent = total ? Math.round((p.loaded * 100) / total) : 0;
      win?.webContents.send('bypass-progress', { stage: 'downloading', percent });
    },
  });

  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    response.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    response.data.on('error', reject);
  });

  return { filePath, contentType: response.headers['content-type'] as string };
}

function find7zExe(): string | null {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Tenta no PATH
  return '7z';
}

async function extract7z(archive: string, dest: string): Promise<number> {
  const exe = find7zExe();
  return new Promise((resolve, reject) => {
    const ps = spawn(exe!, ['x', archive, `-o${dest}`, '-y'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let extracted = 0;
    let stderr = '';
    ps.stdout.on('data', (b: Buffer) => {
      const lines = b.toString().split(/\r?\n/);
      for (const l of lines) if (/^Extracting\s|^- /i.test(l)) extracted++;
    });
    ps.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
    ps.on('error', () => reject(new Error('7-Zip não está instalado. Instale o 7-Zip ou use um arquivo .zip.')));
    ps.on('close', (code) => {
      if (code === 0) resolve(extracted || 1);
      else reject(new Error(stderr || 'Falha ao extrair arquivo'));
    });
  });
}

async function extractZip(archive: string, dest: string): Promise<number> {
  const zip = new AdmZip(archive);
  const entries = zip.getEntries();
  zip.extractAllTo(dest, true);
  return entries.filter((e) => !e.isDirectory).length;
}

export async function extractBypass(input: BypassExtractInput, win: BrowserWindow | null): Promise<BypassExtractResult> {
  if (!input.url || !input.destinationFolder) {
    return { success: false, error: 'Dados incompletos' };
  }

  // Validações de pasta destino
  if (!fs.existsSync(input.destinationFolder)) {
    try { fs.mkdirSync(input.destinationFolder, { recursive: true }); }
    catch { return { success: false, error: 'Pasta de destino inválida ou inacessível' }; }
  }
  const stat = fs.statSync(input.destinationFolder);
  if (!stat.isDirectory()) return { success: false, error: 'O destino precisa ser uma pasta' };

  // Detecta formato preliminarmente pela URL
  let format = detectFormatFromUrl(input.url);

  // .torrent: abre no cliente padrão
  if (format === 'torrent') {
    try {
      const { filePath } = await downloadToTemp(input.url, win, '.torrent');
      win?.webContents.send('bypass-progress', { stage: 'opening' });
      await shell.openPath(filePath);
      return { success: true, format: 'torrent', openedExternally: true };
    } catch (e: any) {
      // Tenta abrir o link direto
      try { await shell.openExternal(input.url); return { success: true, format: 'torrent', openedExternally: true }; }
      catch { return { success: false, error: 'Não foi possível abrir o arquivo .torrent' }; }
    }
  }

  // Baixa o arquivo
  win?.webContents.send('bypass-progress', { stage: 'downloading', percent: 0 });
  let downloaded;
  try {
    downloaded = await downloadToTemp(input.url, win, format !== 'unknown' ? `.${format}` : '');
  } catch (e: any) {
    return { success: false, error: 'Falha ao baixar o arquivo' };
  }

  // Refina detecção (content-type + magic bytes)
  if (format === 'unknown') {
    format = detectFormatFromContentType(downloaded.contentType);
    if (format === 'unknown') format = detectFormatFromMagicBytes(downloaded.filePath);
  }

  // Extrai conforme formato
  win?.webContents.send('bypass-progress', { stage: 'extracting' });
  try {
    let count = 0;
    if (format === 'zip') {
      count = await extractZip(downloaded.filePath, input.destinationFolder);
    } else if (format === '7z' || format === 'rar') {
      count = await extract7z(downloaded.filePath, input.destinationFolder);
    } else {
      // Fallback: tenta como zip
      try { count = await extractZip(downloaded.filePath, input.destinationFolder); format = 'zip'; }
      catch {
        // Tenta 7z genericamente
        try { count = await extract7z(downloaded.filePath, input.destinationFolder); format = '7z'; }
        catch { return { success: false, error: 'Formato de arquivo não suportado' }; }
      }
    }
    // Limpa temp
    try { fs.unlinkSync(downloaded.filePath); } catch {}
    win?.webContents.send('bypass-progress', { stage: 'done' });
    return { success: true, format, filesExtracted: count };
  } catch (e: any) {
    try { fs.unlinkSync(downloaded.filePath); } catch {}
    return { success: false, error: e?.message || 'Falha ao extrair' };
  }
}
