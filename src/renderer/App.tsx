import React, { useState, useEffect } from 'react';
import Login from './pages/Login';
import Launcher from './pages/Launcher';
import UpdateModal from './components/UpdateModal';
import { getSavedLicense } from './services/license';

type View = 'login' | 'launcher';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('login');
  const [licenseKey, setLicenseKey] = useState<string>('');
  const [hwid, setHWID] = useState<string>('');

  useEffect(() => {
    // Migração silenciosa de Vortex → Umbra → TitanForge
    const oldVortexKey = localStorage.getItem('vortex_license_key');
    const oldUmbraKey = localStorage.getItem('umbra_license_key');
    if (!localStorage.getItem('titanforge_license_key')) {
      const migrated = oldUmbraKey || oldVortexKey;
      if (migrated) {
        localStorage.setItem('titanforge_license_key', migrated);
        localStorage.removeItem('umbra_license_key');
        localStorage.removeItem('vortex_license_key');
        console.log('✅ Migração Umbra → TitanForge concluída');
      }
    }

    // Verificar se há licença salva
    const savedLicense = getSavedLicense();
    if (savedLicense) {
      setLicenseKey(savedLicense.toUpperCase());
      // Ainda precisa validar, mas pode pular direto para o launcher
      // se quiser implementar auto-login
    }

    // Obter HWID da máquina
    window.electron.getHWID().then((result) => {
      if (result.success && result.hwid) {
        setHWID(result.hwid);
      }
    });
  }, []);

  const handleLoginSuccess = (key: string) => {
    setLicenseKey(key);
    setCurrentView('launcher');
  };

  const handleLogout = () => {
    setCurrentView('login');
  };

  return (
    <div className="w-full h-screen bg-vortex-darker overflow-hidden">
      {currentView === 'login' ? (
        <Login onLoginSuccess={handleLoginSuccess} hwid={hwid} />
      ) : (
        <Launcher licenseKey={licenseKey} hwid={hwid} onLogout={handleLogout} />
      )}
      {/* Modal de auto-update — escuta eventos do main e aparece quando há update */}
      <UpdateModal />
    </div>
  );
};

export default App;
