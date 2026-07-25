import { supabase } from './supabase';

export interface PremiumAccount {
  id: string;
  nome: string;
  login: string;
  senha: string;
  content: string; // Lista de jogos em formato JSON ou texto separado por vírgulas
  created_at: string;
  updated_at: string;
}

/**
 * Busca lista de contas premium do Supabase
 */
export async function getPremiumAccounts(): Promise<PremiumAccount[]> {
  try {
    const { data, error } = await supabase
      .from('premiumaccounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar contas premium:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar contas premium:', error);
    return [];
  }
}
