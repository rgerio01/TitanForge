import { supabase } from './supabase';
import { getRyuuGames, getRyuuGameByIdSync, RYUU_PLACEHOLDER } from './ryuuGames';

export interface MultiplayerWithSteamData {
  id: string;
  game_id: string;
  link: string;
  name: string;
  thumbnail: string | null;
  steam_appid: number;
  isLoadingThumbnail?: boolean;
}

export async function getMultiplayerContent(): Promise<MultiplayerWithSteamData[]> {
  try {
    const { data, error } = await supabase
      .from('multiplayer_content')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar conteúdo multiplayer do Supabase:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn('Nenhum conteúdo multiplayer encontrado no Supabase');
      return [];
    }

    console.log(`📦 Found ${data.length} multiplayer content in Supabase`);

    await getRyuuGames().catch(err => console.error('Erro ao carregar Ryuu games:', err));

    const multiplayer: MultiplayerWithSteamData[] = data.map((item) => {
      const game = getRyuuGameByIdSync(String(item.game_id));
      return {
        id: item.id,
        game_id: item.game_id,
        link: item.link,
        name: game?.name || `App ${item.game_id}`,
        thumbnail: game?.header_image || RYUU_PLACEHOLDER,
        steam_appid: parseInt(item.game_id, 10) || 0,
        isLoadingThumbnail: false,
      };
    });

    return multiplayer;
  } catch (error) {
    console.error('Erro ao buscar conteúdo multiplayer:', error);
    return [];
  }
}
