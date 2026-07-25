import { machineIdSync } from 'node-machine-id';
import * as crypto from 'crypto';

/**
 * Gera um HWID único baseado no hardware da máquina
 * Usa node-machine-id para obter um ID único e persistente
 */
export async function getHWID(): Promise<string> {
  try {
    // Obtém o ID da máquina (baseado em hardware)
    const machineId = machineIdSync(true);

    // Gera um hash SHA256 para tornar o ID mais seguro
    const hash = crypto.createHash('sha256');
    hash.update(machineId);
    const hwid = hash.digest('hex');

    console.log('HWID gerado:', hwid);
    return hwid;
  } catch (error) {
    console.error('Erro ao gerar HWID:', error);
    throw new Error('Não foi possível gerar o HWID da máquina');
  }
}
