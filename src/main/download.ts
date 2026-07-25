import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * Baixa arquivos do Google Drive ou outro serviço de hospedagem
 * URL de download é buscada dinamicamente do backend (Supabase)
 *
 * @param downloadUrl - URL do arquivo para download (do backend)
 * @param onProgress - Callback para progresso do download
 * @returns Caminho do arquivo baixado
 */
export async function downloadFromGoogleDrive(
  downloadUrl: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  try {
    console.log('Iniciando download...');
    console.log('URL:', downloadUrl);

    // Converter link do Google Drive se necessário
    const directUrl = convertGoogleDriveLink(downloadUrl);

    const tempDir = path.join(process.env.TEMP || '/tmp', 'vortex_downloads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const outputPath = path.join(tempDir, 'ARENA.zip');

    // Se o arquivo já existe, remover
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    // Download com progresso
    const response = await axios({
      method: 'GET',
      url: directUrl,
      responseType: 'stream',
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    const writer = fs.createWriteStream(outputPath);

    response.data.on('data', (chunk: Buffer) => {
      downloadedLength += chunk.length;
      if (totalLength && onProgress) {
        const progress = Math.round((downloadedLength / parseInt(totalLength)) * 100);
        onProgress(progress);
      }
    });

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        console.log('Download concluído:', outputPath);
        resolve(outputPath);
      });

      writer.on('error', (error) => {
        console.error('Erro no download:', error);
        reject(new Error('Falha ao baixar arquivo do Google Drive'));
      });
    });
  } catch (error: any) {
    console.error('Erro no download:', error);
    throw new Error('Erro durante o download. Tente novamente.');
  }
}

/**
 * Converte link do Google Drive para link de download direto
 * Funciona apenas para arquivos individuais compartilhados publicamente
 */
export function convertGoogleDriveLink(shareLink: string): string {
  // Extrair file ID do link
  const fileIdMatch = shareLink.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (fileIdMatch && fileIdMatch[1]) {
    const fileId = fileIdMatch[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  return shareLink;
}
