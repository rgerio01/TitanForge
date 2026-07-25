import { checkLicenseStatus } from './license';

export class HeartbeatService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutos em ms

  /**
   * Inicia o heartbeat
   */
  start(
    licenseKey: string,
    hwid: string,
    onInactive: () => void
  ): void {
    // Se já existe um heartbeat rodando, parar antes
    this.stop();

    console.log('Heartbeat iniciado - verificação a cada 5 minutos');

    // Verificar imediatamente
    this.checkAndHandle(licenseKey, hwid, onInactive);

    // Configurar verificação periódica
    this.intervalId = setInterval(() => {
      this.checkAndHandle(licenseKey, hwid, onInactive);
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Para o heartbeat
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Heartbeat parado');
    }
  }

  /**
   * Verifica o status da licença e executa callback se inativa
   */
  private async checkAndHandle(
    licenseKey: string,
    hwid: string,
    onInactive: () => void
  ): Promise<void> {
    try {
      console.log('Verificando status da licença...');

      const result = await checkLicenseStatus(licenseKey, hwid);

      if (!result.active) {
        console.warn('Licença inativa detectada!');
        this.stop();
        onInactive();
      } else {
        console.log('Licença ativa - OK');
      }
    } catch (error) {
      console.error('Erro no heartbeat:', error);
    }
  }
}

// Instância singleton
export const heartbeat = new HeartbeatService();
