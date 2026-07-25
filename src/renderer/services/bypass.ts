import { supabase } from './supabase';
import { getRyuuGames, getRyuuGameByIdSync, RYUU_PLACEHOLDER } from './ryuuGames';

export interface SteamGameData {
  steam_appid: number;
  name: string;
  header_image: string;
}

export interface BypassWithSteamData {
  id: string;
  game_id: string;
  status: 'free' | 'premium';
  link: string;
  name: string;
  thumbnail: string | null;
  steam_appid: number;
  isLoadingThumbnail?: boolean;
}

export async function fetchSteamGameData(appId: string): Promise<SteamGameData | null> {
  const game = await import('./ryuuGames').then(m => m.getRyuuGameById(appId));
  if (!game) return null;
  return {
    steam_appid: parseInt(game.appid, 10) || 0,
    name: game.name,
    header_image: game.header_image,
  };
}

export async function getBypassList(): Promise<BypassWithSteamData[]> {
  try {
    const { data, error } = await supabase
      .from('bypass')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar bypasses do Supabase:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn('Nenhum bypass encontrado no Supabase');
      return [];
    }

    console.log(`📦 Found ${data.length} bypasses in Supabase`);

    await getRyuuGames().catch(err => console.error('Erro ao carregar Ryuu games:', err));

    const bypasses: BypassWithSteamData[] = data.map((bypass) => {
      const game = getRyuuGameByIdSync(String(bypass.game_id));
      return {
        id: bypass.id,
        game_id: bypass.game_id,
        status: bypass.status,
        link: bypass.link,
        name: game?.name || `App ${bypass.game_id}`,
        thumbnail: game?.header_image || RYUU_PLACEHOLDER,
        steam_appid: parseInt(bypass.game_id, 10) || 0,
        isLoadingThumbnail: false,
      };
    });

    return bypasses;
  } catch (error) {
    console.error('Erro ao buscar bypasses:', error);
    return [];
  }
}

export function clearSteamCache(): void {
  try {
    localStorage.removeItem('steam_games_cache');
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
}

export function getCacheStats(): { totalGames: number; oldestCache: Date | null } {
  return { totalGames: 0, oldestCache: null };
}
