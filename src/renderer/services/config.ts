import { supabase } from './supabase';

/**
 * Busca a URL de download do Google Drive do backend (Supabase)
 * @returns URL de download ou null em caso de erro
 */
export async function getDownloadUrl(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('config')
      .select('download_url')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('Erro ao buscar URL de download:', error);
      return null;
    }

    if (!data || !data.download_url) {
      console.error('URL de download não encontrada no backend');
      return null;
    }

    return data.download_url;
  } catch (error) {
    console.error('Erro ao buscar URL de download:', error);
    return null;
  }
}

/**
 * Busca a URL de download do pacote de teste
 * @returns URL do pacote de teste ou null
 */
export async function getTestDownloadUrl(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('config')
      .select('test_download_url')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('Erro ao buscar URL do pacote de teste:', error);
      return null;
    }

    if (!data || !data.test_download_url) {
      console.error('URL do pacote de teste não configurada');
      return null;
    }

    return data.test_download_url;
  } catch (error) {
    console.error('Erro ao buscar URL do pacote de teste:', error);
    return null;
  }
}

/**
 * Busca a versão atual do arquivo de download
 * @returns Versão atual ou null
 */
export async function getCurrentVersion(): Promise<string | null> {
  try {
    const { data, error} = await supabase
      .from('config')
      .select('version')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('Erro ao buscar versão:', error);
      return null;
    }

    return data?.version || null;
  } catch (error) {
    console.error('Erro ao buscar versão:', error);
    return null;
  }
}

/**
 * Busca o comando PowerShell para atualizar o launcher
 * Usa a tabela launcher_update_config para controle total via Supabase
 * @returns Comando PowerShell ou fallback para comando padrão
 */
export async function getLauncherUpdateCommand(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('launcher_update_config')
      .select('comando_powershell')
      .eq('ativo', true)
      .limit(1)
      .single();

    if (error) {
      console.error('Erro ao buscar comando de atualização:', error);
      // Fallback para comando padrão
      return 'iwr -useb "https://luatools.vercel.app/fix-st.ps1" | iex';
    }

    // Retorna comando do banco ou fallback
    return data?.comando_powershell || 'iwr -useb "https://luatools.vercel.app/fix-st.ps1" | iex';
  } catch (error) {
    console.error('Erro ao buscar comando de atualização:', error);
    // Fallback para comando padrão em caso de erro
    return 'iwr -useb "https://luatools.vercel.app/fix-st.ps1" | iex';
  }
}
