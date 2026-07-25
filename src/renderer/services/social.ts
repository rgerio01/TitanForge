import { supabase } from './supabase';

export interface SocialLink {
  id: string;
  tipo: 'discord' | 'whatsapp';
  link: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

let cache: Record<string, string> = {};
let cacheLoaded = false;

export async function getSocialLinks(): Promise<SocialLink[]> {
  try {
    const { data, error } = await supabase
      .from('social')
      .select('*')
      .eq('ativo', true);

    if (error) {
      console.error('Erro ao buscar social links:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar social links:', error);
    return [];
  }
}

export async function getSocialLinkMap(): Promise<Record<string, string>> {
  if (cacheLoaded) return cache;
  const items = await getSocialLinks();
  cache = {};
  for (const item of items) cache[item.tipo] = item.link;
  cacheLoaded = true;
  return cache;
}
