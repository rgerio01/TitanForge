@echo off
echo ========================================
echo  LIMPANDO BUILD ANTERIOR
echo ========================================
echo.

echo [1/2] Removendo pasta dist...
if exist dist (
    rmdir /s /q dist
    echo      OK - dist removida
) else (
    echo      AVISO - dist nao encontrada
)

echo.
echo [2/2] Removendo pasta release...
if exist release (
    rmdir /s /q release
    echo      OK - release removida
) else (
    echo      AVISO - release nao encontrada
)

echo.
echo ========================================
echo  LIMPEZA CONCLUIDA!
echo ========================================
echo.
echo Agora execute:
echo   npm run build
echo   npm run package
echo.
pause
