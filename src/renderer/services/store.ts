import { supabase } from './supabase';

export interface StoreItem {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  link_compra: string;
  categoria: 'licenca' | 'produto' | 'servico';
  destaque: boolean;
  ativo: boolean;
  permission_field: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Busca todos os itens ativos da loja
 */
export async function getStoreItems(): Promise<StoreItem[]> {
  try {
    const { data, error } = await supabase
      .from('store')
      .select('*')
      .eq('ativo', true)
      .order('destaque', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar itens da loja:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar itens da loja:', error);
    return [];
  }
}

/**
 * Busca itens da loja por categoria
 */
export async function getStoreItemsByCategory(categoria: 'licenca' | 'produto' | 'servico'): Promise<StoreItem[]> {
  try {
    const { data, error } = await supabase
      .from('store')
      .select('*')
      .eq('ativo', true)
      .eq('categoria', categoria)
      .order('destaque', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar itens por categoria:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar itens por categoria:', error);
    return [];
  }
}
