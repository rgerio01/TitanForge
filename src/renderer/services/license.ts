import { License } from './supabase';

export async function validateLicense(
  licenseKey: string,
  hwid: string
): Promise<{ success: boolean; message: string; license?: License; isSuspended?: boolean; errorCode?: string }> {
  try {
    return await window.electron.licenseValidate(licenseKey.trim(), hwid);
  } catch (error: any) {
    console.error('Erro ao validar licença:', error);
    return { success: false, message: 'Não foi possível validar sua licença' };
  }
}

export async function checkLicenseStatus(
  licenseKey: string,
  hwid: string
): Promise<{ success: boolean; active: boolean; message: string; license?: License }> {
  try {
    return await window.electron.licenseCheckStatus(licenseKey.trim(), hwid);
  } catch (error: any) {
    console.error('Erro ao verificar status da licença:', error);
    return { success: false, active: false, message: 'Não foi possível verificar sua licença' };
  }
}

export async function getLicenseInfo(licenseKey: string): Promise<License | null> {
  try {
    return await window.electron.licenseGetInfo(licenseKey.trim());
  } catch {
    return null;
  }
}

export function saveLicenseLocally(licenseKey: string): void {
  localStorage.setItem('titanforge_license_key', licenseKey.toUpperCase());
}

export function getSavedLicense(): string | null {
  return localStorage.getItem('titanforge_license_key') || localStorage.getItem('umbra_license_key');
}

export function removeSavedLicense(): void {
  localStorage.removeItem('titanforge_license_key');
  localStorage.removeItem('umbra_license_key');
  localStorage.removeItem('vortex_license_key');
}
