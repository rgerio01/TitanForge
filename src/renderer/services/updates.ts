import { supabase } from './supabase';

export interface Update {
  id: string;
  nome: string;
  content: string;
  created_at: string;
}

/**
 * Busca lista de atualizações do Supabase
 */
export async function getUpdates(): Promise<Update[]> {
  try {
    const { data, error } = await supabase
      .from('atualizacoes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar atualizações:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Erro ao buscar atualizações:', error);
    return [];
  }
}

/**
 * Verifica se há atualizações não lidas
 */
export function hasUnreadUpdates(updates: Update[]): boolean {
  if (updates.length === 0) return false;

  const lastReadTimestamp = localStorage.getItem('titanforge_last_update_read');
  if (!lastReadTimestamp) return true;

  const latestUpdate = new Date(updates[0].created_at);
  const lastRead = new Date(lastReadTimestamp);

  return latestUpdate > lastRead;
}

/**
 * Marca todas as atualizações como lidas
 */
export function markUpdatesAsRead(): void {
  localStorage.setItem('titanforge_last_update_read', new Date().toISOString());
}

/**
 * Cria a primeira atualização se a tabela estiver vazia
 */
export async function createInitialUpdate(): Promise<void> {
  try {
    const updates = await getUpdates();

    if (updates.length === 0) {
      const { error } = await supabase
        .from('atualizacoes')
        .insert({
          nome: "v2.2.0 - Umbra Launcher Lançado!",
          content: `• Rebrand completo: Vortex → Umbra
• Novo sistema de Bypass (Free + Premium)
• Contas Oficiais Premium
• Sistema de notificações de atualizações
• Plano único vitalício`,
        });

      if (error) {
        console.error('Erro ao criar atualização inicial:', error);
      } else {
        console.log('✅ Atualização inicial criada!');
      }
    }
  } catch (error) {
    console.error('Erro ao criar atualização inicial:', error);
  }
}
