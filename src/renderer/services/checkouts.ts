import { supabase } from './supabase';

export interface Checkout {
  id: string;
  tipo: 'licenca_login' | 'adicionar_jogo' | 'bypass_premium' | 'contas_oficiais' | 'multiplayer' | 'nsfw_premium';
  nome: string;
  descricao: string | null;
  link: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Busca o link de checkout por tipo
 * @param tipo - Tipo do checkout
 * @returns Link de checkout ou null
 */
export async function getCheckoutLink(tipo: Checkout['tipo']): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('checkouts')
      .select('link')
      .eq('tipo', tipo)
      .eq('ativo', true)
      .single();

    if (error) {
      console.error(`Erro ao buscar checkout do tipo ${tipo}:`, error);
      return null;
    }

    return data?.link || null;
  } catch (error) {
    console.error(`Erro ao buscar checkout do tipo ${tipo}:`, error);
    return null;
  }
}

/**
 * Busca todos os checkouts ativos
 * @returns Lista de checkouts
 */
export async function getAllCheckouts(): Promise<Checkout[]> {
  try {
    const { data, error } = await supabase
      .from('checkouts')
      .select('*')
      .eq('ativo', true)
      .order('tipo');

    if (error) {
      console.error('Erro ao buscar checkouts:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar checkouts:', error);
    return [];
  }
}

/**
 * Busca checkout por tipo (retorna objeto completo)
 * @param tipo - Tipo do checkout
 * @returns Checkout ou null
 */
export async function getCheckout(tipo: Checkout['tipo']): Promise<Checkout | null> {
  try {
    const { data, error } = await supabase
      .from('checkouts')
      .select('*')
      .eq('tipo', tipo)
      .eq('ativo', true)
      .single();

    if (error) {
      console.error(`Erro ao buscar checkout do tipo ${tipo}:`, error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error(`Erro ao buscar checkout do tipo ${tipo}:`, error);
    return null;
  }
}
