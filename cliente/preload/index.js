(() => {
    "use strict";
    var e = {
            157: e => {
                e.exports = require("electron")
            }
        },
        r = {};

    function n(i) {
        var o = r[i];
        if (void 0 !== o) return o.exports;
        var d = r[i] = {
            exports: {}
        };
        return e[i](d, d.exports, n), d.exports
    }(() => {
        const e = n(157),
            r = {
                setLicenseBackend: r => e.ipcRenderer.invoke("set-license-backend", r),
                licenseValidate: (r, n) => e.ipcRenderer.invoke("license-validate", {
                    licenseKey: r,
                    hwid: n
                }),
                licenseCheckStatus: (r, n) => e.ipcRenderer.invoke("license-check-status", {
                    licenseKey: r,
                    hwid: n
                }),
                licenseGetInfo: r => e.ipcRenderer.invoke("license-get-info", {
                    licenseKey: r
                }),
                licenseWatch: r => e.ipcRenderer.invoke("license-watch", r),
                licenseUnwatch: () => e.ipcRenderer.invoke("license-unwatch"),
                trialStart: () => e.ipcRenderer.invoke("trial-start"),
                onLicenseChanged: r => {
                    e.ipcRenderer.on("license-changed", (e, n) => r(n))
                },
                offLicenseChanged: () => {
                    e.ipcRenderer.removeAllListeners("license-changed")
                },
                denuvoListGames: () => e.ipcRenderer.invoke("denuvo-list-games"),
                denuvoCreateOrder: r => e.ipcRenderer.invoke("denuvo-create-order", r),
                denuvoCheckStatus: r => e.ipcRenderer.invoke("denuvo-check-status", r),
                denuvoListMyOrders: r => e.ipcRenderer.invoke("denuvo-list-my-orders", r),
                pixCreateOrder: r => e.ipcRenderer.invoke("pix-create-order", r),
                pixCheckStatus: r => e.ipcRenderer.invoke("pix-check-status", r),
                pixListMyOrders: r => e.ipcRenderer.invoke("pix-list-my-orders", r),
                productsList: () => e.ipcRenderer.invoke("products-list"),
                tutorialsList: () => e.ipcRenderer.invoke("tutorials-list"),
                lookupCep: r => e.ipcRenderer.invoke("lookup-cep", r),
                cardInstallments: r => e.ipcRenderer.invoke("card-installments", r),
                cardCreateOrder: r => e.ipcRenderer.invoke("card-create-order", r),
                cardCheckStatus: r => e.ipcRenderer.invoke("card-check-status", r),
                onChargebackDetected: r => {
                    e.ipcRenderer.on("chargeback-detected", (e, n) => r(n))
                },
                couponValidate: (r, n) => e.ipcRenderer.invoke("coupon-validate", {
                    code: r,
                    productType: n
                }),
                getSignupPrice: () => e.ipcRenderer.invoke("get-signup-price"),
                listSignupPlans: () => e.ipcRenderer.invoke("list-signup-plans"),
                signupCreatePix: r => e.ipcRenderer.invoke("signup-create-pix", r),
                signupCreateCard: r => e.ipcRenderer.invoke("signup-create-card", r),
                signupCheckStatus: r => e.ipcRenderer.invoke("signup-check-status", r),
                referralGetInfo: r => e.ipcRenderer.invoke("referral-get-info", r),
                referralList: r => e.ipcRenderer.invoke("referral-list", r),
                referralValidateCode: r => e.ipcRenderer.invoke("referral-validate-code", r),
                profileUpdate: r => e.ipcRenderer.invoke("profile-update", r),
                redemptionInfo: r => e.ipcRenderer.invoke("redemption-info", r),
                redemptionRequest: r => e.ipcRenderer.invoke("redemption-request", r),
                getPublicIp: () => e.ipcRenderer.invoke("get-public-ip"),
                bypassPickFolder: () => e.ipcRenderer.invoke("bypass-pick-folder"),
                bypassExtract: (r, n) => e.ipcRenderer.invoke("bypass-extract", {
                    url: r,
                    destinationFolder: n
                }),
                detectGameFolder: r => e.ipcRenderer.invoke("detect-game-folder", {
                    appid: r
                }),
                checkSteamSetup: () => e.ipcRenderer.invoke("check-steam-setup"),
                selectSteamFolder: () => e.ipcRenderer.invoke("select-steam-folder"),
                onBypassProgress: r => {
                    e.ipcRenderer.on("bypass-progress", (e, n) => r(n))
                },
                getHWID: () => e.ipcRenderer.invoke("get-hwid"),
                loadGamesDatabase: () => e.ipcRenderer.invoke("load-games-database"),
                fetchRyuuGames: () => e.ipcRenderer.invoke("fetch-ryuu-games"),
                getGameTrailer: appid => e.ipcRenderer.invoke("get-game-trailer", appid),
                getGameDetails: appid => e.ipcRenderer.invoke("get-game-details", appid),
                fetchBypassCatalog: r => e.ipcRenderer.invoke("fetch-bypass-catalog", r),
                fetchSteamGameData: r => e.ipcRenderer.invoke("fetch-steam-game-data", r),
                detectSteamPath: () => e.ipcRenderer.invoke("detect-steam-path"),
                updateSteam: (r, n) => e.ipcRenderer.invoke("update-steam", {
                    steamPath: r,
                    downloadUrl: n
                }),
                cleanupSteamFiles: r => e.ipcRenderer.invoke("cleanup-steam-files", {
                    steamPath: r
                }),
                openSteam: r => e.ipcRenderer.invoke("open-steam", {
                    steamPath: r
                }),
                closeSteam: () => e.ipcRenderer.invoke("close-steam"),
                onUpdateProgress: r => {
                    e.ipcRenderer.on("update-progress", (e, n) => r(n))
                },
                onUpdateStatus: r => {
                    e.ipcRenderer.on("update-status", (e, n) => r(n))
                },
                on: (r, n) => {
                    e.ipcRenderer.on(r, (e, ...r) => n(...r))
                },
                off: (r, n) => {
                    e.ipcRenderer.removeListener(r, n)
                },
                closeApp: () => e.ipcRenderer.invoke("close-app"),
                minimizeApp: () => e.ipcRenderer.invoke("minimize-app"),
                maximizeApp: () => e.ipcRenderer.invoke("maximize-app"),
                isMaximized: () => e.ipcRenderer.invoke("is-maximized"),
                resizeWindow: (r, n) => e.ipcRenderer.invoke("resize-window", {
                    width: r,
                    height: n
                }),
                runPowerShellCommand: r => e.ipcRenderer.invoke("run-powershell-command", {
                    command: r
                }),
                cloudRedirectFix: () => e.ipcRenderer.invoke("cloudredirect-fix"),
                reportLauncherEvent: r => e.ipcRenderer.invoke("report-launcher-event", r),
                setTelemetryContext: r => e.ipcRenderer.invoke("set-telemetry-context", r),
                termsStatus: (r, n) => e.ipcRenderer.invoke("terms-status", {
                    licenseKey: r,
                    version: n
                }),
                termsAccept: (r, n) => e.ipcRenderer.invoke("terms-accept", {
                    licenseKey: r,
                    version: n
                }),
                hidDllStatus: () => e.ipcRenderer.invoke("hid-dll-status"),
                disableHidDll: () => e.ipcRenderer.invoke("disable-hid-dll"),
                enableHidDll: () => e.ipcRenderer.invoke("enable-hid-dll"),
                ensureHidDllActive: () => e.ipcRenderer.invoke("ensure-hid-dll-active"),
                searchManifestorGames: r => e.ipcRenderer.invoke("search-manifestor-games", r),
                downloadManifestorLua: (r, n, i, s) => e.ipcRenderer.invoke("download-manifestor-lua", r, n, i, s),
                updateGameFiles: r => e.ipcRenderer.invoke("update-game-files", r),
                downloadDlcManifest: (r, n) => e.ipcRenderer.invoke("download-dlc-manifest", r, n),
                listInstalledDlc: r => e.ipcRenderer.invoke("list-installed-dlc", r),
                requestGameRyuu: r => e.ipcRenderer.invoke("request-game-ryuu", r),
                removeGame: r => e.ipcRenderer.invoke("remove-game", r),
                getMyGames: () => e.ipcRenderer.invoke("get-my-games"),
                openExternalUrl: r => e.ipcRenderer.invoke("open-external-url", r),
                downloadFile: (r, n) => e.ipcRenderer.invoke("download-file-with-dialog", r, n),
                onDownloadProgress: r => {
                    e.ipcRenderer.on("download-progress", (e, n) => r(n))
                },
                ensureHidDll: () => e.ipcRenderer.invoke("ensure-hid-dll"),
                installTitanForgeHook: () => e.ipcRenderer.invoke("install-umbra-hook"),
                onUmbraHookProgress: r => {
                    e.ipcRenderer.on("umbra-hook-progress", (e, n) => r(n))
                },
                restartSteam: r => e.ipcRenderer.invoke("restart-steam", r),
                depotboxApiRequest: (r, n) => e.ipcRenderer.invoke("depotbox-api-request", r, n),
                depotboxDownloadAndExtract: (r, n, i) => e.ipcRenderer.invoke("depotbox-download-and-extract", r, n, i),
                depotboxBatchDownloadAndExtract: (r, n, i) => e.ipcRenderer.invoke("depotbox-batch-download-and-extract", r, n, i),
                onDepotboxDownloadProgress: r => {
                    e.ipcRenderer.on("depotbox-download-progress", (e, n) => r(n))
                },
                restartAndUpdate: () => e.ipcRenderer.invoke("restart-and-update"),
                openUpdatesFolder: () => e.ipcRenderer.invoke("open-updates-folder"),
                bootCheckUpdates: () => e.ipcRenderer.invoke("boot-check-updates"),
                bootUpdateFinished: () => e.ipcRenderer.invoke("boot-update-finished"),
                getAppVersion: () => e.ipcRenderer.invoke("get-app-version"),
                supportRequest: r => e.ipcRenderer.invoke("support-request", r),
                onSecurityForceWipe: r => {
                    e.ipcRenderer.on("security-force-wipe", (e, n) => r(n))
                },
                securityWipeReport: r => e.ipcRenderer.invoke("security-wipe-report", r),
                checkForUpdatesManually: () => e.ipcRenderer.invoke("check-for-updates-manually"),
                onUpdateChecking: r => {
                    e.ipcRenderer.on("update-checking", () => r())
                },
                onUpdateAvailable: r => {
                    e.ipcRenderer.on("update-available", (e, n) => r(n))
                },
                onUpdateNotAvailable: r => {
                    e.ipcRenderer.on("update-not-available", () => r())
                },
                onUpdateDownloadProgress: r => {
                    e.ipcRenderer.on("update-download-progress", (e, n) => r(n))
                },
                onUpdateDownloaded: r => {
                    e.ipcRenderer.on("update-downloaded", (e, n) => r(n))
                },
                onUpdateError: r => {
                    e.ipcRenderer.on("update-error", (e, n) => r(n))
                },
                arenaCheckInstalled: () => e.ipcRenderer.invoke("arena-check-installed"),
                arenaDownloadAndInstall: (r, n) => e.ipcRenderer.invoke("arena-download-and-install", {
                    urls: r,
                    version: n
                }),
                arenaLaunch: () => e.ipcRenderer.invoke("arena-launch"),
                arenaUninstall: () => e.ipcRenderer.invoke("arena-uninstall"),
                onArenaDownloadProgress: r => {
                    e.ipcRenderer.on("arena-download-progress", (e, n) => r(n))
                },
                arenaPickFolder: () => e.ipcRenderer.invoke("arena-pick-folder"),
                arenaScanAndImport: r => e.ipcRenderer.invoke("arena-scan-and-import", {
                    sourceFolder: r
                }),
                arenaListGames: () => e.ipcRenderer.invoke("arena-list-games"),
                arenaRomsPathGet: () => e.ipcRenderer.invoke("arena-roms-path-get"),
                arenaRomsPathSet: () => e.ipcRenderer.invoke("arena-roms-path-set"),
                arenaLaunchGame: r => e.ipcRenderer.invoke("arena-launch-game", r),
                titanforgePixCreate: r => e.ipcRenderer.invoke("titanforge-pix-create", r),
                titanforgePixCheck: r => e.ipcRenderer.invoke("titanforge-pix-check", r)
            };
        e.contextBridge.exposeInMainWorld("electron", r)
    })()
})();