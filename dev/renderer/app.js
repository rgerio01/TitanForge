/* ============================================================================
   GAMAXY — renderer completo  ·  canal DEV  (base TitanForge)
   Renderer proprio (sem React), ligado 100% no window.electron.
   Telas nativas: login/termos, Entrada, Steam (Meus Jogos, Catalogo, Bypass,
   Remover Denuvo, Contas Oficiais, DLCs, Novidades, Loja, Indicacoes, Config),
   Retro (Sistemas, Instalados, Emuladores, Solicitar, Pasta, Config), Admin.
   Pagamento: PIX nativo (QR + polling); cartao abre no site (precisa do SDK EFI).
   ========================================================================== */
(function () {
  "use strict";
  var E = window.electron || {};
  var root = document.getElementById("root");
  var HAS_HLS = typeof window.Hls !== "undefined";

  /* ------------------------------------------------------------------ util */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "style") e.setAttribute("style", v);
      else if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function hash(s) { var x = 0, i; s = String(s); for (i = 0; i < s.length; i++) x = (x << 5) - x + s.charCodeAt(i) | 0; return x; }
  function money(n) { n = Number(n) || 0; return "R$ " + n.toFixed(2).replace(".", ","); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function fmtDate(s) { try { var d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("pt-BR"); } catch (e) { return ""; } }
  function capFor(id) { return "https://cdn.cloudflare.steamstatic.com/steam/apps/" + id + "/header.jpg"; }
  var PAL = [["#1f2b47", "#0d1220"], ["#3a1f2b", "#160b12"], ["#243a30", "#0c1712"], ["#3a331f", "#171207"], ["#2b1f3a", "#100915"], ["#1f3a3a", "#0a1717"], ["#3a2a1f", "#170f0a"], ["#22314a", "#0c1322"]];
  function pal(i) { return PAL[Math.abs(i) % PAL.length]; }
  function copy(txt) { try { navigator.clipboard.writeText(txt); } catch (e) { var t = h("textarea", { style: "position:fixed;opacity:0" }); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e2) {} t.remove(); } }

  /* ------------------------------------------------------------------ state */
  var S = {
    phase: "boot", mode: "steam", page: "home",
    search: "",
    hwid: "", version: "",
    licenseKey: "", licenseInfo: null, isAdmin: false, plan: {},
    myGames: new Set(),
    names: {},              // appid -> nome (games.json + almaz_catalog)
    db: [],
    bypass: [],
    denuvoGames: [], denuvoOrders: [],
    consoles: [], console: "",
    downloads: {},           // id -> {name,pct,phase}
    updates: [],
    steam: { found: null, path: "" }
  };
  var hb = null;

  /* -------------------------------------------------------------- services */
  var svc = {
    getSaved: function () { try { return localStorage.getItem("gx_lic") || ""; } catch (e) { return ""; } },
    save: function (k) { try { localStorage.setItem("gx_lic", String(k || "").toUpperCase()); } catch (e) {} },
    clear: function () { try { ["gx_lic", "titanforge_license_key", "umbra_license_key", "vortex_license_key"].forEach(function (x) { localStorage.removeItem(x); }); } catch (e) {} },
    validate: function (k) { return call("licenseValidate", k.trim(), S.hwid, { success: false, message: "IPC indisponivel" }); },
    checkStatus: function (k) { return call("licenseCheckStatus", k.trim(), S.hwid, { success: false, active: false }); },
    info: function (k) { return call("licenseGetInfo", k.trim(), undefined, null); },
    termsStatus: function (k) { return call("termsStatus", k, 1, { accepted: true }); },
    termsAccept: function (k) { return call("termsAccept", k, 1, { ok: true }); }
  };
  function call(fn, a, b, fallback) {
    try {
      if (typeof E[fn] !== "function") return Promise.resolve(fallback);
      var p = (b !== undefined) ? E[fn](a, b) : (a !== undefined ? E[fn](a) : E[fn]());
      return Promise.resolve(p).catch(function () { return fallback; });
    } catch (e) { return Promise.resolve(fallback); }
  }
  function ipcUpdates() { return call("getUpdates", undefined, undefined, []); }

  // regras de licenca / plano ---------------------------------------------
  var ADMIN_KEYS = ["ROGERIO3120"]; // full admin (mesma regra do launcher antigo)
  var NSFW_RE = /(hentai|eroge|rule ?34|r-?18|18\+|18禁|\bxxx\b|\bnsfw\b|succubus|adult only|\bsex\b|erotic|er[oó]tic|doujin|ahegao|onahole|hardcore porn|\bporn\b)/i;
  function isAdmin() { return ADMIN_KEYS.indexOf((S.licenseKey || "").toUpperCase()) >= 0 || !!(S.licenseInfo && (S.licenseInfo.is_admin || S.licenseInfo.admin)); }
  function can(feat) {
    if (isAdmin()) return true;
    var p = S.plan || {};
    if (feat === "games") return true;
    if (feat === "add_games") return p.add_games !== "disable"; // default liberado; signup pode travar
    if (feat === "game_limit_ok") return p.game_limit == null || S.myGames.size < p.game_limit;
    return p[feat] === "enable"; // emuladores | nsfw | multiplayer | premiumaccounts
  }
  function nsfwHide(name) { return !can("nsfw") && NSFW_RE.test(String(name || "")); }

  /* ================================================================ styles */
  var CSS = "\
:root{--ground:#0a0f1c;--panel:#121a2c;--panel-2:#182338;--card:#1b2740;--line:#33456a;--line-soft:#243352;\
--heat:#ff9d1f;--heat-2:#ffc061;--heat-dim:#7e4d0f;\
--steel:#33e7ff;--steel-2:#8cf3ff;--steel-dim:#0e5768;\
--xbox:#3ddc73;--ps:#3a8bff;--switchc:#ff4d6a;--neon:#b06bff;\
--text:#f5f8ff;--text-dim:#b7c4de;--text-faint:#8fa0c2;--good:#3ff08a;--warn:#ffc44d;--crit:#ff5570;\
--cut:14px;--accent:var(--steel);color-scheme:dark}\
*{box-sizing:border-box}html,body{margin:0;height:100%}\
body{color:var(--text);font-family:'Rajdhani',system-ui,sans-serif;font-size:15px;line-height:1.5;overflow:hidden;-webkit-font-smoothing:antialiased;\
background:\
radial-gradient(90% 60% at 8% -6%,color-mix(in srgb,var(--steel) 13%,transparent),transparent 55%),\
radial-gradient(80% 55% at 96% -4%,color-mix(in srgb,var(--xbox) 9%,transparent),transparent 55%),\
radial-gradient(90% 60% at 100% 108%,color-mix(in srgb,var(--heat) 12%,transparent),transparent 55%),\
radial-gradient(80% 55% at 0% 105%,color-mix(in srgb,var(--ps) 9%,transparent),transparent 55%),\
linear-gradient(color-mix(in srgb,var(--line) 32%,transparent) 1px,transparent 1px) 0 0/48px 48px,\
linear-gradient(90deg,color-mix(in srgb,var(--line) 32%,transparent) 1px,transparent 1px) 0 0/48px 48px,\
var(--ground);background-attachment:fixed}\
#root{height:100%;position:relative;z-index:1}h1,h2,h3,h4{font-family:'Chakra Petch','Rajdhani',sans-serif;margin:0;font-weight:600;letter-spacing:.01em}\
.circuit-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}\
.circuit-bg svg{width:100%;height:100%;display:block}\
.ctbase{fill:none;stroke-width:1.4;opacity:.15}\
.ctpulse{fill:none;stroke-width:2.2;stroke-linecap:round;stroke-dasharray:46 360;filter:drop-shadow(0 0 4px currentColor);opacity:.85;animation-name:circuit-flow;animation-timing-function:linear;animation-iteration-count:infinite}\
.ctvia{opacity:.35}\
@keyframes circuit-flow{to{stroke-dashoffset:-1600}}\
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}\
.eyebrow{text-transform:uppercase;letter-spacing:.24em;font-size:11px;font-weight:700;color:color-mix(in srgb,var(--steel) 55%,var(--text-dim))}\
button{font-family:inherit;color:inherit;cursor:pointer;background:none;border:0}\
a{color:var(--heat-2)}\
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\
input,textarea,select{font-family:inherit}\
.cut{clip-path:polygon(0 0,calc(100% - var(--cut)) 0,100% var(--cut),100% 100%,var(--cut) 100%,0 calc(100% - var(--cut)))}\
.cut-sm{--cut:9px}\
.drag{-webkit-app-region:drag}.nodrag{-webkit-app-region:no-drag}\
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\
@keyframes spin{to{transform:rotate(360deg)}}\
.spin{width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;display:inline-block;vertical-align:middle}\
.btn{border:1px solid var(--line);padding:9px 16px;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}\
.btn:hover{color:var(--text);border-color:var(--accent)}\
.btn.pri{border-color:var(--heat);background:linear-gradient(135deg,var(--heat-2),var(--heat));color:#1b1206}\
.btn.pri:hover{filter:brightness(1.08)}\
.btn[disabled]{opacity:.5;cursor:not-allowed}\
.field{width:100%;background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:10px 12px;font-size:13px;outline:none}\
.field:focus{border-color:var(--accent)}\
label.lb{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin:12px 0 6px}\
\
.tb{position:fixed;top:0;left:0;right:0;height:40px;display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;z-index:400;background:color-mix(in srgb,var(--ground) 88%,transparent);border-bottom:1px solid var(--line)}\
.tb .bi{display:flex;align-items:center;gap:8px;font-family:'Chakra Petch';font-weight:700;letter-spacing:.16em;font-size:12px}\
.tb .bi svg{width:18px;height:18px}\
.tb .sp{margin-left:auto}\
.tb .wc{width:34px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);border-radius:5px;font-size:15px}\
.tb .wc:hover{color:var(--text);background:rgba(255,255,255,.06)}\
.tb .wc.x:hover{color:#fff;background:var(--crit)}\
\
.screen{position:absolute;inset:40px 0 0 0;overflow-y:auto;overflow-x:hidden}\
.mid{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:safe center;padding:40px 20px;gap:0}\
.mid.full{padding:0;justify-content:stretch;align-items:stretch}\
*::-webkit-scrollbar{width:11px;height:11px}\
*::-webkit-scrollbar-track{background:var(--panel)}\
*::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--steel) 22%,var(--line));border:2px solid var(--panel);border-radius:6px}\
*::-webkit-scrollbar-thumb:hover{background:var(--steel)}\
*::-webkit-scrollbar-corner{background:var(--panel)}\
.content,.dbody,.modal .box,.rail,.adm pre,.consoles,.drawer .shots{scrollbar-width:thin;scrollbar-color:var(--line) var(--panel-2)}\
\
.lg{width:100%;max-width:390px;display:flex;flex-direction:column;align-items:center;animation:fade .4s ease}\
.lg .logo{width:70px;height:70px;filter:drop-shadow(0 0 26px color-mix(in srgb,var(--steel) 55%,transparent))}\
.lg .kick{margin:16px 0 6px;font-size:10.5px;letter-spacing:.26em;color:color-mix(in srgb,var(--steel) 60%,var(--text-dim));text-transform:uppercase;font-weight:700}\
.lg h1{font-size:25px;color:#fff;text-shadow:0 0 26px color-mix(in srgb,var(--steel) 30%,transparent)}.lg .sub{font-size:13px;color:var(--text-dim);margin-top:6px}\
.lg .panel{margin-top:26px;width:100%;background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);border-top:2px solid var(--steel);padding:22px}\
.lg input{width:100%;background:var(--ground);border:1px solid var(--line);color:var(--steel-2);padding:13px 14px;font-size:14px;font-weight:600;text-align:center;letter-spacing:.18em;text-transform:uppercase;outline:none}\
.lg input:focus{border-color:var(--steel);box-shadow:0 0 0 3px color-mix(in srgb,var(--steel) 14%,transparent)}\
.lg .msg-e{margin-top:10px;font-size:11.5px;color:var(--crit);background:color-mix(in srgb,var(--crit) 9%,transparent);border:1px solid color-mix(in srgb,var(--crit) 30%,transparent);padding:8px 10px}\
.lg .msg-o{margin-top:10px;font-size:11.5px;color:var(--good);background:color-mix(in srgb,var(--good) 9%,transparent);border:1px solid color-mix(in srgb,var(--good) 26%,transparent);padding:8px 10px;text-align:center}\
.lg .go{margin-top:14px;width:100%;padding:13px;font-weight:700;font-size:13px;color:#1b1206;background:linear-gradient(135deg,var(--heat-2),var(--heat));border:0}\
.lg .go[disabled]{background:var(--panel-2);color:var(--text-faint);cursor:not-allowed}\
.lg .alt{margin-top:16px;font-size:12.5px;color:var(--text-dim)}.lg .alt b{color:var(--steel);cursor:pointer}\
.foot{position:absolute;bottom:12px;width:100%;text-align:center;font-size:10.5px;letter-spacing:.1em;color:var(--text-faint)}\
.screen.auth{background:transparent}\
.screen.auth::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(color-mix(in srgb,var(--steel) 20%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--steel) 20%,transparent) 1px,transparent 1px);background-size:46px 46px;-webkit-mask-image:radial-gradient(ellipse 75% 70% at 50% 42%,#000 20%,transparent 82%);mask-image:radial-gradient(ellipse 75% 70% at 50% 42%,#000 20%,transparent 82%)}\
.sfield{position:absolute;inset:0;pointer-events:none;overflow:hidden}\
.sfield span{position:absolute;width:2px;height:2px;border-radius:50%;background:var(--heat-2);box-shadow:0 0 6px 1px color-mix(in srgb,var(--heat) 50%,transparent);opacity:.5;animation:tw 4s ease-in-out infinite}\
.sfield span:nth-child(1){left:16%;top:24%}.sfield span:nth-child(2){left:72%;top:18%;animation-delay:.6s}\
.sfield span:nth-child(3){left:42%;top:62%;width:1.5px;height:1.5px;animation-delay:1.2s}\
.sfield span:nth-child(4){left:86%;top:66%;animation-delay:.3s}.sfield span:nth-child(5){left:9%;top:74%;width:1.5px;height:1.5px;animation-delay:1.8s}\
.sfield span:nth-child(6){left:60%;top:82%;animation-delay:.9s}.sfield span:nth-child(7){left:28%;top:12%;width:1.5px;height:1.5px;animation-delay:2.4s}\
.sfield span:nth-child(8){left:91%;top:34%;animation-delay:1.5s}\
@keyframes tw{0%,100%{opacity:.25}50%{opacity:.8}}\
.lg .panel{position:relative;z-index:1;box-shadow:0 30px 80px rgba(0,0,0,.5)}\
\
.frame{width:min(1100px,100%);border:1px solid var(--line);background:var(--panel);animation:fade .4s ease}\
.frame.wide{width:100%;max-width:none;min-height:100%;border:0;background:transparent;display:flex;flex-direction:column;--px:clamp(24px,5vw,72px)}\
.hudbar{display:flex;align-items:center;gap:14px;padding:16px var(--px);border-bottom:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--panel) 90%,transparent),transparent)}\
.hudbar .mk{font-family:'Chakra Petch';font-weight:700;letter-spacing:.2em;font-size:17px;color:#fff;text-shadow:0 0 20px color-mix(in srgb,var(--steel) 40%,transparent)}\
.hudbar .rd{margin-left:auto;display:flex;gap:26px}\
.rd i{font-style:normal;display:block}.rd .k{font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:color-mix(in srgb,var(--steel) 45%,var(--text-faint));font-weight:700}.rd .v{font-size:12.5px;color:var(--text)}\
.dot{width:7px;height:7px;border-radius:50%;background:var(--good);box-shadow:0 0 10px 2px var(--good);display:inline-block;margin-right:6px}\
.chooser{flex:1;display:flex;flex-direction:column;justify-content:center;padding:40px var(--px);text-align:center;max-width:1400px;width:100%;margin:0 auto}\
.plats{display:flex;justify-content:center;align-items:center;gap:22px;margin-top:22px;flex-wrap:wrap}\
.plats b{font-family:'IBM Plex Mono';font-size:10.5px;letter-spacing:.16em;font-weight:500;color:var(--text-faint);display:inline-flex;align-items:center;gap:7px}\
.plats b::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--pc,var(--text-faint));box-shadow:0 0 8px 1px var(--pc,transparent)}\
.chooser h1{font-size:clamp(30px,4.5vw,54px);font-weight:700;line-height:1.05}\
.chooser h1 .fx{background:linear-gradient(100deg,var(--heat-2),var(--heat) 40%,var(--steel));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 30px color-mix(in srgb,var(--steel) 35%,transparent))}\
.chooser .sub{color:var(--text-dim);margin-top:12px;font-size:clamp(14px,1.4vw,17px)}\
.worlds{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:clamp(28px,4vh,52px);text-align:left}\
@media(max-width:820px){.worlds{grid-template-columns:1fr}}\
.world{position:relative;overflow:hidden;border:1px solid var(--line);background:linear-gradient(160deg,var(--panel-2),var(--panel));padding:clamp(26px,3vw,40px);min-height:clamp(240px,32vh,340px);display:flex;flex-direction:column;transition:border-color .18s,transform .18s,box-shadow .18s}\
.world::before{content:'';position:absolute;top:0;left:0;width:22px;height:22px;border-top:2px solid;border-left:2px solid;opacity:.7}\
.world::after{content:'';position:absolute;bottom:0;right:0;width:22px;height:22px;border-bottom:2px solid;border-right:2px solid;opacity:.7}\
.world.steam::before,.world.steam::after{border-color:var(--heat)}.world.retro::before,.world.retro::after{border-color:var(--steel)}\
.world:hover{transform:translateY(-4px)}\
.world.steam:hover{border-color:color-mix(in srgb,var(--heat) 60%,var(--line));box-shadow:0 20px 60px -20px color-mix(in srgb,var(--heat) 45%,transparent)}\
.world.retro:hover{border-color:color-mix(in srgb,var(--steel) 60%,var(--line));box-shadow:0 20px 60px -20px color-mix(in srgb,var(--steel) 45%,transparent)}\
.world .tag{font-family:'IBM Plex Mono';font-size:10.5px;letter-spacing:.24em;font-weight:500}\
.world.steam .tag{color:var(--heat-2)}.world.retro .tag{color:var(--steel-2)}\
.world h2{font-size:clamp(24px,2.6vw,34px);font-weight:700;margin-top:8px;color:#fff}\
.world p{color:var(--text-dim);margin:12px 0 0;max-width:44ch;font-size:14px}\
.world ul{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:7px}\
.world li{font-size:13px;color:var(--text-dim);padding-left:16px;position:relative}\
.world li::before{content:'';position:absolute;left:0;top:7px;width:7px;height:7px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}\
.world.steam li::before{background:var(--heat)}.world.retro li::before{background:var(--steel)}\
.world .go{margin-top:auto;align-self:flex-start;border:1px solid;padding:12px 26px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:12px;transition:background .15s,color .15s}\
.world.steam .go{border-color:color-mix(in srgb,var(--heat) 60%,var(--line));color:var(--heat-2)}\
.world.steam .go:hover{background:var(--heat);color:#1b1206}\
.world.retro .go{border-color:color-mix(in srgb,var(--steel) 60%,var(--line));color:var(--steel-2)}\
.world.retro .go:hover{background:var(--steel);color:#052027}\
.world.locked{filter:grayscale(.5)}\
.world .lk{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:color-mix(in srgb,var(--ground) 93%,transparent);backdrop-filter:blur(4px)}\
.world .lk span{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--text);font-weight:600}\
.efoot{display:flex;justify-content:space-between;align-items:center;padding:14px var(--px);border-top:1px solid var(--line);color:var(--text-faint);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;max-width:1400px;width:100%;margin:0 auto}\
.efoot span{cursor:pointer;transition:color .15s}.efoot span:hover{color:var(--steel-2)}\
\
.app{position:absolute;inset:40px 0 0 0;display:grid;grid-template-columns:224px 1fr;overflow:hidden}\
@media(max-width:900px){.app{grid-template-columns:66px 1fr}.rail .lbl,.rail .grp,.rail .who span,.rail .logo span{display:none}}\
.rail{border-right:1px solid var(--line);background:var(--panel-2);display:flex;flex-direction:column;padding:14px 0;overflow-y:auto;min-height:0}\
.rail .logo{padding:2px 18px 14px;display:flex;align-items:center;gap:9px;font-family:'Chakra Petch';font-weight:700;letter-spacing:.1em;font-size:14px}\
.rail .logo svg{width:20px;height:20px;flex:none}\
.rail .logo .v{font-family:'IBM Plex Mono';font-size:9px;color:var(--text-faint);margin-left:auto}\
.nav{display:flex;flex-direction:column;gap:1px}\
.nav button{display:flex;align-items:center;gap:11px;padding:9px 18px;color:var(--text-dim);font-weight:500;font-size:13px;text-align:left;border-left:2px solid transparent;width:100%}\
.nav button svg{width:15px;height:15px;flex:none;opacity:.75}\
.nav button.act{background:color-mix(in srgb,var(--accent) 11%,transparent);color:var(--text);border-left-color:var(--accent)}\
.nav button.act svg{opacity:1}\
.nav button:hover{color:var(--text)}\
.nav .grp{margin:13px 18px 3px;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-faint)}\
.rail .who{margin-top:auto;padding:12px 18px 2px;border-top:1px solid var(--line);font-size:12px;color:var(--text-dim)}\
.rail .who b{color:var(--text);display:block;font-family:'Chakra Petch';letter-spacing:.05em}\
.rail .who .lo{margin-top:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);cursor:pointer}\
.rail .who .lo:hover{color:var(--crit)}\
\
.main{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}\
.topbar{display:flex;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--ground) 45%,transparent)}\
.topbar h3{font-size:14px;letter-spacing:.14em;text-transform:uppercase}\
.topbar .exit{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);border:1px solid var(--line);padding:6px 11px}\
.topbar .exit:hover{color:var(--text)}\
.switch{display:flex;border:1px solid var(--line);margin-left:6px}\
.switch button{padding:7px 14px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)}\
.switch button.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text)}\
.content{padding:22px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0}\
\
.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}\
@media(max-width:720px){.strip{grid-template-columns:repeat(2,1fr)}}\
.stat{border:1px solid var(--line-soft);background:var(--panel-2);padding:12px 14px}\
.stat .k{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-faint)}\
.stat .n{font-family:'Chakra Petch';font-size:22px;font-weight:700;margin-top:5px;line-height:1}\
.stat .n em{font-style:normal;color:var(--accent)}.stat .n small{font-size:12px;color:var(--text-faint);font-weight:500}\
\
.sectionhead{display:flex;align-items:baseline;gap:12px;margin:2px 0 14px;flex-wrap:wrap}\
.sectionhead h4{font-size:12px;letter-spacing:.2em;text-transform:uppercase}\
.sectionhead .c{font-family:'IBM Plex Mono';font-size:11px;color:var(--text-faint)}\
.search{margin-left:auto;border:1px solid var(--line);background:var(--panel-2);padding:6px 12px;color:var(--text);font-size:12px;min-width:190px;outline:none}\
.search:focus{border-color:var(--accent)}\
\
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}\
.gcard{border:1px solid var(--line-soft);background:var(--card);overflow:hidden;transition:border-color .12s,transform .12s;display:flex;flex-direction:column}\
.gcard:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));transform:translateY(-2px)}\
.gcard .art{aspect-ratio:16/10;position:relative;display:flex;align-items:flex-end;padding:8px;background:linear-gradient(150deg,var(--a1),var(--a2));background-size:cover;background-position:center;cursor:pointer}\
.gcard .art .k{font-family:'IBM Plex Mono';font-size:9px;letter-spacing:.08em;color:rgba(255,255,255,.72);text-shadow:0 1px 3px rgba(0,0,0,.6)}\
.gcard .art .st{position:absolute;top:7px;left:7px;font-family:'IBM Plex Mono';font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;background:rgba(6,7,10,.72);border:1px solid rgba(255,255,255,.14)}\
.st.ok{color:var(--good)}.st.upd{color:var(--warn)}.st.get{color:var(--steel)}.st.dl{color:var(--heat-2)}.st.na{color:var(--text-faint)}\
.gcard .meta{padding:9px 10px 11px}\
.gcard .nm{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.gcard .act{margin-top:8px;width:100%;border:1px solid var(--line);color:var(--text-dim);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:6px 0;text-align:center}\
.gcard .act:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));color:var(--text)}\
.gcard .act.na{color:var(--text-faint);border-style:dashed;cursor:not-allowed}\
.gcard .act.busy{color:var(--heat-2);border-color:color-mix(in srgb,var(--heat) 45%,var(--line))}\
.gcard .prog{margin-top:8px;height:5px;background:var(--line);overflow:hidden}\
.gcard .prog i{display:block;height:100%;background:var(--heat);transition:width .3s}\
\
.badgerow{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}\
.chip{font-family:'IBM Plex Mono';font-size:10px;letter-spacing:.1em;border:1px solid var(--line);padding:4px 9px;color:var(--text-dim)}\
.chip.on{border-color:var(--accent);color:var(--text)}\
\
.consoles{display:flex;gap:9px;overflow-x:auto;padding-bottom:8px}\
.cbtn{flex:none;width:132px;border:1px solid var(--line-soft);background:var(--panel-2);padding:12px;cursor:pointer;text-align:left}\
.cbtn.sel{border-color:var(--steel);background:color-mix(in srgb,var(--steel) 10%,transparent)}\
.cbtn:hover{border-color:color-mix(in srgb,var(--steel) 45%,var(--line))}\
.cbtn .ab{font-family:'Chakra Petch';font-weight:700;font-size:17px}\
.cbtn .fl{font-size:10.5px;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.cbtn .ct{font-family:'IBM Plex Mono';font-size:9.5px;color:var(--text-faint);margin-top:7px}\
\
.rows{display:flex;flex-direction:column;border:1px solid var(--line-soft)}\
.lrow{display:flex;align-items:center;gap:14px;padding:12px 15px;border-bottom:1px solid var(--line-soft);font-size:13px}\
.lrow:last-child{border-bottom:0}\
.lrow .nm2{font-weight:600}.lrow .sub2{color:var(--text-faint);font-size:11px;font-family:'IBM Plex Mono'}\
.lrow .right{margin-left:auto;display:flex;align-items:center;gap:10px}\
.pill{font-family:'IBM Plex Mono';font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border:1px solid var(--line)}\
.pill.good{color:var(--good);border-color:color-mix(in srgb,var(--good) 40%,transparent)}\
.pill.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}\
.pill.idle{color:var(--text-faint)}\
.mini{border:1px solid var(--line);padding:5px 12px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}\
.mini:hover{color:var(--text);border-color:var(--accent)}\
.mini[disabled]{opacity:.5;cursor:not-allowed}\
.toggleSw{width:38px;height:20px;border:1px solid var(--line);background:var(--panel-2);position:relative;flex:none;cursor:pointer}\
.toggleSw::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;background:var(--text-faint);transition:.15s}\
.toggleSw.on{border-color:var(--accent)}.toggleSw.on::after{left:20px;background:var(--accent)}\
\
.plans{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}\
.plan{border:1px solid var(--line-soft);background:var(--panel-2);padding:20px 18px}\
.plan.feat{border-color:var(--accent)}\
.plan h4{font-size:16px}.plan .price{font-family:'Chakra Petch';font-size:28px;font-weight:700;margin:8px 0}\
.plan .price small{font-size:12px;color:var(--text-faint);font-weight:500}\
.plan ul{list-style:none;padding:0;margin:12px 0 16px;font-size:12.5px;color:var(--text-dim);display:flex;flex-direction:column;gap:6px}\
.plan .pick{width:100%;border:1px solid var(--line);padding:9px 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)}\
.plan.feat .pick{border-color:var(--accent);color:var(--text);background:color-mix(in srgb,var(--accent) 14%,transparent)}\
\
.drawer{position:fixed;inset:0;z-index:300;display:none}\
.drawer.on{display:block}\
.drawer .veil{position:absolute;inset:0;background:rgba(6,7,10,.66)}\
.drawer .panel{position:absolute;top:0;right:0;height:100%;width:min(460px,94vw);background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s}\
.drawer.on .panel{transform:none}\
.drawer .dhead{aspect-ratio:16/9;background:linear-gradient(150deg,var(--a1,#26324a),var(--a2,#0c1322));background-size:cover;background-position:center;position:relative}\
.drawer .dhead video{width:100%;height:100%;object-fit:cover;display:block;background:#000}\
.drawer .dhead .close{position:absolute;top:10px;right:10px;width:28px;height:28px;border:1px solid rgba(255,255,255,.2);background:rgba(6,7,10,.5);color:#fff}\
.drawer .dbody{padding:20px;overflow:auto;flex:1}\
.drawer h3{font-size:19px}\
.drawer .dmeta{display:flex;gap:14px;margin:10px 0 14px;font-family:'IBM Plex Mono';font-size:11px;color:var(--text-faint);flex-wrap:wrap}\
.drawer p{color:var(--text-dim);font-size:13.5px}\
.drawer .shots{display:flex;gap:6px;overflow-x:auto;margin-top:14px}\
.drawer .shots img{height:78px;border:1px solid var(--line);flex:none}\
.drawer .cta{margin-top:18px;display:flex;gap:8px}\
.drawer .cta button{flex:1;padding:12px 0;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line);color:var(--text)}\
.drawer .cta .go{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}\
\
.dlhud{position:fixed;right:18px;bottom:18px;z-index:150;width:290px;background:var(--panel);border:1px solid var(--line);display:none}\
.dlhud.on{display:block}\
.dlhud .hh{display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--line-soft);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim)}\
.dlhud .hh .pulse{width:7px;height:7px;background:var(--heat);border-radius:50%;box-shadow:0 0 8px 1px var(--heat)}\
.dlhud .it{padding:10px 13px;border-bottom:1px solid var(--line-soft);font-size:12px}\
.dlhud .it:last-child{border-bottom:0}\
.dlhud .it .tp{display:flex;justify-content:space-between;gap:8px}\
.dlhud .it .tp b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.dlhud .it .tp span{font-family:'IBM Plex Mono';font-size:10px;color:var(--text-faint);flex:none}\
.dlhud .it .bar{height:4px;background:var(--line);margin-top:6px;overflow:hidden}\
.dlhud .it .bar i{display:block;height:100%;background:var(--heat);transition:width .3s}\
.dlhud .it small{font-family:'IBM Plex Mono';font-size:9.5px;color:var(--text-faint)}\
\
.modal{position:fixed;inset:0;z-index:500;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(6,6,9,.82)}\
.modal.on{display:flex}\
.modal .box{width:460px;max-width:100%;background:var(--panel);border:1px solid color-mix(in srgb,var(--heat) 30%,var(--line));padding:24px;animation:fade .2s ease;max-height:88vh;overflow:auto}\
.modal h3{font-size:16px;color:#fff;margin-bottom:10px}\
.modal .txt{font-size:13px;line-height:1.6;color:var(--text-dim);white-space:pre-line;margin-bottom:18px}\
.modal .btns{display:flex;gap:8px;margin-top:6px}\
.modal .btns button{flex:1;padding:10px 0;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line);color:var(--text)}\
.modal .btns .pri{border-color:var(--heat);background:color-mix(in srgb,var(--heat) 15%,transparent)}\
.modal .qr{display:block;width:210px;height:210px;margin:0 auto 12px;background:#fff;padding:6px}\
.modal .code{width:100%;background:var(--ground);border:1px solid var(--line);color:var(--text-dim);font-family:'IBM Plex Mono';font-size:10px;padding:8px;word-break:break-all;max-height:90px;overflow:auto}\
.modal .stt{text-align:center;font-size:12px;color:var(--text-dim);margin:12px 0}\
\
.note{margin-top:22px;border:1px solid var(--line);border-left:2px solid var(--accent);background:var(--panel-2);padding:13px 15px;font-size:13px;color:var(--text-dim)}\
.note b{color:var(--text);font-family:'Chakra Petch'}\
.empty{color:var(--text-faint);font-size:13px;padding:40px 0;text-align:center}\
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:600;background:var(--panel);border:1px solid var(--accent);padding:10px 18px;font-size:12px;letter-spacing:.05em;color:var(--text);opacity:0;transition:opacity .2s;pointer-events:none}\
.toast.on{opacity:1}\
.adm{display:flex;flex-direction:column;gap:16px}\
.adm .acard{border:1px solid var(--line-soft);background:var(--panel-2);padding:16px}\
.adm textarea{width:100%;min-height:90px;background:var(--ground);border:1px solid var(--line);color:var(--text);font-family:'IBM Plex Mono';font-size:12px;padding:10px;outline:none}\
.adm pre{background:var(--ground);border:1px solid var(--line);padding:10px;overflow:auto;max-height:280px;font-family:'IBM Plex Mono';font-size:11px;color:var(--text-dim)}\
";

  /* ---------------------------------------------------------------- icons */
  var LOGO = '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffbe5c"/><stop offset=".55" stop-color="#ff9d1f"/><stop offset="1" stop-color="#37e0d6"/></linearGradient><radialGradient id="gc" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff4dc"/><stop offset=".4" stop-color="#ffbe5c"/><stop offset="1" stop-color="#a35f0c" stop-opacity="0"/></radialGradient></defs><circle cx="512" cy="512" r="250" fill="url(#gc)" opacity=".85"/><path fill="#14110c" stroke="url(#gr)" stroke-width="16" stroke-linejoin="round" d="M330 356h364c58 0 104 40 118 96l60 232c16 62-30 118-92 118-44 0-84-26-102-66l-24-54c-12-26-38-44-68-44h-208c-30 0-56 18-68 44l-24 54c-18 40-58 66-102 66-62 0-108-56-92-118l60-232c14-56 60-96 118-96z"/><g fill="#0c0a07" stroke="#ff9d1f" stroke-width="10"><rect x="360" y="470" width="120" height="42" rx="10"/><rect x="399" y="431" width="42" height="120" rx="10"/></g><circle cx="626" cy="452" r="24" fill="#37e0d6"/><circle cx="686" cy="500" r="24" fill="#ffbe5c"/><circle cx="566" cy="500" r="24" fill="#ffbe5c"/><circle cx="626" cy="548" r="24" fill="#37e0d6"/></svg>';
  function ic(name) {
    var p = {
      games: "M4 6h16v12H4zM8 3v3M16 3v3",
      grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
      shield: "M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z",
      key: "M9 12a3 3 0 116 0 3 3 0 01-6 0zM12 12h9M18 12v4",
      bell: "M6 9a6 6 0 1112 0v5l2 2H4l2-2z",
      dlc: "M4 5h16v14H4zM4 10h16M9 5v14",
      cart: "M4 5h2l2 11h10l2-8H7",
      gift: "M4 9h16v11H4zM4 9V7h16v2M12 3v17M8 3a2 2 0 002 4h2M16 3a2 2 0 01-2 4h-2",
      cog: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2M18 12h2M12 4v2M12 18v2",
      pad: "M6 8h12l3 9H3zM8 12h3M9.5 10.5v3",
      chip: "M8 8h8v8H8zM4 10v4M20 10v4M10 4h4M10 20h4",
      folder: "M4 6h6l2 2h8v10H4z",
      wrench: "M14 6a4 4 0 01-5 5L5 15l4 4 4-4a4 4 0 015-5z",
      user: "M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c1-4 4-6 7-6s6 2 7 6",
      spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"
    }[name] || "M4 4h16v16H4z";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + p + '"/></svg>';
  }

  /* ================================================================ boot */
  function buildCircuitBg() {
    var TRACES = [
      ["M40,120 H420 V300 H720 V80 H1040", "var(--steel)", 9, "-1s"],
      ["M1880,200 H1500 V420 H1200 V180 H900", "var(--heat)", 11, "-4s"],
      ["M120,980 H480 V760 H820 V920 H1150", "var(--xbox)", 10, "-2s"],
      ["M1860,900 H1560 V680 H1260 V860 H960", "var(--ps)", 12, "-6s"],
      ["M0,540 H260 V320 H560 V600 H880", "var(--switchc)", 8, "-3s"],
      ["M1920,560 H1660 V760 H1360 V500 H1080", "var(--neon)", 13, "-5s"],
      ["M300,40 V220 H600 V60 H900", "var(--steel-2)", 7.5, "-2.5s"],
      ["M1620,1080 V860 H1320 V1000 H1020", "var(--heat-2)", 10.5, "-1.5s"]
    ];
    var parts = TRACES.map(function (t) {
      var d = t[0], color = t[1], dur = t[2], delay = t[3];
      var pts = d.match(/-?\d+(\.\d+)?/g) || [];
      var x0 = pts[0], y0 = pts[1], x1 = pts[pts.length - 2], y1 = pts[pts.length - 1];
      return "<path d='" + d + "' class='ctbase' stroke='" + color + "'/>\
<path d='" + d + "' class='ctpulse' stroke='" + color + "' style='color:" + color + ";animation-duration:" + dur + "s;animation-delay:" + delay + "'/>\
<circle class='ctvia' cx='" + x0 + "' cy='" + y0 + "' r='3.5' fill='" + color + "'/>\
<circle class='ctvia' cx='" + x1 + "' cy='" + y1 + "' r='3.5' fill='" + color + "'/>";
    }).join("");
    var wrap = document.createElement("div");
    wrap.className = "circuit-bg";
    wrap.innerHTML = "<svg viewBox='0 0 1920 1080' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'>" + parts + "</svg>";
    return wrap;
  }

  function boot() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertBefore(buildCircuitBg(), document.body.firstChild);
    setTitle("Gamaxy");
    renderChrome();
    mount(bootView("Iniciando..."));

    call("getAppVersion").then(function (r) { S.version = (r && r.version) || ""; chromeVer(); });
    call("getHWID").then(function (r) { if (r && r.success) S.hwid = r.hwid; });
    loadNames();

    if (E.onSecurityForceWipe) try {
      E.onSecurityForceWipe(function (p) {
        try { E.securityWipeReport && E.securityWipeReport({ reason: (p && p.reason) || "forced", licenseKey: svc.getSaved() }); } catch (e) {}
        svc.clear(); location.reload();
      });
    } catch (e) {}

    var done = false;
    function proceed() { if (done) return; done = true; try { E.bootUpdateFinished && E.bootUpdateFinished(); } catch (e) {} afterBoot(); }
    var _updVersion = "";
    try {
      if (E.onUpdateNotAvailable) E.onUpdateNotAvailable(proceed);
      if (E.onUpdateError) E.onUpdateError(proceed);
      if (E.onUpdateAvailable) E.onUpdateAvailable(function (info) { _updVersion = (info && info.version) || ""; updateHud({ phase: "downloading", percent: 0, version: _updVersion }); });
      if (E.onUpdateDownloadProgress) E.onUpdateDownloadProgress(function (p) { updateHud({ phase: "downloading", percent: p && p.percent, transferred: p && p.transferred, total: p && p.total, version: _updVersion }); });
      if (E.onUpdateDownloaded) E.onUpdateDownloaded(function (info) { _updVersion = (info && info.version) || _updVersion; updateHud({ phase: "ready", version: _updVersion }); });
    } catch (e) {}
    if (E.bootCheckUpdates) { try { E.bootCheckUpdates(); } catch (e) {} setTimeout(proceed, 7000); }
    else proceed();
    setTimeout(proceed, 12000);
  }

  function afterBoot(tries) {
    tries = tries || 0;
    // Login SEMPRE aparece antes da escolha do sistema. A chave salva so
    // pre-preenche o campo — o usuario confirma "Entrar" e revalida no banco a
    // cada abertura (validate_license + vinculo de HWID).
    if (!S.hwid && tries < 12) { mount(bootView("Preparando...")); return void setTimeout(function () { afterBoot(tries + 1); }, 500); }
    go("login", { prefill: svc.getSaved() });
  }

  function authed() {
    svc.termsStatus(S.licenseKey).then(function (t) {
      if (t && t.accepted) postTerms(); else showTerms();
    });
  }

  function postTerms() {
    try { E.enableHidDll && E.enableHidDll(); } catch (e) {}
    try { E.setTelemetryContext && E.setTelemetryContext(S.licenseKey, S.hwid); } catch (e) {}
    try { E.reportLauncherEvent && E.reportLauncherEvent({ action: "login" }); } catch (e) {}
    try {
      E.licenseWatch && E.licenseWatch(S.licenseKey);
      E.onLicenseChanged && E.onLicenseChanged(function (i) { if (i && i.active === false) logout("Sua licenca foi desativada."); });
      E.onChargebackDetected && E.onChargebackDetected(function () { logout("Cobranca contestada — licenca suspensa. Fale com o suporte."); });
    } catch (e) {}
    startHb();
    S.isAdmin = isAdmin(); // chave ja e suficiente (ROGERIO3120); info refina depois
    svc.info(S.licenseKey).then(function (i) {
      i = i || {};
      S.licenseInfo = i;
      S.plan = {
        emuladores: i.emuladores, nsfw: i.nsfw, multiplayer: i.multiplayer,
        premiumaccounts: i.premiumaccounts, add_games: i.add_games,
        game_limit: (i.game_limit == null ? null : Number(i.game_limit)),
        dlc_limit: (i.dlc_limit == null ? null : Number(i.dlc_limit)),
        expires_at: i.expires_at || null,
        name: i.plan_name || i.plano || i.plan || (i.game_limit == null ? "Ilimitado" : "Plano ativo")
      };
      S.isAdmin = isAdmin();
      if (S.phase === "app" || S.phase === "entry") go(S.phase); // re-render com plano carregado
    });
    ipcUpdates().then(function (arr) {
      S.updates = Array.isArray(arr) ? arr : [];
      try {
        if (S.updates.length && !sessionStorage.getItem("gx_ann_seen")) {
          var u = S.updates[0];
          showModal(u.nome || "Comunicado", u.content || u.conteudo || "", [
            { t: "Fechar", act: function () { sessionStorage.setItem("gx_ann_seen", "1"); hideModal(); } },
            { t: "Dar feedback", pri: true, act: function () { sessionStorage.setItem("gx_ann_seen", "1"); openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Feedback Gamaxy: ")); hideModal(); } }
          ]);
        }
      } catch (e) {}
    });
    go("entry");
  }

  function startHb() {
    stopHb();
    hb = setInterval(function () {
      svc.checkStatus(S.licenseKey).then(function (r) { if (r && r.active === false) logout("Licenca inativa."); });
    }, 3e5);
  }
  function stopHb() { if (hb) { clearInterval(hb); hb = null; } }

  function logout(msg) {
    stopHb();
    try { E.licenseUnwatch && E.licenseUnwatch(); E.offLicenseChanged && E.offLicenseChanged(); } catch (e) {}
    svc.clear(); S.licenseKey = ""; S.licenseInfo = null; S.isAdmin = false;
    go("login", { msg: msg || "" });
  }

  function loadNames() {
    call("loadGamesDatabase").then(function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (g) {
        var id = String(g.appid || g.id || ""); if (id && g.name) S.names[id] = g.name;
        if (id && (g.appid || g.id)) S.db.push({ appid: id, name: g.name || ("App " + id) });
      });
    });
    // catalogo ALMAZ bundlado
    try {
      fetch("data/almaz_catalog.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (arr) {
        (Array.isArray(arr) ? arr : []).forEach(function (row) {
          var id = String(row[0]), nm = row[1];
          if (id && nm && !S.names[id]) S.names[id] = nm;
        });
      }).catch(function () {});
    } catch (e) {}
  }
  function nameOf(id, fallback) { return S.names[String(id)] || fallback || ("App " + id); }

  /* ============================================================== routing */
  function go(phase, opt) {
    S.phase = phase;
    if (phase === "login") { setTitle("Gamaxy — Login"); mount(loginView(opt || {})); }
    else if (phase === "signup") { setTitle("Gamaxy — Criar cadastro"); mount(signupView()); }
    else if (phase === "entry") { setTitle("Gamaxy — Entrada"); mount(entryView()); }
    else if (phase === "app") { setTitle("Gamaxy — " + (S.mode === "steam" ? "Steam" : "Retro")); mount(appView()); }
  }
  function mount(node) {
    var c = $(".tb"); root.innerHTML = "";
    if (c) root.appendChild(c);
    root.appendChild(node);
  }
  function setTitle(t) { try { document.title = t; } catch (e) {} }

  function renderChrome() {
    root.appendChild(h("div", { class: "tb drag" }, [
      h("div", { class: "bi", html: LOGO + "<span>GAMAXY&nbsp;1.0 <b style='color:var(--heat)'>DEV</b></span>" }),
      h("span", { class: "sp mono", id: "tbVer", style: "font-size:10px;color:var(--text-faint);letter-spacing:.12em" }, [""]),
      h("div", { class: "nodrag", style: "display:flex;gap:2px" }, [
        h("button", { class: "wc", title: "Minimizar", onclick: function () { E.minimizeApp && E.minimizeApp(); } }, ["−"]),
        h("button", { class: "wc", title: "Maximizar", onclick: function () { E.maximizeApp && E.maximizeApp(); } }, ["□"]),
        h("button", { class: "wc x", title: "Fechar", onclick: function () { E.closeApp && E.closeApp(); } }, ["×"])
      ])
    ]));
  }
  function chromeVer() { var v = $("#tbVer"); if (v) v.textContent = S.version ? "v" + S.version : ""; }

  /* =============================================================== views */
  function bootView(txt) {
    return h("div", { class: "screen" }, [h("div", { class: "mid" }, [
      h("div", { style: "text-align:center;animation:fade .4s ease" }, [
        h("div", { style: "width:74px;height:74px;margin:0 auto;filter:drop-shadow(0 0 26px rgba(255,157,31,.45))", html: LOGO }),
        h("div", { class: "eyebrow", style: "margin-top:18px" }, ["Gamaxy"]),
        h("div", { style: "margin-top:12px;display:flex;align-items:center;gap:9px;justify-content:center;color:var(--text-dim);font-size:12.5px" }, [h("span", { class: "spin" }), txt || ""])
      ])
    ])]);
  }

  function loginView(opt) {
    var input, btn, msgBox;
    function setMsg(type, text) { msgBox.innerHTML = ""; if (text) msgBox.appendChild(h("div", { class: type === "ok" ? "msg-o" : "msg-e" }, [text])); }
    function submit() {
      var k = (input.value || "").trim();
      if (!k) return setMsg("err", "Insira sua chave de licenca");
      if (!S.hwid) return setMsg("err", "Nao foi possivel obter o HWID");
      btn.disabled = true; btn.textContent = "Validando...";
      svc.validate(k).then(function (r) {
        if (r && r.success) {
          setMsg("ok", r.message || "Licenca validada");
          svc.save(k); S.licenseKey = k.toUpperCase();
          setTimeout(authed, 650);
        } else {
          btn.disabled = false; btn.textContent = "Entrar";
          setMsg("err", (r && r.message) || "Nao foi possivel validar sua licenca");
          if (r && r.isSuspended) {
            msgBox.appendChild(h("button", { class: "go", style: "margin-top:8px;background:linear-gradient(135deg,#25D366,#128C7E);color:#fff",
              onclick: function () { openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Minha licenca " + k.toUpperCase() + " esta suspensa/expirada. Quero regularizar.")); } }, ["Licenca suspensa — falar com o suporte"]));
          } else if (r && r.errorCode === "HWID_MISMATCH") {
            msgBox.appendChild(h("button", { class: "go", style: "margin-top:8px;background:linear-gradient(135deg,#25D366,#128C7E);color:#fff",
              onclick: function () { openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Ola! Minha licenca " + k.toUpperCase() + " esta vinculada a outro dispositivo.")); } }, ["Falar com o suporte"]));
          }
        }
      });
    }
    input = h("input", { placeholder: "XXXX-XXXX-XXXX", value: (svc.getSaved() || "").toUpperCase(), autofocus: "1",
      oninput: function () { input.value = input.value.toUpperCase(); msgBox.innerHTML = ""; },
      onkeydown: function (e) { if (e.key === "Enter") submit(); } });
    btn = h("button", { class: "go", onclick: submit }, ["Entrar"]);
    msgBox = h("div", {});
    if (opt.msg) setTimeout(function () { setMsg("err", opt.msg); }, 0);
    return h("div", { class: "screen auth" }, [
      starfield(),
      h("div", { class: "mid" }, [h("div", { class: "lg" }, [
        h("div", { class: "logo", html: LOGO }),
        h("div", { class: "kick" }, ["Gamaxy 1.0"]),
        h("h1", {}, ["Bem-vindo de volta"]),
        h("div", { class: "sub" }, ["Insira sua chave de licenca para acessar"]),
        h("div", { class: "panel cut" }, [h("label", { class: "lb", style: "margin-top:0" }, ["Chave de Licenca"]), input, msgBox, btn]),
        h("div", { class: "alt" }, ["Nao tem uma chave? ", h("b", { onclick: function () { go("signup"); } }, ["Criar cadastro →"])]),
        h("div", { class: "alt", style: "margin-top:8px" }, [h("b", { style: "color:var(--text-dim)", onclick: function () { openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Preciso de ajuda com meu login no Gamaxy.")); } }, ["Problema no login? Falar com o suporte"])])
      ])]),
      h("div", { class: "foot mono" }, ["Gamaxy 1.0 · canal Dev · HWID " + ((S.hwid || "").slice(0, 12) || "—")])
    ]);
  }

  function signupView() {
    var nome = h("input", { class: "field" }), email = h("input", { class: "field" }), tel = h("input", { class: "field", placeholder: "com DDD" }), ref = h("input", { class: "field", placeholder: "opcional" });
    var planSel = h("select", { class: "field" }, [h("option", { value: "" }, ["Vitalicio (padrao)"])]);
    var msg = h("div", {});
    call("listSignupPlans", undefined, undefined, { plans: [] }).then(function (r) {
      ((r && r.plans) || []).forEach(function (p) { planSel.appendChild(h("option", { value: p.key }, [(p.name || p.key) + " — " + money(p.price)])); });
    });
    var go1 = h("button", { class: "go", onclick: function () {
      var body = { nome: nome.value.trim(), email: email.value.trim(), numero: tel.value.trim(), planKey: planSel.value || null, referredBy: ref.value.trim() || null };
      if (!body.nome || !body.email || !body.numero) { msg.innerHTML = ""; msg.appendChild(h("div", { class: "msg-e" }, ["Preencha nome, e-mail e telefone"])); return; }
      go1.disabled = true; go1.textContent = "Gerando PIX...";
      call("signupCreatePix", body, undefined, { success: false }).then(function (r) {
        go1.disabled = false; go1.textContent = "Gerar PIX do cadastro";
        if (r && r.success && r.order) pixModal(r.order, "signupCheckStatus", function (res) {
          if (res && res.licenseKey) { svc.save(res.licenseKey); showModal("Licenca criada!", "Sua chave: " + res.licenseKey + "\n\nJa deixei salva. Toque em Entrar.", [{ t: "Ir para o login", pri: true, act: function () { hideModal(); go("login", { msg: "" }); } }]); }
        });
        else { msg.innerHTML = ""; msg.appendChild(h("div", { class: "msg-e" }, [(r && r.error) || "Falha ao gerar PIX"])); }
      });
    } }, ["Gerar PIX do cadastro"]);
    return h("div", { class: "screen auth" }, [
      starfield(),
      h("div", { class: "mid" }, [h("div", { class: "lg" }, [
        h("div", { class: "logo", html: LOGO }),
        h("div", { class: "kick" }, ["Gamaxy 1.0"]),
        h("h1", {}, ["Criar cadastro"]),
        h("div", { class: "sub" }, ["Crie a licenca por PIX. A chave aparece assim que o pagamento confirmar."]),
        h("div", { class: "panel cut", style: "text-align:left" }, [
          h("label", { class: "lb", style: "margin-top:0" }, ["Nome"]), nome,
          h("label", { class: "lb" }, ["E-mail"]), email,
          h("label", { class: "lb" }, ["Telefone (WhatsApp)"]), tel,
          h("label", { class: "lb" }, ["Plano"]), planSel,
          h("label", { class: "lb" }, ["Codigo de indicacao"]), ref,
          msg, h("div", { style: "height:6px" }), go1
        ]),
        h("div", { class: "alt" }, [h("b", { onclick: function () { go("login", { msg: "" }); } }, ["← Voltar ao login"])])
      ])]),
      h("div", { class: "foot mono" }, ["Gamaxy 1.0 · canal Dev"])
    ]);
  }

  function starfield() {
    return h("div", { class: "sfield", "aria-hidden": "true", html:
      "<span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>" });
  }

  function entryView() {
    var info = S.licenseInfo || {};
    var lic = S.isAdmin ? "FULL ADMIN" : ((S.plan && S.plan.name) || info.plan_name || info.plano || info.plan || "Licenca ativa");
    var retroAllowed = can("emuladores");
    var ownsRetro = retroAllowed, retroEl;
    var exp = S.plan && S.plan.expires_at ? fmtDate(S.plan.expires_at) : "";
    var v = h("div", { class: "screen auth" }, [starfield(), h("div", { class: "mid full" }, [
      h("div", { class: "frame wide" }, [
        h("div", { class: "hudbar" }, [
          h("span", { class: "mk", html: "GAMAXY&nbsp;1.0" }),
          h("span", { class: "mono", style: "font-size:11px;color:var(--text-faint);letter-spacing:.12em" }, [S.version ? "v" + S.version : "dev"]),
          h("div", { class: "rd" }, [
            h("i", { html: "<span class='k'>Licenca</span><span class='v mono'>" + esc(lic) + "</span>" }),
            h("i", { html: "<span class='k'>Chave</span><span class='v mono'>" + esc(S.licenseKey || "-") + "</span>" }),
            exp ? h("i", { html: "<span class='k'>Expira</span><span class='v'>" + esc(exp) + "</span>" }) : null,
            h("i", { html: "<span class='k'>Servico</span><span class='v'><span class='dot'></span>Online</span>" })
          ])
        ]),
        h("div", { class: "chooser" }, [
          h("span", { class: "eyebrow" }, ["Steam + retro, uma orbita"]),
          h("h1", { html: "Toda a sua<br><span class='fx'>galaxia de jogos.</span>" }),
          h("p", { class: "sub" }, ["Do lancamento de hoje ao fliperama de 1990 — num app so."]),
          h("div", { class: "plats" }, [
            ["PC", "var(--steel)"], ["XBOX", "var(--xbox)"], ["PLAYSTATION", "var(--ps)"], ["NINTENDO", "var(--switchc)"], ["SEGA", "var(--heat-2)"]
          ].map(function (p) { return h("b", { style: "--pc:" + p[1] }, [p[0]]); })),
          h("div", { class: "worlds" }, [
            h("div", { class: "world steam cut" }, [
              h("span", { class: "tag" }, ["CAMADA · MODERNA"]),
              h("h2", {}, ["Biblioteca Steam"]),
              h("p", {}, ["Sua conta, viva e atualizada — desbloqueio, bypass, Denuvo e contas oficiais."]),
              h("ul", { html: "<li>Instalar pela base local</li><li>Bypass + remocao de Denuvo</li><li>Loja, DLCs e indicacoes</li>" }),
              h("button", { class: "go", onclick: function () { enter("steam"); } }, ["Abrir Steam"])
            ]),
            (retroEl = h("div", { class: "world retro cut" }, [
              h("span", { class: "tag" }, ["CAMADA · CLASSICA"]),
              h("h2", {}, ["Arcade & Consoles"]),
              h("p", {}, ["Fliperama e consoles preservados — escolhe o sistema, o jogo baixa e roda no emulador certo."]),
              h("ul", { html: "<li>Servidor proprio de ROMs</li><li>Emuladores sob demanda</li><li>Controle plug-and-play</li>" }),
              h("button", { class: "go", onclick: function () { enter("retro"); } }, ["Abrir Arcade & Consoles"])
            ]))
          ])
        ]),
        h("div", { class: "efoot" }, [
          h("span", { style: "cursor:default" }, ["Gamaxy · build Dev"]),
          h("span", { style: "display:flex;gap:22px" }, [
            h("span", { onclick: function () { S.mode = "steam"; S.page = "config"; go("app"); } }, ["⚙ Configuracoes"]),
            (S.isAdmin ? h("span", { onclick: function () { S.mode = "steam"; S.page = "admin"; go("app"); } }, ["Painel Admin"]) : null),
            h("span", { onclick: function () { openUrl("https://wa.me/5543988322483"); } }, ["Suporte"]),
            h("span", { onclick: function () { confirmLogout(); } }, ["Sair"])
          ])
        ])
      ])
    ])]);
    if (!retroAllowed) {
      retroEl.classList.add("locked");
      retroEl.appendChild(h("div", { class: "lk" }, [
        h("span", {}, ["Nao incluido no seu plano"]),
        h("button", { class: "btn", onclick: function () { enter("steam"); S.page = "loja"; renderPage($("#content")); } }, ["Desbloquear na Loja"])
      ]));
    } else {
      call("arenaCheckInstalled").then(function (r) {
        if (!(r && r.installed)) {
          retroEl.classList.add("locked");
          retroEl.appendChild(h("div", { class: "lk" }, [
            h("span", {}, ["Nao instalado neste PC"]),
            h("button", { class: "btn", onclick: function () { enter("retro"); } }, ["Instalar camada classica"])
          ]));
        }
      });
    }
    return v;
  }
  function enter(mode) {
    if (mode === "retro" && !can("emuladores")) {
      S.mode = "steam"; S.page = "loja"; go("app"); toast("Camada Retro nao esta no seu plano — veja a Loja."); return;
    }
    S.mode = mode; S.page = "home"; S.search = "";
    document.documentElement.style.setProperty("--accent", mode === "steam" ? "var(--heat)" : "var(--steel)");
    go("app");
  }

  /* ------------------------------------------------------------ app shell */
  function navItems() {
    if (S.mode === "retro") {
      return [["home", "Sistemas", "pad"], ["instalados", "Instalados", "games"], ["emu", "Emuladores", "chip"],
        ["__g", "Biblioteca"], ["solicitar", "Solicitar Jogo", "spark"], ["pasta", "Pasta de ROMs", "folder"],
        ["__g", "Sistema"], ["controles", "Controles", "pad"], ["config", "Configuracoes", "cog"]]
        .concat(S.isAdmin ? [["__g", "Interno"], ["admin", "Painel Admin", "wrench"]] : []);
    }
    var it = [["home", "Meus Jogos", "games"], ["catalogo", "Catalogo", "grid"], ["addgame", "Adicionar Jogo", "spark"],
      ["__g", "Ferramentas"], ["bypass", "Bypass", "shield"]];
    if (can("multiplayer")) it.push(["multiplayer", "Multiplayer", "pad"]);
    it.push(["denuvo", "Remover Denuvo", "key"]);
    if (can("premiumaccounts")) it.push(["contas", "Contas Oficiais", "user"]);
    it.push(["dlc", "DLCs", "dlc"]);
    if (can("nsfw")) it.push(["nsfw", "+18", "spark"]);
    it.push(["__g", "Conta"], ["novidades", "Novidades", "bell"], ["tutoriais", "Tutoriais", "grid"],
      ["loja", "Loja", "cart"], ["indicacoes", "Indique e Ganhe", "gift"], ["config", "Configuracoes", "cog"]);
    if (S.isAdmin) it.push(["__g", "Interno"], ["admin", "Painel Admin", "wrench"]);
    return it;
  }
  var TITLES = { home: S_home, catalogo: "Catalogo", addgame: "Adicionar Jogo", bypass: "Bypass", multiplayer: "Multiplayer",
    denuvo: "Remover Denuvo", contas: "Contas Oficiais", dlc: "DLCs", nsfw: "+18", novidades: "Novidades", tutoriais: "Tutoriais",
    loja: "Loja", indicacoes: "Indique e Ganha", config: "Configuracoes",
    instalados: "Instalados", emu: "Emuladores", solicitar: "Solicitar Jogo", pasta: "Pasta de ROMs", controles: "Controles", admin: "Painel Admin", cadastro: "Criar cadastro" };
  function S_home() { return S.mode === "retro" ? "Sistemas" : "Meus Jogos"; }
  function titleOf(p) { var t = TITLES[p]; return typeof t === "function" ? t() : (t || "Gamaxy"); }

  function appView() {
    var railNav = h("nav", { class: "nav", id: "nav" }, []);
    var content = h("div", { class: "content", id: "content" }, []);
    var pageTitle = h("h3", { id: "pageTitle" }, [titleOf(S.page)]);
    var modeSwitch = h("div", { class: "switch", id: "modeSwitch" }, [
      h("button", { "data-mode": "steam", onclick: function () { enter("steam"); } }, ["Steam"]),
      h("button", { "data-mode": "retro", title: can("emuladores") ? "" : "Nao incluido no seu plano", style: can("emuladores") ? "" : "opacity:.5", onclick: function () { enter("retro"); } }, ["Retro"])
    ]);
    var v = h("div", { class: "app" }, [
      h("aside", { class: "rail" }, [
        h("div", { class: "logo", html: LOGO + "<span>GAMAXY&nbsp;1.0</span><span class='v'>" + (S.version || "dev") + "</span>" }),
        railNav,
        h("div", { class: "who" }, [
          h("b", {}, [((S.licenseInfo && (S.licenseInfo.nome || S.licenseInfo.name)) || "Jogador")]),
          h("span", { class: "mono", style: "font-size:10px" }, [(S.licenseKey || "")]),
          h("span", {}, [
            (S.isAdmin ? "★ FULL ADMIN" : ((S.plan && S.plan.name) || "Licenca ativa")) +
            (!S.isAdmin && S.plan && S.plan.game_limit != null ? " · " + S.myGames.size + "/" + S.plan.game_limit : "")
          ]),
          h("div", { class: "lo", onclick: function () { confirmLogout(); } }, ["Sair"])
        ])
      ]),
      h("div", { class: "main" }, [
        h("div", { class: "topbar" }, [pageTitle, h("button", { class: "exit", onclick: function () { go("entry"); } }, ["◄ Trocar bancada"]), modeSwitch]),
        content
      ])
    ]);
    $$("button", modeSwitch).forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === S.mode); });
    renderNav(railNav);
    renderPage(content);
    return v;
  }

  function renderNav(nav) {
    nav.innerHTML = "";
    var items = navItems();
    items.forEach(function (it) {
      if (it[0] === "__g") { nav.appendChild(h("div", { class: "grp" }, [it[1]])); return; }
      var b = h("button", { class: it[0] === S.page ? "act" : "", html: ic(it[2]) + "<span class='lbl'>" + esc(it[1]) + "</span>", onclick: function () {
        S.page = it[0]; S.search = "";
        $("#pageTitle").textContent = titleOf(it[0]);
        $$("#nav button").forEach(function (x) { x.classList.remove("act"); });
        b.classList.add("act");
        renderPage($("#content"));
        setTitle("Gamaxy — " + titleOf(it[0]));
      } });
      nav.appendChild(b);
    });
  }

  function renderPage(c) {
    if (typeof _padPoll !== "undefined" && _padPoll) { cancelAnimationFrame(_padPoll); _padPoll = null; }
    c.innerHTML = "";
    var P = S.page, M = S.mode;
    if (M === "steam") {
      if (P === "home") return steamHome(c);
      if (P === "catalogo") return steamCatalog(c);
      if (P === "addgame") return addGamePage(c);
      if (P === "bypass") return steamBypass(c, "bypass");
      if (P === "multiplayer") return steamBypass(c, "multiplayer");
      if (P === "denuvo") return denuvoPage(c);
      if (P === "contas") return contasPage(c);
      if (P === "dlc") return dlcPage(c);
      if (P === "nsfw") return nsfwPage(c);
      if (P === "novidades") return newsPage(c);
      if (P === "tutoriais") return tutoriaisPage(c);
      if (P === "loja") return lojaPage(c);
      if (P === "indicacoes") return indicacoesPage(c);
      if (P === "config") return configPage(c);
      if (P === "cadastro") return cadastroPage(c);
      if (P === "admin") return adminPage(c);
    } else {
      if (P === "home") return retroHome(c);
      if (P === "instalados") return retroInstalled(c);
      if (P === "emu") return retroEmu(c);
      if (P === "solicitar") return retroRequest(c);
      if (P === "pasta") return retroPath(c);
      if (P === "controles") return controlesPage(c);
      if (P === "config") return configPage(c);
      if (P === "admin") return adminPage(c);
    }
    c.appendChild(h("div", { class: "empty" }, ["Em construcao."]));
  }

  /* ------------------------------------------------------- STEAM: my games */
  function steamHome(c) {
    var stripEl = h("div", { class: "strip" }, []);
    c.appendChild(stripEl);
    var head = h("div", { class: "sectionhead" }, [h("h4", {}, ["Meus Jogos"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar nos meus jogos...")]);
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    c.appendChild(head); c.appendChild(grid); c.appendChild(steamNote());

    function stats() {
      stripEl.innerHTML = "";
      [stat("Instalados", String(S.myGames.size) + (!S.isAdmin && S.plan && S.plan.game_limit != null ? " <small>/ " + S.plan.game_limit + "</small>" : ""), 1),
       stat("Plano", "<span style='font-size:15px'>" + esc(S.isAdmin ? "FULL ADMIN" : ((S.plan && S.plan.name) || "ativo")) + "</span>", 1),
       stat("Steam", "<span style='font-size:17px;color:" + (S.steam.found ? "var(--good)" : S.steam.found === false ? "var(--crit)" : "var(--text-faint)") + "'>" + (S.steam.found ? "Detectada" : S.steam.found === false ? "Nao encontrada" : "...") + "</span>", 1),
       statSystemToggle()].forEach(function (x) { stripEl.appendChild(x); });
    }
    stats();
    call("checkSteamSetup").then(function (r) { S.steam.found = !!(r && r.steamFound); stats(); });

    call("getMyGames", undefined, undefined, { games: [] }).then(function (r) {
      ((r && r.games) || []).forEach(function (g) { S.myGames.add(String(g.appid)); if (g.name) S.names[String(g.appid)] = g.name; });
      stats();
      var list = Array.from(S.myGames).map(function (id) { return { name: nameOf(id), id: id, st: "ok" }; })
        .filter(function (g) { return !nsfwHide(g.name); })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      fillGrid(grid, list, "steam");
    });
  }

  /* ------------------------------------------------------- STEAM: catalogo */
  function steamCatalog(c) {
    var head = h("div", { class: "sectionhead" }, [h("h4", {}, ["Catalogo · base local"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar no catalogo...")]);
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    c.appendChild(head); c.appendChild(grid); c.appendChild(steamNote());
    function paint() {
      var q = S.search.trim().toLowerCase();
      var src = S.db.length ? S.db : Object.keys(S.names).map(function (id) { return { appid: id, name: S.names[id] }; });
      var list = src.filter(function (g) { return (!q || (g.name || "").toLowerCase().indexOf(q) >= 0) && !nsfwHide(g.name); })
        .map(function (g) { var id = String(g.appid || g.id); return { name: g.name, id: id, st: S.myGames.has(id) ? "ok" : "get" }; });
      fillGridPaged(grid, list, "steam");
    }
    if (S.db.length || Object.keys(S.names).length) paint();
    else call("loadGamesDatabase", undefined, undefined, []).then(function (arr) {
      S.db = (Array.isArray(arr) ? arr : []).filter(function (g) { return g && (g.appid || g.id) && g.name; });
      paint();
    });
  }

  /* --------------------------------------------------- STEAM: adicionar jogo */
  function addGamePage(c) {
    if (!can("add_games")) {
      c.appendChild(h("div", { class: "note", html: "<b>Seu plano nao permite adicionar jogos avulsos.</b> Voce ainda joga tudo que ja vem no pacote. Veja a Loja para liberar." }));
      c.appendChild(h("button", { class: "btn pri", style: "margin-top:12px", onclick: function () { S.page = "loja"; renderPage($("#content")); } }, ["Ver planos"]));
      return;
    }
    var appid = h("input", { class: "field", placeholder: "ID Steam do jogo (ex: 1091500)" });
    var out = h("div", { style: "margin-top:12px" }, []);
    c.appendChild(h("div", { style: "max-width:420px" }, [
      h("div", { class: "note", html: "<b>Instalar por ID.</b> Cola o AppID da Steam. A gente instala pela base local (Servidor 2). Fora da base = 'Nao disponivel'." }),
      h("label", { class: "lb" }, ["AppID"]), appid,
      h("button", { class: "btn pri", style: "margin-top:12px;width:100%", onclick: function () {
        var id = (appid.value || "").replace(/\D/g, "");
        if (!id) return toast("Informe um AppID numerico");
        if (!can("game_limit_ok")) return toast("Limite do seu plano: " + S.plan.game_limit + " jogos.");
        out.innerHTML = ""; out.appendChild(h("div", { style: "display:flex;gap:8px;align-items:center;color:var(--text-dim)" }, [h("span", { class: "spin" }), " instalando " + id + "..."]));
        (E.downloadManifestorLua ? E.downloadManifestorLua(id, nameOf(id, "App " + id), false, 2) : Promise.resolve({ success: false })).then(function (r) {
          out.innerHTML = "";
          if (r && r.success) { S.myGames.add(id); out.appendChild(h("div", { class: "msg-o" }, [(r.gameName || nameOf(id)) + " instalado. Reinicie a Steam se preciso."])); }
          else out.appendChild(h("div", { class: "msg-e" }, [(r && r.error) || "Este jogo ainda nao esta disponivel para instalacao."]));
        });
      } }, ["Instalar"]),
      out
    ]));
  }

  /* --------------------------------------------------------- STEAM: bypass */
  S._bpCache = {};
  function steamBypass(c, kind) {
    kind = kind || "bypass";
    var badges = h("div", { class: "badgerow", id: "bB" }, []);
    var head = h("div", { class: "sectionhead" }, [h("h4", {}, [kind === "multiplayer" ? "Bypass Multiplayer" : "Catalogo de Bypass"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar...")]);
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    c.appendChild(badges); c.appendChild(head); c.appendChild(grid); c.appendChild(steamNote());
    function paint() {
      var arr = S._bpCache[kind] || [];
      var total = arr.length, av = arr.filter(function (x) { return x.available !== false; }).length;
      badges.innerHTML = "";
      [total + " total", av + " disponiveis", (total - av) + " indisponiveis"].forEach(function (t, i) { badges.appendChild(h("span", { class: "chip" + (i === 0 ? " on" : "") }, [t])); });
      var q = S.search.trim().toLowerCase();
      var list = arr.filter(function (x) { return !q || (x.name || "").toLowerCase().indexOf(q) >= 0; })
        .map(function (x) { return { name: x.name, id: String(x.appid), st: x.available === false ? "na" : "get", bypass: x }; });
      fillGrid(grid, list, "bypass");
    }
    if (S._bpCache[kind]) paint();
    else call("fetchBypassCatalog", kind, undefined, { items: [] }).then(function (r) { S._bpCache[kind] = (r && r.items) || []; paint(); });
  }

  /* ------------------------------------------------------------ STEAM: +18 */
  function nsfwPage(c) {
    if (!can("nsfw")) { c.appendChild(h("div", { class: "empty" }, ["Conteudo +18 nao liberado no seu plano."])); return; }
    var head = h("div", { class: "sectionhead" }, [h("h4", {}, ["Catalogo +18"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar...")]);
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    c.appendChild(head); c.appendChild(grid);
    function paint() {
      var q = S.search.trim().toLowerCase();
      var src = S.db.length ? S.db : Object.keys(S.names).map(function (id) { return { appid: id, name: S.names[id] }; });
      var list = src.filter(function (g) { return NSFW_RE.test(g.name || "") && (!q || (g.name || "").toLowerCase().indexOf(q) >= 0); })
        .map(function (g) { var id = String(g.appid || g.id); return { name: g.name, id: id, st: S.myGames.has(id) ? "ok" : "get" }; });
      fillGridPaged(grid, list, "steam");
    }
    if (S.db.length || Object.keys(S.names).length) paint();
    else call("loadGamesDatabase", undefined, undefined, []).then(function (arr) { S.db = (Array.isArray(arr) ? arr : []).filter(function (g) { return g && (g.appid || g.id) && g.name; }); paint(); });
  }

  /* ------------------------------------------------------- STEAM: tutoriais */
  function tutoriaisPage(c) {
    var box = h("div", {}, [loadingCell()]); c.appendChild(box);
    call("tutorialsList", undefined, undefined, { tutorials: [] }).then(function (r) {
      var list = (r && r.tutorials) || [];
      box.innerHTML = "";
      if (!list.length) { box.appendChild(h("div", { class: "empty" }, ["Sem tutoriais no momento."])); return; }
      box.appendChild(h("div", { class: "rows" }, list.map(function (t) {
        return h("div", { class: "lrow" }, [
          h("div", {}, [h("div", { class: "nm2" }, [t.title || t.titulo || "Tutorial"]), h("div", { class: "sub2", style: "white-space:pre-line" }, [(t.description || t.descricao || "").slice(0, 300)])]),
          h("div", { class: "right" }, [(t.url || t.link || t.video_url) ? h("button", { class: "mini", onclick: function () { openUrl(t.url || t.link || t.video_url); } }, ["Abrir"]) : null])
        ]);
      })));
    });
  }

  /* --------------------------------------------------------- STEAM: denuvo */
  function denuvoPage(c) {
    var head = h("div", { class: "sectionhead" }, [h("h4", {}, ["Jogos com Denuvo"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar jogo...")]);
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    var ords = h("div", {}, []);
    c.appendChild(head); c.appendChild(grid); c.appendChild(ords);
    c.appendChild(h("div", { class: "note", html: "<b>Como funciona.</b> A remocao de Denuvo e um servico pago por jogo. Voce paga por PIX aqui, e quando confirmar o pagamento libera o download do executavel sem Denuvo." }));

    function paintOrders() {
      ords.innerHTML = "";
      if (!S.denuvoOrders.length) return;
      ords.appendChild(h("div", { class: "sectionhead", style: "margin-top:22px" }, [h("h4", {}, ["Meus pedidos"])]));
      ords.appendChild(h("div", { class: "rows" }, S.denuvoOrders.map(function (o) {
        var paid = o.status === "paid" || o.status === "fulfilled";
        return h("div", { class: "lrow" }, [
          h("div", {}, [h("div", { class: "nm2" }, [o.product_name || "Denuvo"]), h("div", { class: "sub2" }, [fmtDate(o.created_at) + " · " + money(o.amount)])]),
          h("div", { class: "right" }, [
            h("span", { class: "pill " + (paid ? "good" : "idle") }, [paid ? "pago" : o.status]),
            paid ? h("button", { class: "mini", onclick: function () { denuvoDownload(o.txid); } }, ["Baixar"])
                 : h("button", { class: "mini", onclick: function () { pixPoll(o.txid, "denuvoCheckStatus", function () { loadDenuvoOrders(); }); } }, ["Ja paguei"])
          ])
        ]);
      })));
    }
    function loadDenuvoOrders() {
      call("denuvoListMyOrders", S.licenseKey, undefined, { orders: [] }).then(function (r) { S.denuvoOrders = (r && r.orders) || []; paintOrders(); });
    }
    call("denuvoListGames", undefined, undefined, { games: [] }).then(function (r) {
      S.denuvoGames = (r && r.games) || [];
      var q = S.search.trim().toLowerCase();
      var list = S.denuvoGames.filter(function (g) { return !q || (g.name || "").toLowerCase().indexOf(q) >= 0; })
        .map(function (g) { return { name: g.name, id: String(g.game_id || g.id), st: "get", denuvo: g }; });
      fillGrid(grid, list, "denuvo");
    });
    loadDenuvoOrders();
    denuvoPage._reload = loadDenuvoOrders;
  }
  function denuvoBuy(g) {
    showModal("Remover Denuvo — " + g.name, "Valor: " + money(g.price) + "\n\nGera um PIX para pagamento. Depois de pago, o download e liberado na aba “Meus pedidos”.", [
      { t: "Cancelar", act: hideModal },
      { t: "Gerar PIX", pri: true, act: function () {
        hideModal();
        call("denuvoCreateOrder", { licenseKey: S.licenseKey, licenseName: (S.licenseInfo && S.licenseInfo.nome) || "", gameId: String(g.game_id || g.id), couponCode: "" }, undefined, { success: false })
          .then(function (r) {
            if (r && r.success && r.order) pixModal(r.order, "denuvoCheckStatus", function () { if (denuvoPage._reload) denuvoPage._reload(); toast("Pedido registrado"); });
            else toast((r && r.error) || "Falha ao gerar PIX");
          });
      } }
    ]);
  }
  function denuvoDownload(txid) {
    toast("Liberando download...");
    call("denuvoGetDownload", txid, undefined, { ok: false }).then(function (r) {
      if (r && (r.ok || r.url || r.download_url)) {
        var u = r.url || r.download_url || (r.data && r.data.url);
        if (u) { openUrl(u); toast("Download aberto"); }
        else showModal("Download liberado", JSON.stringify(r, null, 2), [{ t: "Ok", pri: true, act: hideModal }]);
      } else toast((r && r.error) || "Falha ao liberar");
    });
  }

  /* --------------------------------------------------------- STEAM: contas */
  function contasPage(c) {
    c.appendChild(h("div", { class: "note", style: "border-left-color:var(--steel)", html:
      "<b>Contas Oficiais.</b> Contas Steam legitimas com jogos multiplayer/online que nao rodam por bypass. A liberacao e feita pelo suporte conforme seu plano." }));
    c.appendChild(h("div", { style: "margin-top:16px;display:flex;gap:8px;flex-wrap:wrap" }, [
      h("button", { class: "btn pri", onclick: function () { openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Quero acesso as Contas Oficiais. Licenca: " + S.licenseKey)); } }, ["Pedir acesso no WhatsApp"]),
      h("button", { class: "btn", onclick: function () { openUrl("https://titanforge.com.br"); } }, ["Ver planos"])
    ]));
  }

  /* ------------------------------------------------------------ STEAM: dlc */
  function dlcPage(c) {
    c.appendChild(h("div", { class: "sectionhead" }, [h("h4", {}, ["DLCs por jogo"]), h("span", { class: "c" }, ["escolha um jogo instalado"])]));
    var sel = h("select", { class: "field", style: "max-width:340px" }, [h("option", { value: "" }, ["— selecione —"])]);
    Array.from(S.myGames).map(function (id) { return { id: id, name: nameOf(id) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (g) { sel.appendChild(h("option", { value: g.id }, [g.name])); });
    c.appendChild(sel);
    var box = h("div", { style: "margin-top:16px" }, []);
    c.appendChild(box);
    sel.addEventListener("change", function () {
      var appid = sel.value; box.innerHTML = "";
      if (!appid) return;
      box.appendChild(h("div", { class: "empty" }, [h("span", { class: "spin" }), " buscando DLCs..."]));
      call("fetchSteamGameData", appid, undefined, {}).then(function (d) {
        var data = (d && (d.data || d)) || {};
        var dlcIds = (data.dlc || (data[appid] && data[appid].data && data[appid].data.dlc) || []).map(String);
        box.innerHTML = "";
        if (!dlcIds.length) { box.appendChild(h("div", { class: "empty" }, ["Esse jogo nao tem DLCs listadas."])); return; }
        call("listInstalledDlc", dlcIds, undefined, { installed: [] }).then(function (r) {
          var inst = new Set((r && r.installed) || []);
          box.appendChild(h("div", { class: "rows" }, dlcIds.map(function (did) {
            var has = inst.has(did);
            return h("div", { class: "lrow" }, [
              h("div", {}, [h("div", { class: "nm2" }, [nameOf(did, "DLC " + did)]), h("div", { class: "sub2" }, ["APPID " + did])]),
              h("div", { class: "right" }, [has ? h("span", { class: "pill good" }, ["instalada"]) : (function () {
                var b = h("button", { class: "mini", onclick: function () {
                  b.disabled = true; b.textContent = "Instalando...";
                  call("downloadDlcManifest", did, appid, undefined, { success: false }).then(function (rr) {
                    if (rr && rr.success) { b.replaceWith(h("span", { class: "pill good" }, ["instalada"])); toast("DLC instalada"); }
                    else { b.disabled = false; b.textContent = "Tentar de novo"; toast((rr && rr.error) || "Falha"); }
                  });
                } }, ["Instalar"]);
                return b;
              })()])
            ]);
          })));
        });
      });
    });
  }

  /* ------------------------------------------------------- STEAM: novidades */
  function newsPage(c) {
    if (!S.updates.length) { c.appendChild(h("div", { class: "empty" }, ["Sem novidades no momento."])); return; }
    c.appendChild(h("div", { class: "rows" }, S.updates.map(function (u) {
      return h("div", { class: "lrow" }, [
        h("div", {}, [h("div", { class: "nm2" }, [u.nome || "Atualizacao"]),
          h("div", { style: "color:var(--text-dim);font-size:12px;margin-top:3px;white-space:pre-line" }, [(u.content || u.conteudo || "").slice(0, 500)])]),
        h("div", { class: "right" }, [h("span", { class: "sub2" }, [fmtDate(u.created_at)])])
      ]);
    })));
  }

  /* ---------------------------------------------------------- STEAM: loja */
  function lojaPage(c) {
    var wrap = h("div", { class: "plans", id: "plans" }, [loadingCell()]);
    c.appendChild(h("div", { class: "sectionhead" }, [h("h4", {}, ["Planos"]), h("span", { class: "c" }, ["pagamento por PIX · cartao no site"])]));
    c.appendChild(wrap);
    c.appendChild(h("div", { class: "note", html: "<b>Cupom?</b> Aplique na hora de gerar o PIX. Pagamento com cartao de credito (parcelado) abre no site." }));
    call("listSignupPlans", undefined, undefined, { plans: [] }).then(function (r) {
      var plans = (r && r.plans) || [];
      if (!plans.length) return call("productsList", undefined, undefined, { products: [] }).then(function (p) { renderPlans((p && p.products) || [], true); });
      renderPlans(plans, false);
    });
    function renderPlans(plans, isProduct) {
      wrap.innerHTML = "";
      if (!plans.length) { wrap.appendChild(h("div", { class: "empty" }, ["Nenhum plano disponivel."])); return; }
      plans.forEach(function (p, i) {
        var feat = i === Math.min(1, plans.length - 1);
        wrap.appendChild(h("div", { class: "plan" + (feat ? " feat" : "") }, [
          h("h4", {}, [p.name || p.key]),
          h("div", { class: "price", html: money(p.price) + (isProduct ? "" : "<small> unico</small>") }),
          h("ul", {}, [
            p.game_limit != null ? h("li", {}, [p.game_limit === -1 || p.game_limit === 0 ? "Jogos ilimitados" : (p.game_limit + " jogos")]) : null,
            p.bypass ? h("li", {}, ["Bypass incluido"]) : null,
            p.multiplayer ? h("li", {}, ["Multiplayer"]) : null,
            p.premiumaccounts ? h("li", {}, ["Contas oficiais"]) : null,
            p.emuladores ? h("li", {}, ["RetroAnvil (emuladores)"]) : null
          ].filter(Boolean)),
          h("button", { class: "pick", onclick: function () { lojaBuy(p, isProduct); } }, ["Comprar com PIX"])
        ]));
      });
    }
  }
  function lojaBuy(p, isProduct) {
    var couponIn = h("input", { class: "field", placeholder: "Cupom (opcional)" });
    showModal("Comprar — " + (p.name || p.key), "", [
      { t: "Cancelar", act: hideModal },
      { t: "Cartao no site", act: function () { hideModal(); openUrl("https://titanforge.com.br"); } },
      { t: "Gerar PIX", pri: true, act: function () {
        var code = couponIn.value.trim();
        hideModal();
        call("pixCreateOrder", { licenseKey: S.licenseKey, productType: p.key || p.type || p.id, couponCode: code }, undefined, { success: false }).then(function (r) {
          if (r && r.free) { toast("Liberado com cupom 100%!"); return; }
          if (r && r.success && r.order) pixModal(r.order, "pixCheckStatus", function () { toast("Pagamento confirmado!"); });
          else toast((r && r.error) || "Falha ao gerar PIX");
        });
      } }
    ]);
    $(".modal .txt").appendChild(h("div", {}, [h("label", { class: "lb", style: "margin-top:0" }, ["Cupom"]), couponIn]));
  }

  /* ------------------------------------------------------ STEAM: indicacoes */
  function indicacoesPage(c) {
    var box = h("div", {}, [loadingCell()]);
    c.appendChild(box);
    Promise.all([
      call("referralGetInfo", S.licenseKey, undefined, { success: false }),
      call("redemptionInfo", S.licenseKey, undefined, { available: 0, history: [] })
    ]).then(function (res) {
      var inf = res[0] || {}, red = res[1] || {};
      box.innerHTML = "";
      if (!inf.success) { box.appendChild(h("div", { class: "empty" }, ["Programa de indicacao indisponivel para esta licenca."])); return; }
      box.appendChild(h("div", { class: "strip" }, [
        stat("Seu codigo", "<span class='mono' style='font-size:16px;color:var(--heat-2)'>" + esc(inf.friendCode || "-") + "</span>", 1),
        stat("Indicacoes", String(inf.referralCount || 0)),
        stat("Saldo", money(inf.referralBalance || 0), 0),
        stat("Resgatavel", money(red.available || 0), 0)
      ]));
      box.appendChild(h("div", { style: "display:flex;gap:8px;margin:4px 0 18px" }, [
        h("button", { class: "btn", onclick: function () { copy(inf.friendCode || ""); toast("Codigo copiado"); } }, ["Copiar codigo"]),
        h("button", { class: "btn", onclick: function () { openUrl("https://wa.me/?text=" + encodeURIComponent("Usa meu codigo no TitanForge: " + (inf.friendCode || ""))); } }, ["Compartilhar"])
      ]));
      // resgate
      var pixKey = h("input", { class: "field", placeholder: "Sua chave PIX" });
      var pixType = h("select", { class: "field" }, [["", "Tipo"], ["cpf", "CPF"], ["email", "E-mail"], ["phone", "Telefone"], ["random", "Aleatoria"]].map(function (o) { return h("option", { value: o[0] }, [o[1]]); }));
      box.appendChild(h("div", { class: "acard", style: "border:1px solid var(--line-soft);background:var(--panel-2);padding:16px" }, [
        h("h4", { style: "font-size:13px;margin-bottom:8px" }, ["Resgatar saldo por PIX"]),
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [pixKey, pixType,
          h("button", { class: "btn pri", onclick: function () {
            call("redemptionRequest", { licenseKey: S.licenseKey, pixKey: pixKey.value.trim(), pixKeyType: pixType.value || null }, undefined, { success: false }).then(function (r) {
              toast(r && r.success ? "Resgate solicitado (ID " + (r.redemptionId || "?") + ")" : (r && r.error) || "Falha no resgate");
              if (r && r.success) renderPage($("#content"));
            });
          } }, ["Solicitar"])
        ])
      ]));
      // historico
      call("referralList", inf.friendCode, undefined, { list: [] }).then(function (r) {
        var list = (r && r.list) || [];
        if (!list.length) return;
        box.appendChild(h("div", { class: "sectionhead", style: "margin-top:20px" }, [h("h4", {}, ["Historico"])]));
        box.appendChild(h("div", { class: "rows" }, list.map(function (x) {
          return h("div", { class: "lrow" }, [
            h("div", {}, [h("div", { class: "nm2 mono" }, [x.referred_license_key || "-"]), h("div", { class: "sub2" }, [fmtDate(x.created_at)])]),
            h("div", { class: "right" }, [h("span", { class: "pill " + (x.status === "confirmed" || x.status === "paid" ? "good" : "idle") }, [x.status]), h("span", { class: "sub2" }, [money(x.bonus_amount || 0)])])
          ]);
        })));
      });
    });
  }

  /* --------------------------------------------------------- STEAM: config */
  function configPage(c) {
    var box = h("div", { class: "adm" }, [loadingCell()]);
    c.appendChild(box);
    Promise.all([
      call("checkSteamSetup", undefined, undefined, {}),
      call("hidDllStatus", undefined, undefined, {}),
      call("denuvoOfflineStatus", undefined, undefined, {}),
      call("arenaRomsPathGet", undefined, undefined, {}),
      call("getPublicIp", undefined, undefined, {})
    ]).then(function (res) {
      var steam = res[0] || {}, hid = res[1] || {}, dnv = res[2] || {}, romsP = res[3] || {}, ip = res[4] || {};
      box.innerHTML = "";
      // Steam
      box.appendChild(card("Steam", [
        row("Steam detectada", steam.steamFound ? (steam.steamPath || "sim") : "nao encontrada", steam.steamFound ? "good" : "warn"),
        actionRow("Escolher pasta da Steam", "Selecionar", function (b) { b.disabled = true; call("selectSteamFolder").then(function () { b.disabled = false; renderPage($("#content")); }); })
      ]));
      // HID DLL
      box.appendChild(card("Controle / HID (xinput1_4.dll)", [
        toggleRow("DLL de controle ativa", !!hid.enabled, function (on, set) {
          call(on ? "enableHidDll" : "disableHidDll").then(function () { set(on); toast(on ? "DLL ativada" : "DLL desativada"); });
        })
      ]));
      // Denuvo offline
      box.appendChild(card("Modo offline (Denuvo)", [
        toggleRow("Automatico: Steam offline quando um jogo Denuvo abrir", !!dnv.auto, function (on, set) {
          call("denuvoOfflineSetAuto", on).then(function () { set(on); });
        }),
        actionRow("Forcar Steam offline agora", dnv.offline ? "Voltar online" : "Ficar offline", function (b) {
          b.disabled = true; call("steamSetOffline", !dnv.offline).then(function (r) { b.disabled = false; toast(r && r.ok ? "OK" : (r && r.error) || "Falha"); renderPage($("#content")); });
        })
      ]));
      // ROMs path
      box.appendChild(card("Pasta de ROMs (RetroAnvil)", [
        row("Pasta atual", romsP.path || "(padrao)", romsP.isDefault ? "idle" : "good"),
        actionRow("Trocar pasta", "Escolher", function (b) { b.disabled = true; call("arenaRomsPathSet").then(function () { b.disabled = false; renderPage($("#content")); }); })
      ]));
      // Updates + conta
      box.appendChild(card("Atualizacoes & conta", [
        row("Versao", S.version || "?", "idle"),
        row("HWID", (S.hwid || "").slice(0, 24) || "-", "idle"),
        row("IP publico", ip.ip || "?", "idle"),
        actionRow("Procurar atualizacoes", "Verificar", function (b) { b.disabled = true; call("checkForUpdatesManually").then(function (r) { b.disabled = false; toast(r && r.success ? "Verificado" : "Sem update"); }); }),
        actionRow("Pasta de atualizacoes", "Abrir", function () { call("openUpdatesFolder"); }),
        actionRow("Suporte", "Abrir WhatsApp", function () { openUrl("https://wa.me/5543988322483?text=" + encodeURIComponent("Suporte Gamaxy. Licenca: " + S.licenseKey)); }),
        actionRow("Sair da conta", "Sair", function () { confirmLogout(); })
      ]));
    });
    function card(title, rows) { return h("div", { class: "acard" }, [h("h4", { style: "font-size:13px;margin-bottom:10px" }, [title]), h("div", { class: "rows" }, rows)]); }
    function row(label, val, pill) {
      return h("div", { class: "lrow" }, [h("div", {}, [h("div", { class: "nm2" }, [label]), h("div", { class: "sub2" }, [String(val)])]),
        h("div", { class: "right" }, [pill ? h("span", { class: "pill " + pill }, [pill === "good" ? "ok" : pill === "warn" ? "!" : "–"]) : null])]);
    }
    function actionRow(label, btn, fn) {
      var b = h("button", { class: "mini", onclick: function () { fn(b); } }, [btn]);
      return h("div", { class: "lrow" }, [h("div", { class: "nm2" }, [label]), h("div", { class: "right" }, [b])]);
    }
    function toggleRow(label, on, fn) {
      var sw = h("div", { class: "toggleSw" + (on ? " on" : "") });
      sw.addEventListener("click", function () { fn(!sw.classList.contains("on"), function (v) { sw.classList.toggle("on", v); }); });
      return h("div", { class: "lrow" }, [h("div", { class: "nm2" }, [label]), h("div", { class: "right" }, [sw])]);
    }
  }

  /* ------------------------------------------------------- STEAM: cadastro */
  function cadastroPage(c) {
    var nome = h("input", { class: "field" }), email = h("input", { class: "field" }), tel = h("input", { class: "field" }), ref = h("input", { class: "field", placeholder: "opcional" });
    var planSel = h("select", { class: "field" }, [h("option", { value: "" }, ["Vitalicio (padrao)"])]);
    call("listSignupPlans", undefined, undefined, { plans: [] }).then(function (r) {
      ((r && r.plans) || []).forEach(function (p) { planSel.appendChild(h("option", { value: p.key }, [(p.name || p.key) + " — " + money(p.price)])); });
    });
    c.appendChild(h("div", { style: "max-width:420px" }, [
      h("div", { class: "note", html: "<b>Novo por aqui?</b> Crie a licenca por PIX. Assim que o pagamento confirmar, sua chave aparece aqui." }),
      h("label", { class: "lb" }, ["Nome"]), nome,
      h("label", { class: "lb" }, ["E-mail"]), email,
      h("label", { class: "lb" }, ["Telefone (WhatsApp)"]), tel,
      h("label", { class: "lb" }, ["Plano"]), planSel,
      h("label", { class: "lb" }, ["Codigo de indicacao"]), ref,
      h("button", { class: "btn pri", style: "margin-top:16px;width:100%", onclick: function () {
        var body = { nome: nome.value.trim(), email: email.value.trim(), numero: tel.value.trim(), planKey: planSel.value || null, referredBy: ref.value.trim() || null };
        if (!body.nome || !body.email || !body.numero) return toast("Preencha nome, e-mail e telefone");
        call("signupCreatePix", body, undefined, { success: false }).then(function (r) {
          if (r && r.success && r.order) pixModal(r.order, "signupCheckStatus", function (res) {
            if (res && res.licenseKey) { svc.save(res.licenseKey); showModal("Licenca criada!", "Sua chave: " + res.licenseKey + "\n\nJa deixei salva. Feche e faca login.", [{ t: "Ir para login", pri: true, act: function () { hideModal(); logout(); } }]); }
          });
          else toast((r && r.error) || "Falha ao gerar PIX");
        });
      } }, ["Gerar PIX do cadastro"])
    ]));
  }

  /* -------------------------------------------------------- RETRO: sistemas */
  function retroHome(c) {
    call("arenaCheckInstalled").then(function (r) {
      if (!(r && r.installed)) return retroInstallCore(c);
      retroConsoles(c);
    });
  }
  function retroInstallCore(c) {
    c.innerHTML = "";
    c.appendChild(h("div", { class: "note", style: "border-left-color:var(--steel)", html: "<b>Camada classica nao instalada.</b> Baixa o nucleo do RetroAnvil (emulador base + launcher). ROMs e emuladores extras vem sob demanda." }));
    var b = h("button", { class: "btn", style: "margin-top:12px;border-color:var(--steel);color:var(--steel)", onclick: function () {
      b.disabled = true; b.textContent = "Baixando nucleo...";
      var off = E.onArenaCoreDownloadProgress ? E.onArenaCoreDownloadProgress(function (p) { b.textContent = "Nucleo " + pctOf(p) + "%"; }) :
                (E.onArenaDownloadProgress ? E.onArenaDownloadProgress(function (p) { b.textContent = "Nucleo " + pctOf(p) + "%"; }) : null);
      var fn = E.arenaCoreDownload ? "arenaCoreDownload" : "arenaDownloadAndInstall";
      call(fn, undefined, undefined, { success: false }).then(function (r) {
        if (off) try { off(); } catch (e) {}
        if (r && r.success) { toast("Camada classica instalada"); renderPage($("#content")); }
        else { b.disabled = false; b.textContent = "Tentar de novo"; toast((r && r.error) || "Falha"); }
      });
    } }, ["Instalar camada classica"]);
    c.appendChild(b);
  }
  function retroConsoles(c) {
    c.innerHTML = "";
    var strip = h("div", { class: "strip" }, [
      stat("Servidor", "<span style='font-size:17px;color:var(--good)'>Online</span>", 1),
      stat("Sistemas", "<span id='cSys'>...</span>", 1),
      stat("Emuladores", "<span id='cEmu'>...</span>", 1),
      stat("ROMs no PC", "<span id='cInst'>...</span>", 1)
    ]);
    var band = h("div", { class: "consoles", id: "band" }, [h("span", { class: "empty" }, [h("span", { class: "spin" }), " sistemas..."])]);
    var head = h("div", { class: "sectionhead", style: "margin-top:18px" }, [h("h4", { id: "sysT" }, ["Sistema"]), h("span", { class: "c", id: "cCount" }, [""]), mkSearch("Buscar ROM...")]);
    var grid = h("div", { class: "grid", id: "grid" }, []);
    c.appendChild(strip); c.appendChild(band); c.appendChild(head); c.appendChild(grid); c.appendChild(retroNote());

    call("arenaListGames", undefined, undefined, { games: [] }).then(function (r) { var el = $("#cInst"); if (el) el.textContent = String(((r && r.games) || []).length); });
    call("arenaEmulatorsInstalled", undefined, undefined, {}).then(function (r) { var el = $("#cEmu"); if (el) el.textContent = String(((r && (r.installed || r.list)) || []).length || r.count || 0); });

    call("arenaRomsListConsoles", undefined, undefined, { consoles: [] }).then(function (r) {
      var cs = (r && (r.consoles || r.systems || r.list)) || [];
      S.consoles = cs;
      var el = $("#cSys"); if (el) el.textContent = String(cs.length);
      band.innerHTML = "";
      if (!cs.length) { band.appendChild(h("span", { class: "empty" }, ["Nenhum sistema no servidor."])); return; }
      if (!S.console || !cs.some(function (x) { return (x.id || x.console || x.name) === S.console; })) S.console = cs[0].id || cs[0].console || cs[0].name;
      cs.forEach(function (cc) {
        var id = cc.id || cc.console || cc.name;
        var b = h("div", { class: "cbtn cut cut-sm" + (id === S.console ? " sel" : ""), onclick: function () { S.console = id; S.search = ""; retroConsoles(c); } }, [
          h("div", { class: "ab" }, [String(cc.abbr || cc.short || id || "").toUpperCase().slice(0, 5)]),
          h("div", { class: "fl" }, [String(cc.label || cc.name || id)]),
          h("div", { class: "ct" }, [(cc.count != null ? cc.count : cc.games != null ? cc.games : "") + (cc.count != null || cc.games != null ? " jogos" : "")])
        ]);
        band.appendChild(b);
      });
      loadRoms(S.console, grid);
    });
  }
  function loadRoms(consoleId, grid) {
    var t = $("#sysT"); if (t) t.textContent = consoleId;
    grid.innerHTML = ""; grid.appendChild(loadingCell());
    Promise.all([
      call("arenaRomsListGames", consoleId, undefined, { games: [] }),
      call("arenaListGames", undefined, undefined, { games: [] })
    ]).then(function (res) {
      var cat = (res[0] && res[0].games) || [];
      var mine = (res[1] && res[1].games) || [];
      var instSet = new Set(mine.filter(function (g) { return (g.system || g.console) === consoleId; }).map(function (g) { return g.file; }));
      var q = S.search.trim().toLowerCase();
      var list = cat.filter(function (g) { return !q || String(g.title || g.name || g.file).toLowerCase().indexOf(q) >= 0; }).map(function (g) {
        var file = g.file || g.filename || g.name;
        return { name: g.title || g.name || file, id: consoleId + "|" + file, file: file, st: instSet.has(file) ? "ok" : "get", rom: { console: consoleId, file: file } };
      });
      fillGrid(grid, list, "retro");
    });
  }
  function retroInstalled(c) {
    var grid = h("div", { class: "grid", id: "grid" }, [loadingCell()]);
    c.appendChild(h("div", { class: "sectionhead" }, [h("h4", {}, ["ROMs no PC"]), h("span", { class: "c", id: "cCount" }, [""])]));
    c.appendChild(grid);
    call("arenaListGames", undefined, undefined, { games: [] }).then(function (r) {
      var list = ((r && r.games) || []).map(function (g) {
        var cons = g.system || g.console;
        return { name: g.title || g.rawName || g.file, id: cons + "|" + g.file, file: g.file, st: "ok", rom: { console: cons, file: g.file }, removable: true };
      });
      fillGrid(grid, list, "retro");
    });
  }
  function retroEmu(c) {
    var rows = h("div", { class: "rows" }, [h("div", { class: "lrow" }, [h("span", { class: "spin" }), " carregando..."])]);
    c.appendChild(h("div", { class: "sectionhead" }, [h("h4", {}, ["Emuladores"]), h("span", { class: "c" }, ["sob demanda do servidor"])]));
    c.appendChild(rows);
    Promise.all([
      call("arenaEmulatorsList", undefined, undefined, { list: [] }),
      call("arenaEmulatorsInstalled", undefined, undefined, { installed: [] })
    ]).then(function (res) {
      var all = (res[0] && (res[0].list || res[0].emulators)) || [];
      var inst = new Set(((res[1] && (res[1].installed || res[1].list)) || []).map(function (x) { return typeof x === "string" ? x : (x.name || x.id); }));
      rows.innerHTML = "";
      if (!all.length) { rows.appendChild(h("div", { class: "lrow" }, ["Nenhum emulador listado (o nucleo cobre a maioria)."])); return; }
      all.forEach(function (em) {
        var name = typeof em === "string" ? em : (em.name || em.id);
        var desc = em && (em.systems || em.desc) || "";
        var right = inst.has(name) ? h("span", { class: "pill good" }, ["no disco"]) : (function () {
          var b = h("button", { class: "mini", onclick: function () {
            b.disabled = true; b.textContent = "Baixando...";
            var off = E.onArenaEmulatorDownloadProgress ? E.onArenaEmulatorDownloadProgress(function (p) { b.textContent = pctOf(p) + "%"; }) : null;
            call("arenaEmulatorDownload", name, undefined, { success: false }).then(function (r) {
              if (off) try { off(); } catch (e) {}
              if (r && r.success) { toast(name + " baixado"); retroEmu(c); } else { b.disabled = false; b.textContent = "Tentar"; }
            });
          } }, ["Baixar"]);
          return h("span", {}, [h("span", { class: "pill idle" }, ["falta"]), " ", b]);
        })();
        rows.appendChild(h("div", { class: "lrow" }, [
          h("div", {}, [h("div", { class: "nm2" }, [String(name)]), h("div", { class: "sub2" }, [String(Array.isArray(desc) ? desc.join(", ") : desc)])]),
          h("div", { class: "right" }, [right])
        ]));
      });
    });
  }
  function retroRequest(c) {
    var game = h("input", { class: "field" }), cons = h("input", { class: "field", placeholder: "ex: ps2, snes..." }), notes = h("textarea", { class: "field", style: "min-height:80px" });
    c.appendChild(h("div", { style: "max-width:420px" }, [
      h("div", { class: "note", html: "<b>Nao achou um jogo?</b> Pede aqui que a gente adiciona no servidor." }),
      h("label", { class: "lb" }, ["Jogo"]), game,
      h("label", { class: "lb" }, ["Console"]), cons,
      h("label", { class: "lb" }, ["Observacoes"]), notes,
      h("button", { class: "btn pri", style: "margin-top:14px;width:100%", onclick: function () {
        if (!game.value.trim()) return toast("Informe o jogo");
        call("arenaRequestGame", { game: game.value.trim(), console: cons.value.trim(), notes: notes.value.trim() }, undefined, { success: false }).then(function (r) {
          toast(r && r.success ? "Pedido enviado!" : (r && r.error) || "Falha ao enviar");
          if (r && r.success) { game.value = ""; notes.value = ""; }
        });
      } }, ["Enviar pedido"])
    ]));
  }
  function retroPath(c) {
    var box = h("div", { style: "max-width:520px" }, [loadingCell()]);
    c.appendChild(box);
    call("arenaRomsPathGet", undefined, undefined, {}).then(function (r) {
      box.innerHTML = "";
      box.appendChild(h("div", { class: "rows" }, [
        h("div", { class: "lrow" }, [h("div", {}, [h("div", { class: "nm2" }, ["Pasta das ROMs"]), h("div", { class: "sub2" }, [(r && r.path) || "(padrao)"])]),
          h("div", { class: "right" }, [h("span", { class: "pill " + (r && r.isDefault ? "idle" : "good") }, [r && r.isDefault ? "padrao" : "custom"])])]),
        h("div", { class: "lrow" }, [h("div", { class: "nm2" }, ["Trocar"]), h("div", { class: "right" }, [
          h("button", { class: "mini", onclick: function () { call("arenaRomsPathSet").then(function () { renderPage($("#content")); }); } }, ["Escolher pasta"])
        ])])
      ]));
    });
  }

  /* ------------------------------------------------------- RETRO: controles */
  /* diagramas PS/Xbox adaptados de e7d/gamepad-viewer (MIT License) */
  var PAD_CSS = "[data-kind=\"xboxone\"] .padinner{width:750px;height:630px;background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI3NTAiIGhlaWdodD0iNjMwLjQ1NSIgdmlld0JveD0iMCAwIDc1MCA2MzAuNDU1Ij4KICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIGQ9Ik02NjQuMzY4IDIxMy45NmMtNi43Mi0xNi42ODItMjAuNTQyLTIwLjg3Ny0yMS44MTgtMjIuMDAzLTExLjcwMS0xMC4zMzYtMi40NzQtMjEuMjE0LTE5Ljk0Ni0zMC42OTUtMTguMjgtOS45MTQtNzEuOTc5LTM2Ljk5Ny0xMTQuMjItMzEuMzc1LTkuMjI1IDEuMjM1LTI3LjgzNyAxNy42MDgtNDEuMjE0IDE3LjYwOEgyODIuODRjLTEzLjM3NyAwLTMxLjk5LTE2LjM3NC00MS4yMTUtMTcuNjA4LTQyLjI0OC01LjYyMi05NS45MzkgMjEuNDYxLTExNC4yMiAzMS4zNzUtMTcuNDcyIDkuNDgxLTguMjQzIDIwLjM1OS0xOS45NDEgMzAuNjk1LTEuMjgxIDEuMTI1LTE1LjEwNCA1LjMyMS0yMS44MjMgMjIuMDAzQzIyLjg4OSAzNjkuOTgzLTEuNzQxIDQ2OS4xMTQuMDk1IDUyOS4xMjljMi44OTEgOTQuNDE2IDc2LjU3OCAxMDEuMzI2IDc2LjU3OCAxMDEuMzI2IDM3LjAzMy04LjYxNyAxMTEuNTUtMTI5LjEzNSAxNjguNTM1LTEyOS4xMzVoMjU5LjU5NGM1Ni45ODUgMCAxMzEuNTAyIDEyMC41MTggMTY4LjUzOCAxMjkuMTM1IDAgMCA3My42NzgtNi45MSA3Ni41NjMtMTAxLjMyNiAxLjg2NC02MC4wMTUtMjIuODEtMTU5LjE0Ni04NS41MzUtMzE1LjE2OXoiLz4KICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0xMDYuMjQ5IDE5Mi42NDJjLjU0MS0uMjg5Ljk0MS0uNDg3IDEuMTU1LS42NS0uMzkuMjIzLS43NzEuNDIzLTEuMTU1LjY1em01MzYuMzEtLjY3NmMuMjE1LjE3Ny43NTUuNDM1IDEuNTI3LjgxOS0uNDkxLS4yNzEtMS4wMTctLjU0Mi0xLjUyNy0uODE5eiIvPgogICAgPHBhdGggZmlsbD0iI0U2RTZFNiIgZD0iTTY2NC4zNjggMjEzLjk2Yy0zLjM0NC04LjMwNC04LjQ0NS0xMy41MTgtMTIuODkyLTE2Ljc5Ny0zLjAyMy0yLjIzNy01LjczNC0zLjU2My03LjM5Mi00LjM3OC0uNzcyLS4zODQtMS4zMTMtLjY0Mi0xLjUyNy0uODE5LTMzLjU2NC0xOC4wMDctOTcuNDU5LTM4LjE1My0xMTcuNDc5LTM0LjMwNS0yNi4wMSA1LjAyNC02NS41MzYgNzkuNzE0LTg4Ljk2OSA3OS43MTRIMzE1LjEyNGMtMjMuNDM1IDAtNjIuOTY2LTc0LjY5LTg4Ljk3My03OS43MTQtMTkuNTgzLTMuNzc5LTg1LjU4OSAxNi40NTYtMTE4Ljc0OSAzNC4zMzEtLjIxNC4xNjMtLjYxNC4zNjItMS4xNTUuNjUtMS43NjEuODQ5LTUuMDY3IDIuNDE4LTguNjk4IDUuMjY4LTQuMTk0IDMuMzA4LTguODEyIDguMzUyLTExLjkxMSAxNi4wNTFDMjIuODg5IDM2OS45ODMtMS43NDEgNDY5LjExNC4wOTUgNTI5LjEyOWMyLjg5MSA5NC40MTYgNzYuNTc4IDEwMS4zMjYgNzYuNTc4IDEwMS4zMjYgMzcuMDMzLTguNjE3IDExMS41NS0xMjkuMTM1IDE2OC41MzUtMTI5LjEzNWgyNTkuNTk0YzU2Ljk4NSAwIDEzMS41MDIgMTIwLjUxOCAxNjguNTM4IDEyOS4xMzUgMCAwIDczLjY3OC02LjkxIDc2LjU2My0xMDEuMzI2IDEuODY0LTYwLjAxNS0yMi44MS0xNTkuMTQ2LTg1LjUzNS0zMTUuMTY5eiIvPgogICAgPHBhdGggZmlsbD0ibm9uZSIgZD0iTTEwNy40NjQgMTkxLjk1N3YxLjU2Mm01MzUuMDg2LTIuMDQ3di45NSIvPgogICAgPHBhdGggZmlsbD0iI0VCRUJFQiIgZD0iTTI3Ny42NzEgNDYyLjExNGMtMzMuNDM3IDAtNjAuNjQtMjcuMTk3LTYwLjY0LTYwLjYyNyAwLTMzLjQyOCAyNy4yMDMtNjAuNjIzIDYwLjY0LTYwLjYyMyAzMy40MjggMCA2MC42MjQgMjcuMTk1IDYwLjYyNCA2MC42MjMgMCAzMy40My0yNy4xOTYgNjAuNjI3LTYwLjYyNCA2MC42Mjd6Ii8+CiAgICA8cGF0aCBmaWxsPSIjREVERURFIiBkPSJNMjc3LjY3MSAzNDEuODY1YzMyLjg3NiAwIDU5LjYyNCAyNi43NDcgNTkuNjI0IDU5LjYyMyAwIDMyLjg3OC0yNi43NDcgNTkuNjI3LTU5LjYyNCA1OS42MjctMzIuODg1IDAtNTkuNjQtMjYuNzQ5LTU5LjY0LTU5LjYyNy4wMDEtMzIuODc4IDI2Ljc1NS01OS42MjMgNTkuNjQtNTkuNjIzbTAtMmMtMzQuMDM2IDAtNjEuNjQgMjcuNTc3LTYxLjY0IDYxLjYyMyAwIDM0LjA1IDI3LjYwNCA2MS42MjcgNjEuNjQgNjEuNjI3IDM0LjAzNyAwIDYxLjYyNC0yNy41NzcgNjEuNjI0LTYxLjYyNyAwLTM0LjA0Ni0yNy41ODctNjEuNjIzLTYxLjYyNC02MS42MjN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMTQxNDE0IiBkPSJNMjc3LjY3MSA0NTIuNjk4Yy03LjEzMiAwLTEyLjc0Mi0xLjMyMy0xMy4wNDktMy4wNzhhLjkyNi45MjYgMCAwIDEtLjAxNC0uMTQ4di0zNC40MjRhLjUuNSAwIDAgMC0uNS0uNWgtMzQuNDJjLTEuODIgMC0zLjI0Ni01LjczNS0zLjI0Ni0xMy4wNTdzMS40MjYtMTMuMDU3IDMuMjQ2LTEzLjA1N2gzNC40MmEuNS41IDAgMCAwIC41LS41di0zNC40MjdjMC0uMDQzLjAwNy0uMDkzLjAxNC0uMTQybC4wNi0uMjI3Yy4wMjktLjA0MS4wNjYtLjEwNy4wODItLjEzNC40OTUtLjgxIDIuMTA1LTEuNTE3IDQuNTM1LTEuOTkxYTI4LjIgMjguMiAwIDAgMSAuODg5LS4xODNjLjMxNy0uMDYyLjYzNy0uMTA2Ljk1OC0uMTM2LjA1NS0uMDA0LjEwOC0uMDE0LjE2Mi0uMDI1LjI1NS0uMDI5LjU3OS0uMDcyLjkwNy0uMTExLjY3OS0uMDggMS4zNTktLjE0NSAyLjA0MS0uMTkxbDIuMzY5LS4wNzdjLjM1My0uMDA4LjcwMS0uMDEzIDEuMDQ3LS4wMTMgNy4zMjUgMCAxMy4wNjMgMS40MTggMTMuMDYzIDMuMjI5bC4wMDEgMzQuNDI3YS41LjUgMCAwIDAgLjUuNWgzNC40MTljMS44MDkgMCAzLjIyNiA1LjczNCAzLjIyNiAxMy4wNTdzLTEuNDE3IDEzLjA1Ny0zLjIyNiAxMy4wNTdoLTM0LjQxOWEuNS41IDAgMCAwLS41LjV2MzQuNDI0YS45NDMuOTQzIDAgMCAxLS4wMTUuMTUyYy0uMzA2IDEuNzUyLTUuOTE3IDMuMDc1LTEzLjA1IDMuMDc1eiIvPgogICAgPHBhdGggZmlsbD0iIzEyMEIwQiIgZD0iTTI3Ny42NzEgMzUwLjc4MWM4LjA4OSAwIDEyLjU2MyAxLjYxMiAxMi41NjMgMi43MjlsLjAwMS4wNDR2MzQuMzgzYTEgMSAwIDAgMCAxIDFoMzQuNDE5YzEuMTM4IDAgMi43MjYgNC43NzYgMi43MjYgMTIuNTU2IDAgNy43OC0xLjU4OCAxMi41NTctMi43MjYgMTIuNTU3aC0zNC40MTlhMSAxIDAgMCAwLTEgMXYzNC40MjNjMCAuMDIxLS4wMDQuMDQ2LS4wMDYuMDYzLS4xOTUgMS4xMTctNC42NjggMi42NjQtMTIuNTU4IDIuNjY0LTcuODg5IDAtMTIuMzYxLTEuNTQ3LTEyLjU1Ni0yLjY1Ni0uMDA0LS4wMjctLjAwOC0uMDU0LS4wMDgtLjA3VjQxNS4wNWExIDEgMCAwIDAtMS0xaC0zNC40MmMtMS4xNDYgMC0yLjc0Ni00Ljc3NS0yLjc0Ni0xMi41NTZzMS42LTEyLjU1OSAyLjc0Ny0xMi41NTloMzQuNDE5YTEgMSAwIDAgMCAxLTF2LTM0LjQyMmMwLS4wMjEuMDA0LS4wNDMuMDA0LS4wNDNsLjAwMi0uMDExLjAwMS0uMDAzYy4wMTMtLjAzNS4wMjktLjA5NC4wNC0uMTM1bC4wMzYtLjA1NWMuMTUzLS4yNS45MDYtMS4xMTMgNC4xODYtMS43NTkuMjk2LS4wNjcuNTk0LS4xMjguODkzLS4xODNsLjA4Mi0uMDE0Yy4yNjMtLjA1MS41MjgtLjA5Ljc5NS0uMTE1YTEuMDggMS4wOCAwIDAgMCAuMTg4LS4wMmMuMzA5LS4wNDIuNjEyLS4wODIuOTE5LS4xMTlsLjAyNC0uMDAyYTM3Ljc3NSAzNy43NzUgMCAwIDEgMi4wMDctLjE4OGwuMTE3LS4wMDdjLjE5LS4wMDguMzgyLS4wMTIuNTc1LS4wMTdsLjM5NS0uMDFjLjM4Mi0uMDE3Ljc2NS0uMDI5IDEuMTQ4LS4wNGwuMTI0LS4wMDFjLjM0MS0uMDA2LjY4NS0uMDExIDEuMDI4LS4wMW0wLTEuMDAxYy0uMzkyIDAtLjc4NS4wMDUtMS4xNzcuMDE1LS4zODcuMDExLS43NzMuMDI0LTEuMTYuMDQxLS4zMjcuMDExLS42NTQuMDE1LS45NzcuMDI4bC0uMTM4LjAwN2EzNC45IDM0LjkgMCAwIDAtLjk5Ni4wODFjLS4wMTQuMDAxLS4wMjcuMDAzLS4wNDEuMDAzLS4zNDguMDMyLS42OTEuMDY5LTEuMDI3LjExaC0uMDAyYy0uMzUuMDQyLS42OTkuMDg3LTEuMDQ4LjEzNWE5IDkgMCAwIDAtLjkzOC4xM2wtLjA3NC4wMTJjLS4zMDEuMDU4LS41OTYuMTE2LS44OC4xODFsLS4wMTMuMDAyYy0yLjQyNy40NzYtNC4yNSAxLjIxNS00Ljg2NSAyLjIyM2EuNTk3LjU5NyAwIDAgMC0uMTA2LjE2NWwtLjAwOS4wMTdjLS4wMTcuMDYxLS4wMy4xMjEtLjA0NS4xODRsLS4wMTcuMDQxYTEuNDIyIDEuNDIyIDAgMCAwLS4wNTMuMzU4djM0LjQyNmgtMzQuNDJjLTQuOTk1IDAtNC45OTUgMjcuMTEzIDAgMjcuMTEzaDM0LjQydjM0LjQyNGMwIC4wNy4wMDcuMTUyLjAyMS4yMzQuNDA4IDIuMzI5IDYuOTc1IDMuNDkxIDEzLjU0MiAzLjQ5MSA2LjU2OCAwIDEzLjEzNS0xLjE2MiAxMy41NDItMy40OTEuMDE0LS4wODIuMDIxLS4xNjUuMDIxLS4yMzRWNDE1LjA1aDM0LjQxOWM0Ljk2NyAwIDQuOTY3LTI3LjExMyAwLTI3LjExM2gtMzQuNDE5di0zNC40MjRoLS4wMDF2LS4wMDJjLjAwNC0yLjUwMy02Ljc5Mi0zLjczMS0xMy41NTktMy43MzF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMjQyNDI0IiBkPSJNMjY0LjEwOCAzODcuOTM3bC0zLjYwMi0zLjYyNWgtMzAuODE3Yy0uODYzIDAtMS44MjIuMjI2LTIuNzg0Ljg0NmwyLjc4NCAyLjc3N2MtLjAwMS4wMDIgMTUuNDU0LjAwMiAzNC40MTkuMDAyeiIvPgogICAgPHBhdGggZmlsbD0iIzI5MjkyOSIgZD0iTTIyOS42ODggMzg3LjkzN2wtMi43ODMtMi43NzhjLTEuMzY3LjkzLTIuNjc5IDIuNzM5LTMuNTI1IDYuMTQzLS42NjQgMi43NDYtMS4wMzIgNi4zNTgtMS4wMzIgMTAuMTg4IDAgMy44MzUuMzY4IDcuNDQ2IDEuMDMyIDEwLjE5Mi44NDUgMy40MDIgMi4xNTggNS4yMTIgMy41MjUgNi4xNDRsMi43ODMtMi43NzRjLTQuOTk2LS4wMDMtNC45OTYtMjcuMTE1IDAtMjcuMTE1eiIvPgogICAgPHBhdGggZmlsbD0iIzI0MjQyNCIgZD0iTTI2OS4yMDIgMzUwLjUyNGwuMDEzLS4wMDJjLjI4NC0uMDY0LjU3OS0uMTI1Ljg4LS4xODJsLjA3NC0uMDEyYy4zMy0uMDYzLjY2My0uMTA5Ljk5Ny0uMTM3LjMzMy0uMDQ1LjY1OC0uMDg4Ljk4OS0uMTI5aC4wMDJjLjMzNi0uMDQxLjY3OS0uMDc2IDEuMDI3LS4xMDkuMDE0IDAgLjAyNy0uMDAyLjA0MS0uMDAzLjM3Ny0uMDM0Ljc1NS0uMDYzIDEuMTM0LS4wODkuMzIzLS4wMTQuNjQ5LS4wMTguOTc3LS4wMjcuMzg3LS4wMTguNzczLS4wMzEgMS4xNi0uMDQxbC4xMjUtLjAwMmMuMzUtLjAwOC43MDItLjAxMiAxLjA1Mi0uMDEyIDYuNzY4IDAgMTMuNTYzIDEuMjI3IDEzLjU2MyAzLjcyOWwyLjc1NS0yLjc3MWMtLjkwMS0xLjM2Ny0yLjcxMy0yLjcwOS02LjE0NC0zLjUyNC0yLjc0My0uNjczLTYuMzU3LTEuMDM2LTEwLjE3NS0xLjAzNi0zLjg0NiAwLTcuNDU5LjM2Mi0xMC4xOCAxLjAzNi0yLjkzOS43MTgtNC43MTUgMS43OTYtNS43MjUgMi45NjNsMi41NyAyLjU3Yy42MTYtMS4wMDcgMi40MzgtMS43NDcgNC44NjUtMi4yMjJ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMTkxOTE5IiBkPSJNMzI1LjY1NSAzODcuOTM3bDIuNzU1LTIuNzc4YTQuOTggNC45OCAwIDAgMC0yLjc1NS0uODQ3aC0zMC44MTlsLTMuNjAxIDMuNjI1aDM0LjQyeiIvPgogICAgPHBhdGggZmlsbD0iIzFDMUMxQyIgZD0iTTI5MS4yMzQgMzUzLjUxbC4wMDEgMzQuNDI1IDMuNjAxLTMuNjI1di0zMC44YTQuOTggNC45OCAwIDAgMC0uODQ2LTIuNzcybC0yLjc1NiAyLjc3MnoiLz4KICAgIDxwYXRoIGZpbGw9IiMyOTI5MjkiIGQ9Ik0yNjQuMTA4IDM1My41MDljLjAwMi0uMTIxLjAyLS4yNDEuMDUzLS4zNTdsLjAxNy0uMDQxYy4wMTUtLjA2My4wMjgtLjEyMy4wNDUtLjE4NGwuMDA5LS4wMTdhLjU5Ny41OTcgMCAwIDEgLjEwNi0uMTY1bC0yLjU3LTIuNTdjLS45NjkgMS4xMjEtMS4yNjEgMi4yOTMtMS4yNjEgMy4zMzN2MzAuODAybDMuNjAyIDMuNjI1LS4wMDEtMzQuNDI2eiIvPgogICAgPHBhdGggZmlsbD0iIzE3MTcxNyIgZD0iTTMyNS42NTQgNDE1LjA0OWgtMzQuNDE5bDMuNiAzLjYyaDMyLjMxNWwuMzQtLjM0NWMuMzA4LS4xMjguNjE3LS4zMDMuOTI1LS40OThsLTIuNzYxLTIuNzc3eiIvPgogICAgPHBhdGggZmlsbD0iIzBGMEYwRiIgZD0iTTI5MS4yMzUgNDQ5LjQ3M2wyLjc1NCAyLjc3MWMuNjI0LS45NDUuODQ2LTEuOTIuODQ2LTIuNzcxdi0zMC44MDRsLTMuNi0zLjYydjM0LjQyNHptNDAuNzI4LTU4LjE3M2MtLjg0NS0zLjQwMi0yLjE4MS01LjIxMy0zLjU1My02LjE0M2wtMi43NTUgMi43NzdjNC45NjcgMCA0Ljk2NyAyNy4xMTMgMCAyNy4xMTNsMi43NiAyLjc3N2MxLjM2OS0uOTMxIDIuNzA1LTIuNzQ3IDMuNTQ4LTYuMTQ3LjY2NC0yLjc0NiAxLjAzMi02LjM1NiAxLjAzMi0xMC4xOTEgMC0zLjgyOS0uMzY4LTcuNDQxLTEuMDMyLTEwLjE4NnoiLz4KICAgIDxwYXRoIGZpbGw9IiMxNzE3MTciIGQ9Ik0yOTEuMjE0IDQ0OS43MDdjLS40MDcgMi4zMjktNi45NzUgMy40OTEtMTMuNTQyIDMuNDkxcy0xMy4xMzQtMS4xNjItMTMuNTQyLTMuNDkxYTEuNDA0IDEuNDA0IDAgMCAxLS4wMjEtLjIzNGwtMi43ODUgMi43NzFjLjkyOSAxLjM2NyAyLjc0MyAyLjcwMiA2LjE2OCAzLjUyMSAyLjcyMS42NzIgNi4zMzMgMS4wNDEgMTAuMTggMS4wNDEgMy44MTggMCA3LjQzMi0uMzY5IDEwLjE3NS0xLjA0MSAzLjQzLS44MTkgNS4yNDMtMi4xNTYgNi4xNDMtMy41MjNsLTIuNzU0LTIuNzcxYy0uMDAyLjA4LS4wMDkuMTU4LS4wMjIuMjM2eiIvPgogICAgPHBhdGggZmlsbD0iIzFDMUMxQyIgZD0iTTI2NC4xMDggNDQ5LjQ3M3YtMzQuNDI0bC0zLjYwMiAzLjYydjMxLjY1bC4wOTMuMjM1Yy4xMjguNTQ1LjM0NSAxLjExOS43MjQgMS42ODlsMi43ODUtMi43N3oiLz4KICAgIDxwYXRoIGZpbGw9IiMxQTFBMUEiIGQ9Ik0yMjkuNjg4IDQxNS4wNDlsLTIuNzgzIDIuNzc0Yy45NjEuNjIgMS45Mi44NDYgMi43ODMuODQ2aDMwLjgxOGwzLjYwMi0zLjYyaC0zNC40MnoiLz4KICAgIDxwYXRoIGZpbGw9IiMxQTE2MTUiIGQ9Ik00NDguOTE1IDI4MC4zNjZjMCAxMC4zOTctOC40MiAxOC44MTctMTguNzg5IDE4LjgxNy0xMC4zOTggMC0xOC44MTktOC40Mi0xOC44MTktMTguODE3IDAtMTAuMzcxIDguNDIxLTE4LjgwNSAxOC44MTktMTguODA1IDEwLjM2OS4wMDEgMTguNzg5IDguNDM0IDE4Ljc4OSAxOC44MDV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEEwQTBBIiBzdHJva2U9IiMwMDAiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgZD0iTTQ0Ni4yMjggMjgwLjM2NmMwIDguOTAyLTcuMjI5IDE2LjEwMy0xNi4xMDIgMTYuMTAzLTguOTAyIDAtMTYuMTAzLTcuMjAxLTE2LjEwMy0xNi4xMDMgMC04Ljg5NiA3LjItMTYuMTAzIDE2LjEwMy0xNi4xMDMgOC44NzMuMDAxIDE2LjEwMiA3LjIwOCAxNi4xMDIgMTYuMTAzeiIvPgogICAgPHBhdGggZmlsbD0iIzZENkI2QyIgZD0iTTQyMi45MzEgMjc1Ljc0MWgxNC4zNjF2MS41NTJoLTE0LjM2MXYtMS41NTJ6bTAgMy45MTloMTQuMzYxdjEuNTUyaC0xNC4zNjF2LTEuNTUyem0wIDMuODA5aDE0LjM2MXYxLjUzM2gtMTQuMzYxdi0xLjUzM3oiLz4KICAgIDxwYXRoIGZpbGw9IiMxQTE2MTUiIGQ9Ik0zNDAuOTM4IDI4MC4zNjZjMCAxMC4zOTctOC40MjIgMTguODE3LTE4LjgxOSAxOC44MTctMTAuMzY4IDAtMTguNzg5LTguNDItMTguNzg5LTE4LjgxNyAwLTEwLjM3MSA4LjQyLTE4LjgwNSAxOC43ODktMTguODA1IDEwLjM5Ny4wMDEgMTguODE5IDguNDM0IDE4LjgxOSAxOC44MDV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEEwQTBBIiBzdHJva2U9IiMwMDAiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgZD0iTTMzOC4yMjEgMjgwLjM2NmMwIDguOTAyLTcuMjAxIDE2LjEwMy0xNi4xMDMgMTYuMTAzLTguODcyIDAtMTYuMTA0LTcuMjAxLTE2LjEwNC0xNi4xMDMgMC04Ljg5NiA3LjIzMS0xNi4xMDMgMTYuMTA0LTE2LjEwMyA4LjkwMi4wMDEgMTYuMTAzIDcuMjA4IDE2LjEwMyAxNi4xMDN6Ii8+CiAgICA8ZyBmaWxsPSIjNkQ2QjZDIj4KICAgICAgICA8cGF0aCBkPSJNMzE5LjYwMiAyODAuMjY2aC0zLjAzdi0zLjc4NWg1LjQ3MnYxLjMyMWgxLjh2LTMuMDU5aC04Ljg5MXY3LjM4OWg0LjY0OXYtMS44NjZ6Ii8+CiAgICAgICAgPHBhdGggZD0iTTMyMC4zNTMgMjc4LjQyN3Y3LjU4NGg4Ljk2di03LjU4NGgtOC45NnptNy4xNiA1Ljc4M2gtNS40N3YtMy45NDVoNS40N3YzLjk0NXoiLz4KICAgIDwvZz4KICAgIDxnIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIj4KICAgICAgICA8cGF0aCBmaWxsPSIjRTZFNkU2IiBzdHJva2U9IiNERURFREUiIGQ9Ik0xODUuNDY4IDM1MS40OWMtMzcuMzI4IDAtNjcuNjk1LTMwLjM2NS02Ny42OTUtNjcuNjg4IDAtMzcuMzIzIDMwLjM2Ni02Ny42ODYgNjcuNjk1LTY3LjY4NiAzNy4zMzYgMCA2Ny43MDcgMzAuMzYzIDY3LjcwNyA2Ny42ODYgMCAzNy4zMjMtMzAuMzcgNjcuNjg4LTY3LjcwNyA2Ny42ODh6Ii8+CiAgICAgICAgPHBhdGggc3Ryb2tlPSIjMTIwQjBCIiBkPSJNMjQxLjU3MSAyNzkuODY1YzAgMzAuOTc3LTI1LjEwNiA1Ni4wODQtNTYuMTAzIDU2LjA4NC0zMC45ODEgMC01Ni4wOTItMjUuMTA3LTU2LjA5Mi01Ni4wODQgMC0zMSAyNS4xMTEtNTYuMTA2IDU2LjA5Mi01Ni4xMDYgMzAuOTk3IDAgNTYuMTAzIDI1LjEwNiA1Ni4xMDMgNTYuMTA2eiIvPgogICAgPC9nPgogICAgPGcgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiPgogICAgICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIHN0cm9rZT0iI0RFREVERSIgZD0iTTQ3My4wNDIgNDY1LjQ2MWMtMzcuMzI0IDAtNjcuNjg4LTMwLjM2NC02Ny42ODgtNjcuNjg2IDAtMzcuMzI2IDMwLjM2My02Ny43MDYgNjcuNjg4LTY3LjcwNiAzNy4zMjIgMCA2Ny43MDcgMzAuMzc5IDY3LjcwNyA2Ny43MDYgMCAzNy4zMjMtMzAuMzg1IDY3LjY4Ni02Ny43MDcgNjcuNjg2eiIvPgogICAgICAgIDxwYXRoIHN0cm9rZT0iIzEyMEIwQiIgZD0iTTUyOS4xNTEgMzkzLjgxNWMwIDMwLjk5OS0yNS4xMDYgNTYuMTA0LTU2LjEwOSA1Ni4xMDQtMzAuOTc1IDAtNTYuMDgzLTI1LjEwNS01Ni4wODMtNTYuMTA0IDAtMzAuOTc5IDI1LjEwOC01Ni4wODYgNTYuMDgzLTU2LjA4NiAzMS4wMDMgMCA1Ni4xMDkgMjUuMTA3IDU2LjEwOSA1Ni4wODZ6Ii8+CiAgICA8L2c+CiAgICA8cGF0aCBmaWxsPSIjMEEwQTBBIiBkPSJNNTY2LjQ5MSAzNTQuNTExYy0xMy43ODYgMC0yNS4wMDItMTEuMjIxLTI1LjAwMi0yNS4wMTMgMC0xMy43OTEgMTEuMjE2LTI1LjAwOSAyNS4wMDItMjUuMDA5IDEzLjc5NiAwIDI1LjAyIDExLjIxOCAyNS4wMiAyNS4wMDlzLTExLjIyNCAyNS4wMTMtMjUuMDIgMjUuMDEzeiIvPgogICAgPHBhdGggZmlsbD0iIzFBMTYxNSIgZD0iTTU2Ni40OTEgMzA1Ljk3OGMxMy4wMDQgMCAyMy41MzEgMTAuNTI2IDIzLjUzMSAyMy41MiAwIDEyLjk5Ni0xMC41MjcgMjMuNTI0LTIzLjUzMSAyMy41MjQtMTIuOTg1IDAtMjMuNTE0LTEwLjUyNy0yMy41MTQtMjMuNTI0IDAtMTIuOTk0IDEwLjUyOS0yMy41MiAyMy41MTQtMjMuNTJtMC0yLjk3OEM1NTEuODg0IDMwMyA1NDAgMzE0Ljg4NyA1NDAgMzI5LjQ5OCA1NDAgMzQ0LjExIDU1MS44ODUgMzU2IDU2Ni40OTEgMzU2IDU4MS4xMDggMzU2IDU5MyAzNDQuMTEgNTkzIDMyOS40OTggNTkzIDMxNC44ODcgNTgxLjEwOCAzMDMgNTY2LjQ5MSAzMDN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEEwQTBBIiBkPSJNNTY2LjQ5MSAyNTMuNTFjLTEzLjc4NiAwLTI1LjAwMi0xMS4yMjQtMjUuMDAyLTI1LjAyMSAwLTEzLjc4NiAxMS4yMTYtMjUuMDAxIDI1LjAwMi0yNS4wMDEgMTMuNzk2IDAgMjUuMDIgMTEuMjE2IDI1LjAyIDI1LjAwMSAwIDEzLjc5OC0xMS4yMjQgMjUuMDIxLTI1LjAyIDI1LjAyMXoiLz4KICAgIDxwYXRoIGZpbGw9IiMxQTE2MTUiIGQ9Ik01NjYuNDkxIDIwNC45NzhjMTMuMDA0IDAgMjMuNTMxIDEwLjUyNyAyMy41MzEgMjMuNTEyIDAgMTMuMDA0LTEwLjUyNyAyMy41MzItMjMuNTMxIDIzLjUzMi0xMi45ODUgMC0yMy41MTQtMTAuNTI4LTIzLjUxNC0yMy41MzIgMC0xMi45ODUgMTAuNTI5LTIzLjUxMiAyMy41MTQtMjMuNTEybTAtMi45NzhDNTUxLjg4NCAyMDIgNTQwIDIxMy44ODQgNTQwIDIyOC40OWMwIDE0LjYxNyAxMS44ODUgMjYuNTEgMjYuNDkxIDI2LjUxQzU4MS4xMDggMjU1IDU5MyAyNDMuMTA3IDU5MyAyMjguNDljMC0xNC42MDctMTEuODkyLTI2LjQ5LTI2LjUwOS0yNi40OXoiLz4KICAgIDxwYXRoIGZpbGw9IiMwQTBBMEEiIGQ9Ik01MTYuNDg2IDMwNC41MTFjLTEzLjc4NCAwLTI0Ljk5Ny0xMS4yMjQtMjQuOTk3LTI1LjAxOSAwLTEzLjc4OCAxMS4yMTMtMjUuMDA0IDI0Ljk5Ny0yNS4wMDQgMTMuNzk5IDAgMjUuMDI0IDExLjIxNyAyNS4wMjQgMjUuMDA0LjAwMSAxMy43OTYtMTEuMjI1IDI1LjAxOS0yNS4wMjQgMjUuMDE5eiIvPgogICAgPHBhdGggZmlsbD0iIzFBMTYxNSIgZD0iTTUxNi40ODYgMjU1Ljk3OGMxMy4wMDkgMCAyMy41MzYgMTAuNTI3IDIzLjUzNiAyMy41MTUgMCAxMy4wMDItMTAuNTI2IDIzLjUyOS0yMy41MzYgMjMuNTI5LTEyLjk4IDAtMjMuNTA5LTEwLjUyNy0yMy41MDktMjMuNTI5LjAwMS0xMi45ODggMTAuNTI5LTIzLjUxNSAyMy41MDktMjMuNTE1bTAtMi45NzhDNTAxLjg4MiAyNTMgNDkwIDI2NC44ODUgNDkwIDI3OS40OTMgNDkwIDI5NC4xMDkgNTAxLjg4MiAzMDYgNTE2LjQ4NiAzMDZjMTQuNjIgMCAyNi41MTQtMTEuODkxIDI2LjUxNC0yNi41MDdDNTQzIDI2NC44ODUgNTMxLjEwNSAyNTMgNTE2LjQ4NiAyNTN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMzc1LjYxNSAxNTYuNDk5cy04OC45MTctMS4wNjctMTAwLjU0OC0yLjk3M2wtMTYuMzg0IDMwLjUzOGMyMC4yMzggMjMuMjcxIDQxLjU4MyA1My4zMTIgNTYuNDQxIDUzLjMxMkg0MzYuMTFjMTQuODcyIDAgMzYuMTk2LTMwLjA0MSA1Ni40NjMtNTMuMzEybC0xNi4zODMtMzAuNTM4Yy0xMS42MyAxLjkwNS0xMDAuNTc1IDIuOTczLTEwMC41NzUgMi45NzN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEQwRDBEIiBkPSJNNDc2LjE5MSAxNTMuNTI2bC0zLjYzOS02Ljc3OGMtMS44NTUuNDgtMy42NTIuNzQ4LTUuMzg0Ljc0OGgtMTg0LjMzYy0xLjM5MiAwLTIuODE4LS4xODktNC4yODItLjUwMWwtMy40OSA2LjUzMWMxMS42MzEgMS45MDUgMTAwLjU0OCAyLjk3MyAxMDAuNTQ4IDIuOTczczg4Ljk0Ni0xLjA2OCAxMDAuNTc3LTIuOTczeiIvPgogICAgPHBhdGggZmlsbD0iIzFBMUExQSIgZD0iTTY0Mi41NSAxOTEuOTU3Yy04Ljk3OS03LjkzOC01LjYzNi0xNi4xNi0xMS40NjktMjMuODQ0LjI0LjMyNi40ODYuNjUyLjY5OC45NzktLjAyOC0uMDEzLTk2LjUyNy00Mi4wNTktMTIwLjgwMS0zNC40NzgtMTUuNTY4IDQuODY5LTI3LjI0MSAxNS4zMzEtMzIuODMgMTguMjI0bDE1Ljg3NiAyOS41ODNjMTEuMTY5LTEyLjY3OCAyMS45NDEtMjMuMDA1IDMxLjA1Ny0yNC43NjEgMjAuMDItMy44NDggODMuOTE0IDE2LjI5OCAxMTcuNDc5IDM0LjMwNS0uMDAzLS4wMDEtLjAwNy0uMDA1LS4wMS0uMDA4eiIvPgogICAgPHBhdGggZmlsbD0iIzBEMEQwRCIgZD0iTTUxMC45NzkgMTM0LjYxNWMyNC4yNzMtNy41ODIgMTIwLjc3MiAzNC40NjUgMTIwLjgwMSAzNC40NzgtLjIxMi0uMzI4LS40NTgtLjY1NC0uNjk4LS45NzktLjAyOS0uMDM5LS4wNjMtLjA3OC0uMDkxLS4xMTdhNy44NDkgNy44NDkgMCAwIDAtLjQyOC0uNTM2Yy0uMDg1LS4wOTMtLjE3LS4yMTItLjI3My0uMzMyLS4wNTUtLjA1MS0uMTA4LS4wOTctLjE1NS0uMTU5YTEuNzEgMS43MSAwIDAgMC0uMjgyLS4zMDFjLS4wNjMtLjA2Ny0uMTEyLS4xMzYtLjE2Ni0uMjA0LS4xLS4xMDQtLjItLjE4LS4yODktLjI4NmExLjM4NiAxLjM4NiAwIDAgMC0uMTk5LS4xOTljLS4xMDQtLjA4My0uMTktLjE4NS0uMjg2LS4yODctLjA3Ny0uMDY5LS4xNTUtLjExNy0uMjMtLjE4OGExLjYxMyAxLjYxMyAwIDAgMC0uMzA0LS4yNzljLS4wNzYtLjA2My0uMTQyLS4xMzctLjIyMy0uMjEtLjExMy0uMDk3LS4yMTgtLjE2OC0uMzE2LS4yNjNhMTUuNDIgMTUuNDIgMCAwIDAtLjYtLjQ4MiAxLjQ0OCAxLjQ0OCAwIDAgMC0uMjY1LS4xOTVjLS4xMjQtLjA5Ni0uMjI3LS4xOS0uMzU0LS4yOC0uMDk3LS4wNS0uMTc3LS4xMjUtLjI3Mi0uMTk5YTcuMDY4IDcuMDY4IDAgMCAwLS4zODEtLjI1OCAzLjYwOCAzLjYwOCAwIDAgMS0uMjg5LS4yMmMtLjE0My0uMDgyLS4yOS0uMTY1LS40MS0uMjYyLS4xMDYtLjA3MS0uMjExLS4xNDItLjI5OC0uMTkyYTUuNTAyIDUuNTAyIDAgMCAxLS40NS0uMjkzYy0uMTA4LS4wNTUtLjIwOS0uMTA0LS4yOTUtLjE3MS0uMTgzLS4xMTEtLjM1Mi0uMjItLjUzMi0uMzAzLS4wOTUtLjA1Ni0uMTY3LS4xMTItLjI1Ni0uMTY3LS4yNzctLjE1MS0uNTU4LS4zMDItLjgzMy0uNDY3LTE4LjI4MS05LjkxNC03MS45NzktMzYuOTk3LTExNC4yMjEtMzEuMzc1LTcuNjA4IDEuMDA1LTIxLjYzNCAxMi4zNDItMzMuODE5IDE2LjI4MWwzLjU4MyA2LjY3MWM1LjU4OC0yLjg5NSAxNy4yNjEtMTMuMzU3IDMyLjgzMS0xOC4yMjZ6bS0yNjkuMzU0LTQuNzI4Yy00Mi4yNDgtNS42MjItOTUuOTM5IDIxLjQ2MS0xMTQuMjIgMzEuMzc1LS4yNzQuMTY0LS41NTcuMzEzLS44MjguNDY0LS4wODMuMDU0LS4xNTcuMTEtLjI1LjE2NC0uMTgzLjA4My0uMzUxLjE5Mi0uNTMzLjMwMy0uMDkuMDY2LS4xODguMTIzLS4yOS4xNjhhNy45OTQgNy45OTQgMCAwIDEtLjQ1Mi4yOTdjLS4wODQuMDQ2LS4xODMuMTEzLS4yODguMTgyLS4xMzMuMS0uMjczLjE4OS0uNDE5LjI2OC0uMDgyLjA2OC0uMTcuMTM3LS4yNjkuMjA2LS4xMzQuMDg3LS4yNTkuMTcxLS4zOTcuMjctLjA5MS4wNjgtLjE2My4xMzctLjI1MS4xOWEzLjUyOCAzLjUyOCAwIDAgMC0uMzc3LjI5Yy0uMDg4LjA2MS0uMTczLjEwNi0uMjQ0LjE3MmE1LjIzNyA1LjIzNyAwIDAgMS0uMzYyLjI4N2MtLjA2Ny4wNTktLjE0Ny4xMjUtLjIyNi4xOTEtLjExNi4xMDUtLjIyNC4xODQtLjM0OC4yODhhMy4xNDcgMy4xNDcgMCAwIDAtLjE5My4xOWMtLjExOC4wODEtLjI0LjE4OS0uMzQxLjI5OWExLjEwNCAxLjEwNCAwIDAgMS0uMTg2LjE1NGMtLjEyLjExMi0uMjE0LjIyNi0uMzI2LjMyNWExLjI5NCAxLjI5NCAwIDAgMC0uMTY3LjE1NWMtLjA5NS4xMTktLjIwOS4yMjEtLjMyMy4zMjhhMi4zNyAyLjM3IDAgMCAwLS4xMjUuMTU2IDMuMTQ0IDMuMTQ0IDAgMCAwLS4zMjUuMzQ4LjYxNS42MTUgMCAwIDEtLjEwNy4xMjEgNC44NDEgNC44NDEgMCAwIDAtLjMxNS4zNy45MzguOTM4IDAgMCAwLS4wOTUuMTA0Yy0uMTE4LjE0NS0uMjE5LjI2Ni0uMzE1LjQwM2E1LjE1OSA1LjE1OSAwIDAgMS0uMDY4LjA4N2MtLjExOS4xMzgtLjIxNi4yODUtLjMyMS40NDJhLjM2Mi4zNjIgMCAwIDEtLjAzNi4wNDJjLS4xMjQuMTUyLS4yMjcuMzI4LS4zMzMuNDczLjAyNS0uMDEgOTcuNjg4LTQxLjk2MSAxMjEuOTg0LTM0LjM3OSAxNS41NCA0Ljg2OSAyNy4yMjMgMTUuMzMxIDMyLjgwMiAxOC4yMjRsMy40MjMtNi4zNDJjLTEyLjQxMS0zLjU5NC0yNy4wMzEtMTUuNTc4LTM0Ljg3OS0xNi42MTV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMjczLjU3IDE1My4wOTZsLjQ2NC4xODdjLS4xNTgtLjA2NC0uMzA3LS4xMjYtLjQ2NC0uMTg3em0tLjQ3My0uMjQ5Yy01LjU3OS0yLjg4Mi0xNy4yNjItMTMuMzU4LTMyLjgxNS0xOC4yMzEtMjQuMjA4LTcuNTU0LTEyMS4zMDcgMzQuMDkyLTEyMS45NzcgMzQuMzc2LTQuOTcxIDcuNDM1LTIuMjExIDE1LjMzMS0xMC44NDEgMjIuOTY2LS4wMTYuMDEzLS4wNDIuMDIzLS4wNi4wMzQgMzMuMTU5LTE3Ljg3NSA5OS4xNjUtMzguMTEgMTE4Ljc0OS0zNC4zMzEgOS4xMjMgMS43NTYgMTkuOTA1IDEyLjA4MyAzMS4wOCAyNC43NjFsMTUuODUxLTI5LjU4My4wMTMuMDA4eiIvPgogICAgPHBhdGggZD0iTTI3My4wOTcgMTUyLjg0N2MuMTcyLjA4OC4zMTMuMTczLjQ3My4yNDktLjE2MS0uMDc3LS4zMDEtLjE2MS0uNDczLS4yNDl6Ii8+CiAgICA8cGF0aCBkPSJNMjU3Ljk1OSAxODMuMjI4Yy4yMzQuMjk2LjQ2Ni41NjUuNzI1LjgzNWwxNi4zODQtMzAuNTM4IDMuNDktNi41MzFjLS4zNDQtLjA2Ni0uNjg4LS4xMzEtMS4wMzgtLjIyNi0uMzM1LS4wOTItLjY3My0uMTktMS4wMTMtLjI3MWwtMy40MjMgNi4zNDItMTUuODUxIDI5LjU4M2MuMjM1LjI2OC40NjcuNTM1LjcyNi44MDZtMjIwLjE4OC0zMC4zODlsLTMuNTgzLTYuNjcxYy0uMzMzLjA5My0uNjY2LjIwNy0uOTk2LjMxMS0uMzM5LjA4OS0uNjc5LjE3Ni0xLjAxNi4yN2wzLjYzOSA2Ljc3OCAxNi4zODMgMzAuNTM4Yy4yMzEtLjI3LjQ5Mi0uNTM5LjcyMy0uODM2LjIzMi0uMjcuNDk0LS41MzcuNzI3LS44MDVsLTE1Ljg3Ny0yOS41ODV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMzU2Ljk0NiAxNjkuMjk0bC0uMDAzLjAwMi4wMDMtLjAwMnoiLz4KICAgIDxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik00MDcuNTc5IDE5Ni40MTJjMCAxNy45OTMtMTQuNTggMzIuNTc3LTMyLjU3NCAzMi41NzctMTcuOTk1IDAtMzIuNTc0LTE0LjU4NC0zMi41NzQtMzIuNTc3IDAtMTcuOTgzIDE0LjU3OS0zMi41NzUgMzIuNTc0LTMyLjU3NSAxNy45OTQgMCAzMi41NzQgMTQuNTkyIDMyLjU3NCAzMi41NzV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMzg0LjAwNiAxODIuMDA5czguOTMzLTkuNDQ0IDEzLjc3LTguODc2bC0uMDA3LS4wMDZhMzYuMzU0IDM2LjM1NCAwIDAgMC0yLjI2Mi0yLjAxOC4wNTkuMDU5IDAgMCAxLS4wMjItLjAxMiAxOS42MTMgMTkuNjEzIDAgMCAwLTEuMTgyLS45MDljLS4wMjQtLjAxOS0uMDUtLjAzNi0uMDYyLS4wNTQtLjM4Ni0uMjc4LS43NzEtLjU0OS0xLjE3My0uODM1bC0uMDA0LS4wMDNjLS4zOC0uMDYtLjc3Ni0uMTI1LTEuMTg4LS4xNjYtNS4yNS0uNDk0LTE2Ljg2OSA0LjUxMS0xNi44NjkgNC41MTFzLTExLjYyLTUuMDA1LTE2Ljg2OS00LjUxMWMtLjQxMy4wNDEtLjgxLjEwNS0xLjE4OC4xNjZsLS4wMDMuMDAyYy0uNDA3LjI5LS43OTUuNTYzLTEuMTguODQzYS4zMDYuMzA2IDAgMCAxLS4wNTYuMDQ2Yy0uNDA3LjI5MS0uODA0LjU5Ny0xLjE4OC45MTZsLS4wMTcuMDA3YTM1Ljk1OCAzNS45NTggMCAwIDAtMi4yNjkgMi4wMjN2LjAwMWM0LjgzNi0uNTY3IDEzLjc2OCA4Ljg3NyAxMy43NjggOC44NzdzLTE3LjczMiAyMC44ODQtMTYuOTY1IDM0LjA4NGMxLjEgMS40MzUgMi4zMSAyLjc4IDMuNjE4IDQuMDI2LS40NC0xMS45OTIgMjIuMzQ5LTMwLjEzNCAyMi4zNDktMzAuMTM0czIyLjc4OSAxOC4xNCAyMi4zNSAzMC4xMzRhMzQuMTcgMzQuMTcgMCAwIDAgMy41NzYtMy45OC40NjIuNDYyIDAgMCAwIC4wNDEtLjA0NmMuNzY0LTEzLjIwMi0xNi45NjgtMzQuMDg2LTE2Ljk2OC0zNC4wODZ6TTU0OS4wOCA1LjQ2NmEyMy41NTMgMjMuNTUzIDAgMCAwLTEuMjExLS44OTlsLTIuMzQ3IDEwOS45OTUgNTMuMjcyIDcuMjM0QzU4Ni43MjkgNC45NzQgNTU1LjgyMiAxMC43NjIgNTQ5LjA4IDUuNDY2eiIvPgogICAgPHBhdGggZmlsbD0iIzE0MTQxNCIgZD0iTTUyMi4wNDMuMTQyYy0xMC44MjMuNDAzLTEyLjA2MyAxMS40MzktMTIuMTgyIDE1LjE5djEuMjI3czIuODk5IDQwLjcxNiAwIDkzLjA5NGM5LjkyNiAyLjI4OSAzOC41MzUgNS4yOTggMzguNTM1IDUuMjk4cy4wMzQtMjAuOTE0LjY4NS01MC41OTZjLjgwMi0zNy41MDEtMS4yMTEtNTkuNzg4LTEuMjExLTU5Ljc4OEM1NDEuNDUzLjA5MSA1MzQuMzAyLS4zMDcgNTIyLjA0My4xNDJ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMjAwLjk5NiA1LjQ2NmMuNDAxLS4zMTkuODA1LS42MTggMS4yMTEtLjg5OWwyLjMyMiAxMDkuOTk1LTUzLjI0OCA3LjIzNEMxNjMuMzQ4IDQuOTc0IDE5NC4yNCAxMC43NjIgMjAwLjk5NiA1LjQ2NnoiLz4KICAgIDxwYXRoIGZpbGw9IiMxNDE0MTQiIGQ9Ik0yMjguMDIyLjE0MmMxMC44MzMuNDAzIDEyLjA2OSAxMS40MzkgMTIuMTkzIDE1LjE5djEuMjI3cy0yLjkwMSA0MC43MTYgMCA5My4wOTRjLTkuOTI2IDIuMjg5LTM4LjUzOSA1LjI5OC0zOC41MzkgNS4yOThzLS4wNTEtMjAuOTE0LS42OC01MC41OTZjLS44MTEtMzcuNTAxIDEuMjExLTU5Ljc4OCAxLjIxMS01OS43ODhDMjA4LjYyNC4wOTEgMjE1Ljc3My0uMzA3IDIyOC4wMjIuMTQyeiIvPgogICAgPHBhdGggZmlsbD0iIzBBMEEwQSIgZD0iTTYxNi40OTMgMzA0LjUxMWMtMTMuNzg3IDAtMjUuMDA0LTExLjIyNC0yNS4wMDQtMjUuMDE4IDAtMTMuNzg5IDExLjIxNy0yNS4wMDQgMjUuMDA0LTI1LjAwNCAxMy43OTUgMCAyNS4wMTggMTEuMjE3IDI1LjAxOCAyNS4wMDQgMCAxMy43OTUtMTEuMjIzIDI1LjAxOC0yNS4wMTggMjUuMDE4eiIvPgogICAgPHBhdGggZmlsbD0iIzFBMTYxNSIgZD0iTTYxNi40OTMgMjU1Ljk3OGMxMyAwIDIzLjUyOSAxMC41MjcgMjMuNTI5IDIzLjUxNiAwIDEzLjAwMi0xMC41MjkgMjMuNTI5LTIzLjUyOSAyMy41MjktMTIuOTg4IDAtMjMuNTE2LTEwLjUyNy0yMy41MTYtMjMuNTI5IDAtMTIuOTg5IDEwLjUyOC0yMy41MTYgMjMuNTE2LTIzLjUxNm0wLTIuOTc4QzYwMS44ODUgMjUzIDU5MCAyNjQuODg1IDU5MCAyNzkuNDkzIDU5MCAyOTQuMTA5IDYwMS44ODUgMzA2IDYxNi40OTMgMzA2IDYzMS4xMDkgMzA2IDY0MyAyOTQuMTA5IDY0MyAyNzkuNDkzIDY0MyAyNjQuODg1IDYzMS4xMDkgMjUzIDYxNi40OTMgMjUzeiIvPgo8L3N2Zz4K);background-repeat:no-repeat}[data-kind=\"xboxone\"] .triggers{width:448px;height:122px;position:absolute;left:151px}[data-kind=\"xboxone\"] .trigger{width:89px;height:122px;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4OC45MzQiIGhlaWdodD0iMTIxLjc5NSIgdmlld0JveD0iMCAwIDg4LjkzNCAxMjEuNzk1Ij4KICAgIDxwYXRoIGZpbGw9IiNFNUU1RTUiIGQ9Ik03NC44MDkgNTYuMTd2LS42NjljLjAxNC40MTQgMCAuNjY5IDAgLjY2OXpNNDkuNzUyIDUuNDc1Yy40MDEtLjMxOS44MDYtLjYxOSAxLjIxMi0uOWwyLjMyNCAxMTAuMTc5TDAgMTIyQzEyLjA3NSA0Ljk4MiA0Mi45OTEgMTAuNzggNDkuNzUyIDUuNDc1eiIvPgogICAgPHBhdGggZmlsbD0iI0VCRUJFQiIgZD0iTTc2Ljc5OS4xNDJDODcuNjQuNTQ2IDg4Ljg3NiAxMS42MDEgODkgMTUuMzU4djEuMjI5cy0yLjkwMiA0MC43ODQgMCA5My4yNTFjLTkuOTM0IDIuMjkzLTM4LjU2NyA1LjMwNy0zOC41NjcgNS4zMDdzLS4wNTItMjAuOTQ5LS42ODEtNTAuNjgyYy0uODEyLTM3LjU2NCAxLjIxMi01OS44ODggMS4yMTItNTkuODg4QzU3LjM4Ni4wOTEgNjQuNTQtLjMwOCA3Ni43OTkuMTQyeiIvPgo8L3N2Zz4K);position:absolute}[data-kind=\"xboxone\"] .trigger.left{left:0;background-position:0 0}[data-kind=\"xboxone\"] .trigger.right{right:0;transform:rotateY(180deg)}[data-kind=\"xboxone\"] .bumper{width:170px;height:61px;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNzEuMTU0IiBoZWlnaHQ9IjYyLjg2NCIgdmlld0JveD0iMCAwIDE3MS4xNTQgNjIuODY0Ij4KICAgIDxwYXRoIGZpbGw9IiNGMkYyRjIiIGQ9Ik0xMzQuMjIxLjc2QzkxLjk3NC00Ljg2MiAzOC4yODIgMjIuMjIxIDIwLjAwMSAzMi4xMzVjLS4yNzQuMTY0LS41NTcuMzEzLS44MjguNDY0LS4wODMuMDU0LS4xNTcuMTEtLjI1LjE2NC0uMTgzLjA4My0uMzUxLjE5Mi0uNTMzLjMwM2ExLjYyMSAxLjYyMSAwIDAgMS0uMjkuMTY4IDguMDI0IDguMDI0IDAgMCAxLS40NTIuMjk3Yy0uMDg0LjA0Ni0uMTgzLjExMy0uMjg4LjE4MmEzLjQyOCAzLjQyOCAwIDAgMS0uNDE5LjI2OGMtLjA4Mi4wNjgtLjE3LjEzNy0uMjY5LjIwNi0uMTM0LjA4Ny0uMjU5LjE3MS0uMzk3LjI3LS4wOTEuMDY4LS4xNjMuMTM3LS4yNTEuMTlhMy4zOTMgMy4zOTMgMCAwIDAtLjM3Ny4yOWMtLjA4OC4wNjEtLjE3My4xMDYtLjI0NC4xNzJhNS4yIDUuMiAwIDAgMS0uMzYyLjI4N2MtLjA2Ny4wNTktLjE0Ny4xMjUtLjIyNi4xOTEtLjExNi4xMDUtLjIyNC4xODQtLjM0OC4yODhhMi45MDcgMi45MDcgMCAwIDAtLjE5My4xOWMtLjExOC4wODEtLjI0LjE4OS0uMzQxLjI5OWExLjA4IDEuMDggMCAwIDEtLjE4Ni4xNTRjLS4xMi4xMTItLjIxNC4yMjYtLjMyNi4zMjVhMS4yNjQgMS4yNjQgMCAwIDAtLjE2Ny4xNTVjLS4wOTUuMTE5LS4yMDkuMjIxLS4zMjMuMzI4YTIuNDM5IDIuNDM5IDAgMCAwLS4xMjUuMTU2IDMuMTYyIDMuMTYyIDAgMCAwLS4zMjUuMzQ4LjYyNi42MjYgMCAwIDEtLjEwNy4xMjEgNC41MTMgNC41MTMgMCAwIDAtLjMxNS4zNy45NzIuOTcyIDAgMCAwLS4wOTUuMTA0Yy0uMTE4LjE0NC0uMjE5LjI2Ni0uMzE1LjQwM2E1LjE1OSA1LjE1OSAwIDAgMS0uMDY4LjA4N2MtLjExOS4xMzgtLjIxNi4yODUtLjMyMS40NDJhLjMwNC4zMDQgMCAwIDEtLjAzNi4wNDJjLS4xMjQuMTUyLS4yMjcuMzI4LS4zMzMuNDczLjAyNS0uMDEgOTcuNjg4LTQxLjk2MSAxMjEuOTg0LTM0LjM3OSAxNS41NCA0Ljg2OSAyNy4yMjMgMTUuMzMxIDMyLjgwMiAxOC4yMjRsMy40MjMtNi4zNDJDMTU2LjY4OSAxMy43ODEgMTQyLjA2OSAxLjc5NyAxMzQuMjIxLjc2eiIvPgogICAgPHBhdGggZmlsbD0iI0U1RTVFNSIgZD0iTTE2Ni4xNjcgMjMuOTY5bC40NjQuMTg3Yy0uMTU5LS4wNjQtLjMwOC0uMTI2LS40NjQtLjE4N3ptLS40NzQtLjI0OWMtNS41NzktMi44ODItMTcuMjYyLTEzLjM1OC0zMi44MTUtMTguMjMxQzEwOC42Ny0yLjA2NiAxMS41NzEgMzkuNTgxIDEwLjkwMSAzOS44NjQgNS45MzEgNDcuMjk5IDguNjkgNTUuMTk1LjA2IDYyLjgzYy0uMDE2LjAxMy0uMDQyLjAyNC0uMDYuMDM0IDMzLjE1OS0xNy44NzUgOTkuMTY1LTM4LjExIDExOC43NDktMzQuMzMxIDkuMTIzIDEuNzU2IDE5LjkwNSAxMi4wODMgMzEuMDggMjQuNzYxbDE1Ljg1MS0yOS41ODNjLjAwNS4wMDQuMDA4LjAwNy4wMTMuMDA5eiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTE2NS42OTMgMjMuNzJjLjE3Mi4wODguMzEzLjE3My40NzMuMjQ5LS4xNjEtLjA3Ny0uMzAxLS4xNjEtLjQ3My0uMjQ5eiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTE1MC41NTUgNTQuMTAxYy4yMzQuMjk2LjQ2Ni41NjUuNzI1LjgzNWwxNi4zODQtMzAuNTM4IDMuNDktNi41MzFjLS4zNDQtLjA2Ni0uNjg4LS4xMzEtMS4wMzgtLjIyNi0uMzM1LS4wOTItLjY3My0uMTktMS4wMTMtLjI3MWwtMy40MjMgNi4zNDItMTUuODUxIDI5LjU4M2MuMjM1LjI2OC40NjcuNTM1LjcyNi44MDYiLz4KPC9zdmc+Cg==);opacity:0;position:absolute}[data-kind=\"xboxone\"] .bumpers{position:absolute;width:536px;height:61px;left:107px;top:129px}[data-kind=\"xboxone\"] .bumper[data-pressed=\"true\"]{opacity:1}[data-kind=\"xboxone\"] .bumper.left{left:0}[data-kind=\"xboxone\"] .bumper.right{right:0;transform:rotateY(180deg)}[data-kind=\"xboxone\"] .arrows{position:absolute;width:141px;height:33px;top:264px;left:306px}[data-kind=\"xboxone\"] .select,[data-kind=\"xboxone\"] .start{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2Ny40MDkiIGhlaWdodD0iMzMuMjA2IiB2aWV3Qm94PSIwIDAgNjcuNDA5IDMzLjIwNiI+CiAgICA8cGF0aCBmaWxsPSIjRjVGNUY1IiBzdHJva2U9IiNGRkYiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgZD0iTTY2LjkwOSAxNi42MDNjMCA4LjkwMy03LjIyOSAxNi4xMDMtMTYuMTAyIDE2LjEwMy04LjkwMSAwLTE2LjEwMi03LjItMTYuMTAyLTE2LjEwM0MzNC43MDUgNy43MDcgNDEuOTA1LjUgNTAuODA3LjVjOC44NzQgMCAxNi4xMDIgNy4yMDcgMTYuMTAyIDE2LjEwM3oiLz4KICAgIDxwYXRoIGQ9Ik00My42MTIgMTEuOTc4aDE0LjM2MXYxLjU1Mkg0My42MTJ6bTAgMy45MThoMTQuMzYxdjEuNTUySDQzLjYxMnptMCAzLjgxaDE0LjM2MXYxLjUzMkg0My42MTJ6IiBmaWxsPSIjOTI5NDkzIi8+CiAgICA8cGF0aCBmaWxsPSIjRjVGNUY1IiBzdHJva2U9IiNGRkYiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgZD0iTTMyLjcwNiAxNi42MDNjMCA4LjkwMy03LjIwMSAxNi4xMDMtMTYuMTAzIDE2LjEwM0M3LjczMSAzMi43MDYuNSAyNS41MDYuNSAxNi42MDMuNSA3LjcwNyA3LjczMS41IDE2LjYwMy41YzguOTAyIDAgMTYuMTAzIDcuMjA3IDE2LjEwMyAxNi4xMDN6Ii8+CiAgICA8ZyBmaWxsPSIjOTI5NDkzIj4KICAgICAgICA8cGF0aCBkPSJNMTQuMDg3IDE2LjUwMmgtMy4wMzF2LTMuNzg0aDUuNDcydjEuMzIxaDEuOHYtMy4wNkg5LjQzN3Y3LjM5aDQuNjV6Ii8+CiAgICAgICAgPHBhdGggZD0iTTE0LjgzNyAxNC42NjN2Ny41ODRoOC45NnYtNy41ODRoLTguOTZ6bTcuMTYxIDUuNzg0aC01LjQ3di0zLjk0NWg1LjQ3djMuOTQ1eiIvPgogICAgPC9nPgo8L3N2Zz4K);width:33px;height:33px;opacity:0;position:absolute}[data-kind=\"xboxone\"] .select[data-pressed=\"true\"],[data-kind=\"xboxone\"] .start[data-pressed=\"true\"]{opacity:1}[data-kind=\"xboxone\"] .select{left:0}[data-kind=\"xboxone\"] .start{background-position:33px 0;left:33px}[data-kind=\"xboxone\"] .buttons{position:absolute;width:155px;height:156px;top:201px;left:489px}[data-kind=\"xboxone\"] .button{position:absolute;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMTIiIGhlaWdodD0iMTA2IiB2aWV3Qm94PSIwIDAgMjEyIDEwNiI+CiAgICA8cGF0aCBmaWxsPSIjMTQxNDE0IiBkPSJNMjYuNDkxIDBDNDEuMTQgMCA1MyAxMS44NjggNTMgMjYuNSA1MyA0MS4xMzMgNDEuMTQgNTMgMjYuNDkxIDUzIDExLjg2MSA1MyAwIDQxLjEzMyAwIDI2LjUgMCAxMS44NjggMTEuODYxIDAgMjYuNDkxIDB6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMzlCNTRBIiBkPSJNMzUuMjUxIDQxLjY1NGwtMi43NzgtNy42NjNIMjAuMzQ1TDE3LjcgNDEuNjU0aC01LjQ4MWwxMS40NjctMzAuMzA5aDUuNTgzbDExLjUxMiAzMC4zMDloLTUuNTN6bS04Ljc5LTI1Ljc1NmgtLjEyOWMtLjEwNy44NDctLjIzOCAxLjU3Ny0uNDUgMi4xNzRsLTQuMTM3IDExLjY4aDkuMjkzbC00LjE2NC0xMS42OGMtLjEzMi0uMzY2LS4yODItMS4wOS0uNDEzLTIuMTc0eiIvPgogICAgPHBhdGggZmlsbD0iIzE0MTQxNCIgZD0iTTc5LjQ5My4wMDFjMTQuNjQ2IDAgMjYuNTA4IDExLjg3MSAyNi41MDggMjYuNTAzUzk0LjEzOSA1My4wMDEgNzkuNDkzIDUzLjAwMUM2NC44NiA1My4wMDEgNTMgNDEuMTM1IDUzIDI2LjUwM1M2NC44Ni4wMDEgNzkuNDkzLjAwMXoiLz4KICAgIDxwYXRoIGZpbGw9IiNDMTI3MkQiIGQ9Ik04OS42OTkgMzIuODI4YzAgMi42MjgtLjk4MyA0Ljc4My0yLjkyNiA2LjM4Ni0xLjk1NyAxLjYzMy00LjQ2OSAyLjQzNy03LjU2NSAyLjQzN2gtOS45MDdWMTEuMzVoOS41NzFjMi44OTggMCA1LjE5NC42NDYgNi44NjcgMS44ODQgMS42ODYgMS4yNjYgMi41MjIgMi45NTIgMi41MjIgNS4wODkgMCAxLjY0Ni0uNTA0IDMuMDk3LTEuNSA0LjM0OS0xLjAxNSAxLjI3OS0yLjMyMiAyLjE0OS0zLjk1NiAyLjY3di4wOTFjMi4xNjQuMjczIDMuODQyIDEuMDc1IDUuMDY4IDIuMzcyIDEuMjAxIDEuMzI2IDEuODI2IDIuOTggMS44MjYgNS4wMjN6TTgyLjkzMSAxOS4yOWMwLTEuMjA0LS40NTQtMi4xNDQtMS4zMzItMi43OTUtLjkwNy0uNjQ4LTIuMjI1LS45NzMtMy45NzktLjk3M2gtMy4yNzZ2OC4zODNoMy4yMzFjMS42OTMgMCAzLjAyMS0uMzk5IDMuOTU1LTEuMjAxLjkyNS0uODAxIDEuNDAxLTEuOTIxIDEuNDAxLTMuNDE0em0xLjQzMyAxMy40MDJjMC0xLjQ0OS0uNTA4LTIuNTg1LTEuNTU4LTMuNDA5LTEuMDUxLS44MTMtMi41OTYtMS4yMDYtNC42NzQtMS4yMDZoLTMuNzl2OS40MTNoNC4yMzhjMS44MDIgMCAzLjIxMi0uNDM4IDQuMjM3LTEuMzA4IDEuMDQ1LS44NTYgMS41NDctMi4wMjYgMS41NDctMy40OXoiLz4KICAgIDxwYXRoIGZpbGw9IiMxNDE0MTQiIGQ9Ik0xODUuNDkgMEMyMDAuMTQxIDAgMjEyIDExLjg3NiAyMTIgMjYuNTA0YzAgMTQuNjMxLTExLjg1OSAyNi40OTctMjYuNTEgMjYuNDk3LTE0LjYzMSAwLTI2LjQ5LTExLjg2Ni0yNi40OS0yNi40OTdDMTU5IDExLjg3NiAxNzAuODU5IDAgMTg1LjQ5IDB6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRkNFRTIxIiBkPSJNMTg3Ljg5NyAzMC42NjNWNDEuNjVoLTQuOTk2VjMwLjc4NmwtOS44NDgtMTkuNDM3aDUuNzIxbDYuMDk2IDEyLjY0NmMuMjE0LjQxMS4zNC43ODMuNDM4IDEuMTIxLjEwMS4zMzYuMTc3LjYwOS4yNTcuODI1aC4wNDVjLjE1Mi0uNjYuMzg3LTEuMy42OTQtMS45MDNsNi4zMjMtMTIuNjg5aDUuMzE4bC0xMC4wNDggMTkuMzE0eiIvPgogICAgPHBhdGggZmlsbD0iIzE0MTQxNCIgZD0iTTEzMi40ODQgMEMxNDcuMTQxIDAgMTU5IDExLjg3MiAxNTkgMjYuNTAzcy0xMS44NTkgMjYuNDk4LTI2LjUxNiAyNi40OThDMTE3Ljg2MSA1My4wMDEgMTA2IDQxLjEzNCAxMDYgMjYuNTAzUzExNy44NjEgMCAxMzIuNDg0IDB6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMDA3MUJDIiBkPSJNMTM5LjYxMyA0MS42NWwtNi40MDYtMTEuMDE5YTUuODEzIDUuODEzIDAgMCAxLS4zMDktLjc2NCA1LjQ2MSA1LjQ2MSAwIDAgMC0uMjEyLS43NjNoLS4wOTNjLS4xMTUuMjc1LS4xODkuNTIzLS4yNjYuNzc1YTYuMDc3IDYuMDc3IDAgMCAxLS4zMzguNzVsLTYuNTIxIDExLjAxOWgtNi4xMjNsMTAuMTM3LTE1LjE4OC05LjI1OS0xNS4xMTFoNi4xODdsNS40IDkuOTU0Yy41Mi44ODUuODYxIDEuNjQgMS4wNDggMi4yNjZoLjA3M2MuMzA1LS43OTMuNTM3LTEuMzExLjY1Ni0xLjU2LjEwOC0uMjM3IDIuMjA5LTMuNzk3IDYuMjcxLTEwLjY2aDUuNjc1bC05LjQ1OSAxNS4wMiA5LjU4IDE1LjI4MWgtNi4wNDF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRkZGIiBkPSJNMjYuNDkxIDUzQzQxLjE0IDUzIDUzIDY0Ljg2NyA1MyA3OS41UzQxLjE0IDEwNiAyNi40OTEgMTA2QzExLjg2MSAxMDYgMCA5NC4xMzMgMCA3OS41UzExLjg2MSA1MyAyNi40OTEgNTN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMzlCNTRBIiBkPSJNMzUuMjUxIDk0LjY1NGwtMi43NzgtNy42NjJIMjAuMzQ1TDE3LjcgOTQuNjU0aC01LjQ4MWwxMS40NjctMzAuMzA5aDUuNTgzbDExLjUxMyAzMC4zMDloLTUuNTMxem0tOC43OS0yNS43NTZoLS4xMjljLS4xMDcuODQ4LS4yMzggMS41NzgtLjQ1IDIuMTc0bC00LjEzOCAxMS42OGg5LjI5M2wtNC4xNjMtMTEuNjhjLS4xMzItLjM2NS0uMjgyLTEuMDktLjQxMy0yLjE3NHoiLz4KICAgIDxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik03OS40OTMgNTNDOTQuMTM5IDUzIDEwNiA2NC44NzEgMTA2IDc5LjUwNCAxMDYgOTQuMTM0IDk0LjEzOSAxMDYgNzkuNDkzIDEwNiA2NC44NiAxMDYgNTMgOTQuMTMzIDUzIDc5LjUwMSA1MyA2NC44NzEgNjQuODYgNTMgNzkuNDkzIDUzeiIvPgogICAgPHBhdGggZmlsbD0iI0MxMjcyRCIgZD0iTTg5LjY5OSA4NS44MjhjMCAyLjYyOC0uOTg0IDQuNzgzLTIuOTI1IDYuMzg2LTEuOTU3IDEuNjMzLTQuNDcgMi40MzgtNy41NjYgMi40MzhoLTkuOTA3VjY0LjM0OWg5LjU3MWMyLjg5OCAwIDUuMTk0LjY0NiA2Ljg2NyAxLjg4NiAxLjY4NSAxLjI2NiAyLjUyMyAyLjk1MiAyLjUyMyA1LjA4OSAwIDEuNjQ2LS41MDQgMy4wOTctMS41IDQuMzQ5LTEuMDE1IDEuMjc5LTIuMzIyIDIuMTQ5LTMuOTU2IDIuNjcxdi4wOWMyLjE2NC4yNzMgMy44NDIgMS4wNzYgNS4wNjggMi4zNzMgMS4yIDEuMzIzIDEuODI1IDIuOTc4IDEuODI1IDUuMDIxem0tNi43NjgtMTMuNTM5YzAtMS4yMDQtLjQ1NC0yLjE0NC0xLjMzMi0yLjc5NS0uOTA3LS42NDktMi4yMjUtLjk3NC0zLjk3OS0uOTc0aC0zLjI3NnY4LjM4NGgzLjIzMWMxLjY5MyAwIDMuMDIxLS4zOTkgMy45NTUtMS4yMDEuOTI1LS44IDEuNDAxLTEuOTIgMS40MDEtMy40MTR6bTEuNDMzIDEzLjQwM2MwLTEuNDQ5LS41MDgtMi41ODYtMS41NTgtMy40MDktMS4wNTEtLjgxMy0yLjU5Ni0xLjIwNi00LjY3NC0xLjIwNmgtMy43OXY5LjQxM2g0LjIzOGMxLjgwMiAwIDMuMjEyLS40MzggNC4yMzctMS4zMDggMS4wNDUtLjg1NiAxLjU0Ny0yLjAyNyAxLjU0Ny0zLjQ5eiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTEzMi40ODQgNTNDMTQ3LjE0MSA1MyAxNTkgNjQuODcgMTU5IDc5LjUwMyAxNTkgOTQuMTMzIDE0Ny4xNDEgMTA2IDEzMi40ODQgMTA2IDExNy44NjEgMTA2IDEwNiA5NC4xMzMgMTA2IDc5LjUwMyAxMDYgNjQuODcgMTE3Ljg2MSA1MyAxMzIuNDg0IDUzeiIvPgogICAgPHBhdGggZmlsbD0iIzAwNzFCQyIgZD0iTTEzOS42MTUgOTQuNjUxbC02LjQwNi0xMS4wMmE1LjkwNiA1LjkwNiAwIDAgMS0uMzExLS43NjQgNS4yMSA1LjIxIDAgMCAwLS4yMTEtLjc2NGgtLjA5NGMtLjExNS4yNzQtLjE4OC41MjItLjI2Ni43NzRhNS43OTYgNS43OTYgMCAwIDEtLjMzNi43NWwtNi41MjMgMTEuMDIxaC02LjEyM2wxMC4xMzctMTUuMTg5LTkuMjYtMTUuMTExaDYuMTg4bDUuNCA5Ljk1NWMuNTIuODg1Ljg1OSAxLjY0MSAxLjA0NyAyLjI2N2guMDc0Yy4zMDUtLjc5My41MzUtMS4zMTIuNjU2LTEuNTYyLjEwNy0uMjM2IDIuMjA5LTMuNzk3IDYuMjctMTAuNjZoNS42NzZsLTkuNDU5IDE1LjAyMSA5LjU4IDE1LjI4MWgtNi4wMzl2LjAwMXoiLz4KICAgIDxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik0xODUuNDkgNTNDMjAwLjE0MSA1MyAyMTIgNjQuODc0IDIxMiA3OS41MDQgMjEyIDk0LjEzNiAyMDAuMTQxIDEwNiAxODUuNDkgMTA2IDE3MC44NTkgMTA2IDE1OSA5NC4xMzYgMTU5IDc5LjUwNCAxNTkgNjQuODc0IDE3MC44NTkgNTMgMTg1LjQ5IDUzeiIvPgogICAgPHBhdGggZmlsbD0iI0ZDRUUyMSIgZD0iTTE4Ny44OTcgODMuNjYyVjk0LjY1aC00Ljk5NlY4My43ODVsLTkuODQ4LTE5LjQzNmg1LjcyMWw2LjA5NiAxMi42NDZjLjIxNC40MS4zNC43ODMuNDM4IDEuMTIxLjEwMS4zMzYuMTc3LjYwOS4yNTcuODI0aC4wNDVhOC4yNyA4LjI3IDAgMCAxIC42OTQtMS45MDJsNi4zMjMtMTIuNjg5aDUuMzE4bC0xMC4wNDggMTkuMzEzeiIvPgo8L3N2Zz4K);width:53px;height:53px}[data-kind=\"xboxone\"] .button[data-pressed=\"true\"]{background-position-y:-53px}[data-kind=\"xboxone\"] .a{background-position:0 0;top:102px;left:51px}[data-kind=\"xboxone\"] .b{background-position:-53px 0;top:52px;left:102px}[data-kind=\"xboxone\"] .x{background-position:-106px 0;top:52px;left:0}[data-kind=\"xboxone\"] .y{background-position:-159px 0;top:1px;left:51px}[data-kind=\"xboxone\"] .sticks{position:absolute;width:371px;height:196px;top:239px;left:144px}[data-kind=\"xboxone\"] .stick{position:absolute;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjguNzciIGhlaWdodD0iODMuMzgzIiB2aWV3Qm94PSIwIDAgMTY4Ljc3IDgzLjM4MyI+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMTY3Ljk5OSA0MS41MTFjMCAyMi45MTQtMTguNTc4IDQxLjQ4OS00MS41MDcgNDEuNDg5QzEwMy41NzYgODMgODUgNjQuNDI1IDg1IDQxLjUxMSA4NSAxOC41NzcgMTAzLjU3NiAwIDEyNi40OTIgMGMyMi45MjggMCA0MS41MDcgMTguNTc3IDQxLjUwNyA0MS41MTF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjNDA0MDQwIiBkPSJNMTI2LjQ5MiAwaC0uODU0bC0uMTQ5LjAwM2gtLjAwNGwtLjAyNi4wMDFoLS4wMzVsLS4wMjguMDAxaC0uMDAzbC0uMDI3LjAwMWgtLjAzNWwtLjAyOC4wMDFoLS4wMDFsLS4wNjIuMDAyYTM2LjQyIDM2LjQyIDAgMCAwLS43NDQuMDI5bC45MzkgMTkuODg2YTIxLjU5IDIxLjU5IDAgMCAxIDEuMDUxLS4wMjVWMGguMDA2em0tMy45NzYuMTg4bC0uMTY5LjAxNy0uMDI4LjAwM2gtLjAwOWwtLjAyMS4wMDItLjAxNC4wMDFhLjA4OC4wODggMCAwIDAtLjAxNi4wMDJsLS4wMjEuMDAyaC0uMDA3bC0uMDI2LjAwM2gtLjAwMmMtLjU1OC4wNTgtMS4xMTMuMTI1LTEuNjY0LjIwNWwyLjgzIDE5LjcwN2MuMzQxLS4wNDkuNjg4LS4wOTEgMS4wMy0uMTI0TDEyMi41MTYuMTg4em0tMy45MzkuNTY2bC0uMDkxLjAxOGgtLjAwMmwtLjAyNS4wMDUtLjAwNi4wMDEtLjAyMy4wMDUtLjAwOC4wMDEtLjAyMi4wMDUtLjAwOS4wMDItLjAyMS4wMDMtLjAxMi4wMDItLjAxOC4wMDMtLjAxNS4wMDMtLjAxNy4wMDMtLjAxNC4wMDMtLjAxNi4wMDMtLjAxNy4wMDMtLjAxNS4wMDMtLjAxOS4wMDMtLjAxMi4wMDJhLjA3MS4wNzEgMCAwIDAtLjAyMS4wMDQuMDM2LjAzNiAwIDAgMC0uMDEuMDAybC0uMDIxLjAwNC0uMDEuMDAyLS4wMjIuMDA0LS4wMDguMDAyLS4wMjcuMDA1aC0uMDAzbC0uMDI5LjAwNmgtLjAwMWMtLjQ4LjEtLjk2LjIwNy0xLjQzNS4zMjNsNC43MTQgMTkuMzQxYy4zMzQtLjA4MS42Ny0uMTU0IDEuMDA3LS4yMkwxMTguNTc3Ljc1NHptLTMuODY3Ljk0M2MtLjI2OS4wOC0uNTM0LjE2LS44LjI0NWgtLjAwMWwtLjA2LjAyLS4wNTguMDE4LS4wMDUuMDAxLS4wNS4wMTZjLS4zMS4xLS42MTcuMjAzLS45MjIuMzExbDYuNTYgMTguNzk2Yy4zMjMtLjExMy42NTEtLjIxOS45NzktLjMxNUwxMTQuNzEgMS42OTd6bS0zLjc1OCAxLjMxMWMtLjYxNi4yNDktMS4yMjcuNTE0LTEuODI2Ljc5bDguMzQyIDE4LjA3NmMuMzExLS4xNDQuNjI4LS4yODEuOTQ2LS40MDlsLTcuNDYyLTE4LjQ1N3ptLTMuNjEzIDEuNjY5Yy0uNTkxLjMwNy0xLjE3Mi42MjgtMS43NDIuOTYybDEwLjA0MSAxNy4xOWMuMjk3LS4xNzMuNjAxLS4zNDIuOTA1LS41bC05LjIwNC0xNy42NTJ6bS0zLjQzNiAyLjAwN2MtLjU1Ny4zNjItMS4xMDQuNzM3LTEuNjQzIDEuMTI1bDExLjY0MSAxNi4xNWEyMy4xIDIzLjEgMCAwIDEgLjg1NS0uNTg2TDEwMy45MDMgNi42ODR6bS0zLjIzIDIuMzI3Yy0uNTE5LjQxNC0xLjAyOS44MzktMS41MjcgMS4yNzdsMTMuMTI4IDE0Ljk2NmMuMjYtLjIyOC41MjctLjQ1My43OTgtLjY2N0wxMDAuNjczIDkuMDExem0tMi45OTEgMi42MjRjLS4yODQuMjczLS41NjMuNTUyLS44MzguODMybC0uMDAzLjAwMi0uMDE5LjAyLS4wMDQuMDA0LS4wMTcuMDE4LS4wMDguMDA4LS4wMTQuMDEzLS4wMTEuMDExLS4wMS4wMTEtLjAxNi4wMTUtLjAwNy4wMDctLjAxOC4wMTgtLjAwNS4wMDNjLS4xNDUuMTUtLjI4OS4zMDEtLjQzMy40NTNsMTQuNDkzIDEzLjY0N2MuMjM3LS4yNTIuNDgzLS41MDEuNzMyLS43NEw5Ny42ODIgMTEuNjM1em0tMi43MjkgMi44OTlhLjAzLjAzIDAgMCAxLS4wMDguMDA4LjA0OS4wNDkgMCAwIDAtLjAxMS4wMTRsLS4wMS4wMS0uMDEyLjAxNC0uMDEuMDEyLS4wMS4wMTItLjAxLjAxMWEuMTc0LjE3NCAwIDAgMC0uMDEyLjAxNC4wNjUuMDY1IDAgMCAxLS4wMDguMDA5bC0uMDE0LjAxNS0uMDA2LjAwNy0uMDE0LjAxNy0uMDA0LjAwNS0uMDE2LjAxOS0uMDAxLjAwMmMtLjM3NS40NDItLjczOS44OTMtMS4wOTYgMS4zNTFsLS4wMTkuMDI0IDE1LjcyOCAxMi4yMDRjLjIxMy0uMjc0LjQzMi0uNTQyLjY1Ny0uODA3TDk0Ljk1MyAxNC41MzR6bS0yLjQ0IDMuMTQ0bC0uMTU3LjIyNi0uMDA0LjAwNS0uMDEuMDE0LS4wMDkuMDEyLS4wMDYuMDA5Yy0uMzE1LjQ1Ny0uNjIyLjkyLS45MTggMS4zOWwxNi44MiAxMC42NDVjLjE4Ni0uMjkxLjM3OC0uNTgxLjU3Ny0uODYzTDkyLjUxMyAxNy42Nzh6bS0yLjEyOCAzLjM2NGMtLjE1Mi4yNjktLjMwMi41NC0uNDQ4LjgxMmwtLjAwMi4wMDRjLS4xNjguMzExLS4zMzEuNjIzLS40OS45MzhsMTcuNzY3IDguOTgyYy4xNTQtLjMwNi4zMTgtLjYxMi40ODgtLjkxMWwtMTcuMzE1LTkuODI1em0tMS43OTUgMy41NTFjLS4wNjguMTUtLjEzNS4zMDMtLjE5OS40NTRsLS4wMDEuMDAxLS4wMjQuMDU3LS4wMjMuMDU2Yy0uMTguNDE5LS4zNTMuODQyLS41MTkgMS4yNjdsMTguNTQ3IDcuMjMxYy4xMjUtLjMxOC4yNTgtLjYzOC4zOTctLjk1MUw4OC41OSAyNC41OTN6bS0xLjQ0NSAzLjcwOWMtLjA5LjI2Ny0uMTc2LjUzMS0uMjYuOGwtLjAwMy4wMDljLS4wMDEuMDA3LS4wMDQuMDE0LS4wMDcuMDIxbC0uMDAzLjAxLS4wMDYuMDItLjAwNC4wMTItLjAwNi4wMTktLjAwMy4wMDktLjAwNi4wMjEtLjAwNC4wMS0uMDA2LjAyMS0uMDAyLjAwOC0uMDA3LjAyMS0uMDAzLjAxLS4wMDYuMDIxYS4xMjYuMTI2IDAgMCAwLS4wMDMuMDFsLS4wMDYuMDIxLS4wMDMuMDA5LS4wMDguMDIxYS4wMTkuMDE5IDAgMCAxLS4wMDIuMDA4bC0uMDA2LjAyMi0uMDAzLjAwOS0uMDA1LjAyMS0uMDAyLjAwOC0uMDA3LjAyMi0uMDAyLjAwNi0uMDA3LjAyNS0uMDAxLjAwNGMtLjAwMy4wMDgtLjAwNS4wMTctLjAwOS4wMjVsLS4wMDEuMDA2YS4wODUuMDg1IDAgMCAxLS4wMDguMDI0bC0uMDAxLjAwNC0uMDA4LjAyNi4wMDMuMDA1LS4wMDguMDI3LS4wMDEuMDAyLS4wMDguMDI4di4wMDJjLS4wNTYuMTg0LS4xMDguMzY1LS4xNTkuNTVsMTkuMTU4IDUuNDA3Yy4wOTMtLjMyOS4xOTQtLjY1OS4zMDQtLjk4MmwtMTguODgxLTYuMzIyem0tMS4wODEgMy44MzFhNDAuOTEzIDQwLjkxMyAwIDAgMC0uMzMzIDEuNTg1bC0uMDY4LjM2NSAxOS41OTEgMy41MzVjLjA2MS0uMzM2LjEzLS42NzcuMjA3LTEuMDFsLTE5LjM5Ny00LjQ3NXptLS43MDggMy45MTVhNDEuMzIgNDEuMzIgMCAwIDAtLjE0NyAxLjI3OXYuMDA2YS4xOTQuMTk0IDAgMCAwLS4wMDIuMDI0bC0uMDAxLjAxLS4wMDEuMDE4LS4wMDEuMDE3LS4wMDEuMDExYS4xNjQuMTY0IDAgMCAxLS4wMDIuMDIzdi4wMDJjLS4wMi4xOTYtLjAzNy4zOTItLjA1My41ODlsMTkuODQgMS42NDZjLjAyOS0uMzQ1LjA2NS0uNjkyLjExLTEuMDM0bC0xOS43NDItMi41OTF6bS0uMzI5IDMuOTY4Yy0uMDEyLjMxNy0uMDIuNjM2LS4wMjMuOTU1di42MzRjMCAuMTM0LjAwMS4yNjkuMDAzLjQwMmwxOS45MDYtLjIzMy0uMDAxLS4yNjNjMC0uMjY1LjAwNS0uNTMuMDE0LS43OTJsLTE5Ljg5OS0uNzAzem0xOS45MTkgMi44MDdsLTE5Ljg3MiAxLjE3NGMuMDMyLjU2NS4wNzggMS4xMzIuMTM0IDEuNjg5di4wMDVjMCAuMDEyLjAwMS4wMjIuMDAzLjAzNGwuMDAyLjAyLjAwMS4wMTcuMDAxLjAxMi4wMDIuMDIxdi4wMDRsLjAyLjE4MyAxOS43OTQtMi4xMmEyNC4zNjYgMjQuMzY2IDAgMCAxLS4wODUtMS4wMzl6bS4yMjEgMi4wNjVsLTE5LjY2OSAzLjA2Ni4wMDUuMDM1LjAwMS4wMDkuMDAzLjAyMi4wMDMuMDE4YS4wNS4wNSAwIDAgMCAuMDAyLjAxMmwuMDA0LjAyNXYuMDA0Yy4wODMuNTIyLjE3NyAxLjA0NC4yNzkgMS41NjNsLjAwNC4wMjEuMDAzLjAxNC4wMDIuMDE0LjAwNC4wMjEuMDAxLjAwOC4wMDYuMDI3di4wMDFsLjAzMy4xNjYgMTkuNS00LjAxMWEyNi41OTQgMjYuNTk0IDAgMCAxLS4xODEtMS4wMTV6bS40MTUgMi4wMTdsLTE5LjI4MyA0Ljk0OGMuMTY1LjY0Ni4zNDcgMS4yODMuNTQgMS45MTZsMTkuMDIyLTUuODc0YTIwLjcxMyAyMC43MTMgMCAwIDEtLjI3OS0uOTl6bS42MDYgMS45NjVsLTE4LjcxNCA2Ljc4NmMuMjI3LjYyNi40NjggMS4yNDQuNzI0IDEuODU0bDE4LjM2NS03LjY4M2EyMy43MDIgMjMuNzAyIDAgMCAxLS4zNzUtLjk1N3ptLjc5NSAxLjg5OEw4OS4wMSA1OS4zMjdsLjEwMy4yMTcuMDA0LjAxLjAwNS4wMS4wMS4wMi4wMDEuMDAyYy4xNzguMzY4LjM2MS43MzEuNTUxIDEuMDkzbC4wMTMuMDI0LjAwMy4wMDcuMDExLjAxOC4wMDcuMDE0YS4wMzQuMDM0IDAgMCAwIC4wMDYuMDEybC4wMDguMDE4LjAwNC4wMDkuMTczLjMyNSAxNy41NDEtOS40MTVhMjEuNTg5IDIxLjU4OSAwIDAgMS0uNDY3LS45MjN6bS45NzcgMS44MTlMOTAuODkxIDYyLjgzNWwuMjkyLjQ3OHYuMDAxbC4wMTMuMDIxLjAwNC4wMDYuMDA4LjAxM2E0MS4xNzggNDEuMTc4IDAgMCAwIC43NDggMS4xNjRsMTYuNTU3LTExLjA1NGMtLjE5LS4yODctLjM3Ny0uNTgzLS41NTMtLjg3N3ptMS4xNSAxLjcyNUw5My4xIDY2LjE0NGwuMjI0LjNhLjQ2MS40NjEgMCAwIDAgLjAxOC4wMjNsLjAwMi4wMDIuMDE4LjAyMS4wMDMuMDA0Yy4wMDYuMDEuMDEyLjAxNy4wMTkuMDI0bC4wMTUuMDIuMDA3LjAwOC4wMTIuMDE2LjAwNy4wMS4wMTEuMDE1LjAwOS4wMTEuMDExLjAxNC4wMDguMDEyLjAxLjAxNC4wMS4wMTRhLjA0Ny4wNDcgMCAwIDEgLjAxLjAxbC4wMTEuMDE1LjAwOC4wMTEuMDExLjAxNi4wMDcuMDEuMDEzLjAxNy4wMDYuMDA4LjAxNS4wMTkuMDA0LjAwNS4wMTYuMDIuMDAzLjAwNi4wMTcuMDIxLjAwMS4wMDIuMDE5LjAyMi4wMDEuMDAxYy4yMjkuMjk4LjQ2NC41OTMuNzAyLjg4NWwxNS40MjYtMTIuNTg1YTE4LjE0NiAxOC4xNDYgMCAwIDEtLjY0NC0uODIzem0xLjMxNSAxLjYxMkw5NS42MTYgNjkuMjI4Yy40NDQuNDkzLjg5OS45NzcgMS4zNjYgMS40NWwxNC4xNTctMTMuOTk3YTIyLjIzNSAyMi4yMzUgMCAwIDEtLjcxNC0uNzU3em0xLjQ2MyAxLjQ4TDk4LjQxNCA3Mi4wNTljLjI0OS4yMjkuNTA0LjQ1Ny43NTkuNjhsLjAwMi4wMDIuMDE2LjAxNC4wMDkuMDA5LjAxMS4wMDkuMDE1LjAxMi4wMDUuMDA0LjAyMS4wMTguMDAxLjAwMWMuMjE5LjE4OS40MzguMzc4LjY2Mi41NjRsMTIuNzU5LTE1LjI4MWMtLjI2OC0uMjIzLS41My0uNDUzLS43ODYtLjY4N3ptMS41OTcgMS4zMzNMMTAxLjQ3IDc0LjYxMWMuNTI5LjQgMS4wNjguNzg3IDEuNjE1IDEuMTYzbDExLjI0Mi0xNi40MjlhMjQuOTUgMjQuOTUgMCAwIDEtLjg0Mi0uNjA4em0xLjcxMyAxLjE3M2wtMTAuNDQzIDE2Ljk0OS4xMDQuMDYyLjAwNC4wMDNjLjAwNi4wMDUuMDEzLjAwOC4wMTkuMDExbC4wMTEuMDA4LjAxMi4wMDcuMDE4LjAxMS4wMDYuMDAzYy40OTguMzA0IDEuMDAxLjU5NiAxLjUxMi44NzhsLjAwMy4wMDIuMDIuMDFhLjAzNC4wMzQgMCAwIDAgLjAxMi4wMDZsLjAwMy4wMDMgOS42MTgtMTcuNDMxYTIwLjExNyAyMC4xMTcgMCAwIDEtLjg5OS0uNTIyem0xLjgxLjk5OGwtOC43NyAxNy44NzMuMzM1LjE2My4wMDIuMDAxLjAyNC4wMTIuMDA1LjAwMi4wMjEuMDFjLjAwMy4wMDIuMDA2LjAwNC4wMS4wMDRsLjAxNi4wMDkuMDE1LjAwNi4wMTMuMDA2YS4xNDIuMTQyIDAgMCAwIC4wMTguMDA4bC4wMTEuMDA2LjAxOS4wMDguMDA5LjAwNGEuMjE1LjIxNSAwIDAgMSAuMDI2LjAxNGwuMDI2LjAxMi4wMDEuMDAyYy40MTYuMTk1LjgzNS4zODUgMS4yNTkuNTY5bDcuODk2LTE4LjI3NGEyMi4xMDQgMjIuMTA0IDAgMCAxLS45MzYtLjQzNXptMS44ODkuODE3bC03LjAwNiAxOC42MzVjLjYyMS4yMzMgMS4yNDUuNDUxIDEuODgxLjY1NWw2LjA5Ny0xOC45NTFhMjEuODkgMjEuODkgMCAwIDEtLjk3Mi0uMzM5em0xLjk1OC42M2wtNS4xNzMgMTkuMjI0LjIzOS4wNjNoLjAwMWwuMDI3LjAwNy4wMDQuMDAxLjAyNC4wMDdhLjAzLjAzIDAgMCAxIC4wMDkuMDAybC4wMjEuMDA0LjAxMy4wMDQuMDE1LjAwNC4wMi4wMDQuMDM0LjAxLjAwNi4wMDEuMDI5LjAwOGMuNDk1LjEyNy45OS4yNDUgMS40OTIuMzU0bDQuMjQtMTkuNDUzYy0uMzM1LS4wNy0uNjcyLS4xNTItMS4wMDEtLjI0em0yLjAxMS40MzdsLTMuMjk3IDE5LjYzNGMuNjU0LjExIDEuMzEyLjIwNCAxLjk3MS4yODJsMi4zNTItMTkuNzY5Yy0uMzQzLS4wNC0uNjg4LS4wODktMS4wMjYtLjE0N3ptMi4wNjEuMjQ2bC0xLjQwNCAxOS44NTguNDAzLjAyNi4wMTUuMDAxLjAxNi4wMDEuMDIyLjAwMWguMDA4bC4wMjYuMDAxaC4wMDVjLjMxNy4wMi42MzYuMDMzLjk1Ni4wNDVoLjAwOWwuMDE3LjAwMWguMDU5bC4wMjguMDAxaC4wMDNsLjQyMS4wMTIuNDYyLTE5LjkwMmMtLjM0OS0uMDA0LS42OTgtLjAyLTEuMDQ2LS4wNDV6bTMuMTQ3IDBjLS4zNDkuMDIzLS42OTguMDQxLTEuMDQ4LjA0OWwuNDc2IDE5LjkwMmMuMjA1LS4wMDQuNDExLS4wMS42MTctLjAxOWguMDA3bC4wMjUtLjAwMWguMDA2bC4wMjgtLjAwMWguMDAxYy4zOTYtLjAxNy43ODgtLjAzNyAxLjE4LS4wNjNoLjAwMWwuMDYxLS4wMDRoLjAwMWwuMDI5LS4wMDJoLjAwMmwuMDI5LS4wMDMtMS40MTUtMTkuODU4em0yLjA2MS0uMjQ3YTE5LjcxIDE5LjcxIDAgMCAxLTEuMDI0LjE0N2wyLjM2IDE5Ljc2OWMuNjEtLjA3MyAxLjIxOS0uMTU5IDEuODI0LS4yNTloLjAwMWwuMDI5LS4wMDZoLjAwN2wuMDI0LS4wMDUuMDA5LS4wMDFhLjA3OC4wNzggMCAwIDAgLjAyMi0uMDA0bC4wMTEtLjAwMWEuOTE4LjkxOCAwIDAgMCAuMDItLjAwM2wuMDEzLS4wMDJhLjAzLjAzIDAgMCAwIC4wMDktLjAwMmwtMy4zMDUtMTkuNjMzem0yLjAxNS0uNDRjLS4zMzIuMDktLjY2NS4xNzEtMS4wMDEuMjQzbDQuMjQ4IDE5LjQ1MS4yMTktLjA0OWguMDAzbC4wMjctLjAwNi4wMDgtLjAwMi4wMjEtLjAwNS4wMTUtLjAwNC4wMTYtLjAwMy4wMi0uMDA1LjAwOS0uMDAyLjAyMi0uMDA1LjAwNy0uMDAyLjAyNi0uMDA2aC4wMDNsLjAyNy0uMDA2aC4wMDJjLjI1Mi0uMDU4LjUwNS0uMTE4Ljc1Ni0uMTgyaC4wMDFsLjAyNC0uMDA2LjAwNS0uMDAxLjAyNS0uMDA2LjAwNi0uMDAyLjAyNC0uMDA2aC4wMDdsLjAyMi0uMDA2LjAwOC0uMDAyLjAyMi0uMDA2YS4wNDkuMDQ5IDAgMCAwIC4wMDctLjAwM2wuMDI0LS4wMDUuMDA2LS4wMDIuMDI0LS4wMDYuMDA2LS4wMDEuMDIyLS4wMDYuMDA2LS4wMDIuMDI1LS4wMDZoLjAwNWEuMTEyLjExMiAwIDAgMCAuMDI2LS4wMDhoLjAwM2EuMTQ3LjE0NyAwIDAgMCAuMDI1LS4wMDhoLjAwNWwuMDI3LS4wMDdoLjAwMWwuMzktLjEwMy01LjE3NC0xOS4yMjV6bTEuOTU3LS42MzJjLS4zMTkuMTIxLS42NDYuMjM1LS45NzEuMzM5bDYuMTA0IDE4Ljk0OWMuMzA2LS4wOTguNjEyLS4yLjkxNS0uMzA2aC4wMDFhLjQxNS40MTUgMCAwIDEgLjA1My0uMDJsLjAwOC0uMDA0LjAyMS0uMDA1LjAxMy0uMDA0LjAxNi0uMDA2LjAxNi0uMDA2LjAxMi0uMDA0LjAyMS0uMDA4LjAwNy0uMDAyLjAyNC0uMDFoLjAwNGMuMjU4LS4wOTIuNTE0LS4xODYuNzY5LS4yODFsLTcuMDEzLTE4LjYzMnptMS44OTEtLjgxNmMtLjMwOC4xNDktLjYyMi4yOTYtLjkzNy40MzJsNy45MDIgMTguMjcyYy4zNDktLjE1MS42OTUtLjMwNyAxLjAzOS0uNDY4aC4wMDNsLjAyMS0uMDEyLjAwNy0uMDAyLjAyMS0uMDEuMDA5LS4wMDQuMDE5LS4wMDguMDExLS4wMDYuMDE2LS4wMDYuMDE1LS4wMDYuMDEtLjAwNi4wMi0uMDA5LjAwNC0uMDAyYTM0LjUgMzQuNSAwIDAgMCAuNjEzLS4yOTVsLTguNzczLTE3Ljg3em0xLjgxLS45OTljLS4yOTQuMTgxLS41OTIuMzU0LS44OTQuNTIxbDkuNjIzIDE3LjQyOC4xNzktLjEuMDA0LS4wMDJhLjQzNy40MzcgMCAwIDAgLjAyMi0uMDEybC4wMDUtLjAwNC4wMi0uMDEuMDA5LS4wMDYuMDE3LS4wMDguMDEzLS4wMDcuMDExLS4wMDYuMDE5LS4wMS4wMDctLjAwNC4wMjEtLjAxMi4wMDYtLjAwNGMuNDY3LS4yNjQuOTMxLS41MzcgMS4zODgtLjgxOGwtMTAuNDUtMTYuOTQ2em0xLjcxMy0xLjE3NWMtLjI3NS4yMDgtLjU2LjQxNC0uODQ0LjYwN2wxMS4yNDcgMTYuNDI2Yy4yNTItLjE3Mi41MDItLjM0OC43NDktLjUyNWwuMDAyLS4wMDIuMDIzLS4wMTcuMDAyLS4wMDEuMDIyLS4wMTYuMDA1LS4wMDQuMDItLjAxNi4wMDYtLjAwNC4wMTktLjAxMi4wMDktLjAwNy4wMTUtLjAxMi4wMTItLjAwOC4wMTMtLjAwOS4wMTMtLjAxMS4wMTMtLjAwOC4wMTUtLjAxLjAwOS0uMDA3LjAxOC0uMDEzLjAwNy0uMDA2LjAyMS0uMDE0LjAwMy0uMDAyLjAyMi0uMDE4LjAwMy0uMDAyYy4yMDEtLjE0Ni4zOTktLjI5NS41OTctLjQ0NGwtMTIuMDIxLTE1Ljg2NXptMS41OTQtMS4zMzFhMjQuMjQgMjQuMjQgMCAwIDEtLjc4Mi42ODVsMTIuNzY0IDE1LjI3OC4wMTMtLjAxMi4wMDQtLjAwMy4wMi0uMDE3LjAwNi0uMDA0LjAxOC0uMDE2LjAwNy0uMDA2LjAxNy0uMDE0LjAwOC0uMDA4LjAxNS0uMDEyLjAwOS0uMDA3LjAxNS0uMDE0LjAxLS4wMDguMDE1LS4wMTIuMDExLS4wMDkuMDEyLS4wMTFjLjAwNS0uMDAyLjAwOS0uMDA2LjAxMy0uMDFsLjAxMi0uMDEuMDEzLS4wMTEuMDEtLjAwOS4wMTUtLjAxMi4wMS0uMDA4LjAxNS0uMDEzLjAwNy0uMDA2LjAxOC0uMDE1LjAwNi0uMDA2LjAxNy0uMDE1LjAwNC0uMDA0LjAyMS0uMDE3LjAwNC0uMDA0LjAyMS0uMDE3LjAwMi0uMDAxLjAyMS0uMDE5LjAwMi0uMDAyYy4zMzEtLjI4NC42NTYtLjU3Mi45NzctLjg2M2wuMDA0LS4wMDQuMDE5LS4wMTguMDA2LS4wMDYuMDE3LS4wMTQuMDExLS4wMS4wMTEtLjAxMS4wMTUtLjAxMy4wMDctLjAwOC4wMTktLjAxNi4wMDMtLjAwMi4wMjItLjAyMS4wMDctLjAwOC0xMy40OTEtMTQuNjM3em0xLjQ2My0xLjQ4MWMtLjIzMS4yNTctLjQ3LjUxLS43MTQuNzU3bDE0LjE2MiAxMy45OTMuMDA1LS4wMDYuMDE2LS4wMTYuMDAzLS4wMDRjLjMxMi0uMzE2LjYxOS0uNjM4LjkyMS0uOTY0bC4wMDItLjAwMi4wMTktLjAyLjAwNi0uMDA2LjAxNS0uMDE2LjAxMS0uMDEyLjAxLS4wMTEuMDE0LS4wMTUuMDA2LS4wMDguMDItLjAyMS4wMDEtLjAwMWMuMTA1LS4xMTYuMjE0LS4yMzQuMzE4LS4zNTJsLTE0LjgxNS0xMy4yOTZ6bTEuMzE2LTEuNjEzYy0uMjA1LjI3Ni0uNDE5LjU1NC0uNjM4LjgybDE1LjQyOSAxMi41OC4wMDUtLjAwNy4wMTMtLjAxNi4wMDgtLjAxLjAxMy0uMDE2LjAwOS0uMDFhLjA3Ni4wNzYgMCAwIDEgLjAxMS0uMDE0bC4wMS0uMDEzLjAwOS0uMDExLjAxNC0uMDE2LjAwNi0uMDA5LjAxNS0uMDE5LjAwNC0uMDA0LjAxOC0uMDIxLjAwMi0uMDAzLjAxOC0uMDIyaC4wMDFhNDYuMDM0IDQ2LjAzNCAwIDAgMCAuNjM0LS44MDZsLjAwMS0uMDAyLjAxNS0uMDIuMDA0LS4wMDYuMDExLS4wMTYuMDA5LS4wMS4wMDgtLjAxMmEuMTQzLjE0MyAwIDAgMSAuMDExLS4wMTVsLjAwNS0uMDA3Yy4wMDUtLjAwNi4wMS0uMDEyLjAxNC0uMDJsLjAwMi0uMDAyYy4xMTktLjE1NS4yMzctLjMxMy4zNTQtLjQ3MmwtMTYuMDE1LTExLjgyMXptMS4xNS0xLjcyNGMtLjE3OC4yOTQtLjM2My41OS0uNTU1Ljg3NWwxNi41NjIgMTEuMDQ5LjEzOC0uMjEuMDEzLS4wMi4wMDMtLjAwNWMuMzA4LS40NjcuNjA0LS45MzkuODk0LTEuNDJsLjAwMS0uMDAyLjAxMy0uMDIxYS4wMTcuMDE3IDAgMCAwIC4wMDItLjAwNUwxNDUuMDQ0IDUyLjU4em0uOTc2LTEuODJjLS4xNDYuMzA5LS4zMDQuNjE4LS40NjYuOTJsMTcuNTQzIDkuNDA5Yy4yMzYtLjQ0MS40NjYtLjg4Ny42ODctMS4zMzZ2LS4wMDFsLjAxMy0uMDIzLjAwNC0uMDEuMDA5LS4wMTguMDA3LS4wMTQuMDA2LS4wMTIuMDExLS4wMjEuMDAzLS4wMDYuMTYxLS4zMzYtMTcuOTc4LTguNTUyem0uNzkzLTEuODk5Yy0uMTE2LjMyLS4yNDEuNjQzLS4zNzMuOTU4bDE4LjM2OCA3LjY3NmMuMDk3LS4yMjguMTg5LS40NTcuMjgxLS42ODhsLjAwMi0uMDA2LjAwOS0uMDIxYS4wOC4wOCAwIDAgMSAuMDA0LS4wMDlsLjAwOC0uMDIuMDA2LS4wMTYuMDA1LS4wMTRjLjAwMy0uMDA4LjAwNi0uMDE4LjAxLS4wMjVsLjAwMS0uMDAyYy4xMzctLjM0OS4yNy0uNy4zOTgtMS4wNTRsLTE4LjcxOS02Ljc3OXptLjYwNi0xLjk2NWMtLjA4NS4zMzEtLjE3OC42NjQtLjI3OS45OWwxOS4wMjQgNS44NjguMTI0LS40MTQuMDAxLS4wMDQuMDA4LS4wMjQuMDAxLS4wMDUuMDA2LS4wMjNhLjAxOS4wMTkgMCAwIDAgLjAwMi0uMDA4bC4wMDgtLjAyMS4wMDItLjAwOC4wMDctLjAyMy4wMDItLjAwNi4wMDctLjAyNC4wMDEtLjAwNS4wMDctLjAyNC4wMDEtLjAwNS4wMDgtLjAyNi4wMDEtLjAwMmMuMDAzLS4wMS4wMDUtLjAyLjAwOS0uMDI4di0uMDAzbC4wMDgtLjAyN3YtLjAwMWwuMDA4LS4wMjh2LS4wMDJjLjExNC0uMzk4LjIyNC0uNzk5LjMyNy0xLjIwMWwtMTkuMjgzLTQuOTQ2em0uNDE0LTIuMDE3Yy0uMDU0LjMzOS0uMTEzLjY3OS0uMTgzIDEuMDE1bDE5LjUgNC4wMDNjLjEzMy0uNjQ5LjI1MS0xLjMwMy4zNTMtMS45NThsLTE5LjY3LTMuMDZ6bS4yMi0yLjA2NGMtLjAyMS4zNDUtLjA0OS42OTMtLjA4NiAxLjAzN2wxOS43OTUgMi4xMTJjLjAyNS0uMjMzLjA0OS0uNDY1LjA2OS0uN3YtLjAwMmwuMDAyLS4wMjZ2LS4wMDhsLjAwMi0uMDIxLjAwMS0uMDEyLjAwMS0uMDEzYy4wMzMtLjM3OC4wNjEtLjc1Ny4wODMtMS4xMzhsLjAwMy0uMDYzLTE5Ljg3LTEuMTY2ek0xNjcuOTczIDQwbC0xOS44OTUuNzFjLjAwOS4yNjYuMDE0LjUzMy4wMTQuOGwtLjAwMS4yNTUgMTkuOTA2LjIyNi4wMDMtLjM4OHYtLjUwNGwtLjAwMS0uMDg5di0uMDQxYTMwLjY5MiAzMC42OTIgMCAwIDAtLjAwOC0uNDMxdi0uMDAxbC0uMDAyLS4wOTJ2LS4wNTNsLS4wMDEtLjAyNi0uMDAxLS4wMzN2LS4wMTNsLS4wMDEtLjAzNXYtLjAwNmE1LjIwNyA1LjIwNyAwIDAgMS0uMDEzLS4yNzl6bS0uMzMxLTMuOTY2bC0xOS43MzcgMi41OTljLjA0NC4zNDEuMDgyLjY4OC4xMSAxLjAzNGwxOS44NC0xLjY1NWMtLjAxNC0uMTU1LS4wMjctLjMxMS0uMDQyLS40NjYgMC0uMDAxIDAgMCAwIDBsLS4wMDMtLjAyOHYtLjAwOGwtLjAwMi0uMDIyLS4wMDEtLjAxMy0uMDAzLS4wMTgtLjAwMi0uMDIxLS4wMDEtLjAxLS4wMDMtLjAzYTUwLjYxNiA1MC42MTYgMCAwIDAtLjE1Ni0xLjM2MnptLS43MS0zLjkxNmwtMTkuMzk2IDQuNDgzYy4wNzguMzMzLjE0Ny42NzIuMjA4IDEuMDFsMTkuNTktMy41NDNhNDMuODIgNDMuODIgMCAwIDAtLjE4My0uOTQ2di0uMDA0YS4xNzQuMTc0IDAgMCAwLS4wMDUtLjAyMmwtLjAwMi0uMDEtLjAwNS0uMDItLjAwMy0uMDEzLS4wMDMtLjAxNi0uMDAzLS4wMTYtLjAwMy0uMDE1LS4wMDQtLjAxOC0uMDAyLS4wMTItLjAwNC0uMDIxLS4wMDItLjAxLS4wMDQtLjAyMi0uMDAyLS4wMDctLjAwNS0uMDI0LS4wMDEtLjAwOGMtLjAwMy0uMDA4LS4wMDQtLjAxNy0uMDA2LS4wMjVsLS4wMDEtLjAwNC0uMDA2LS4wMjYtLjAwMS0uMDA0LS4wMDYtLjAyOC0uMDAxLS4wMDItLjAwNi0uMDI5di0uMDAybC0uMDY4LS4zMTMtLjAwMS0uMDA0LS4wMDUtLjAyNi0uMDA2LS4wMjUtLjAwMS0uMDAzYTEuMDU1IDEuMDU1IDAgMCAwLS4wMDYtLjAyNmwtLjAwMS0uMDA1LS4wNTYtLjI0NHptLTEuMDgzLTMuODMxbC0xOC44NzIgNi4zMzRjLjEwOS4zMjMuMjExLjY1My4zMDUuOTgybDE5LjE1Ni01LjQxNS0uMDAzLS4wMDdjMC0uMDA0LS4wMDItLjAwOS0uMDA0LS4wMTRhLjEyLjEyIDAgMCAwLS4wMDUtLjAxOGwtLjAwMi0uMDExLS4wMDYtLjAyMi0uMDAxLS4wMDZhNDUuNDIyIDQ1LjQyMiAwIDAgMC0uNDU0LTEuNDg2bC0uMDAzLS4wMDktLjAwNC0uMDE0LS4wMDYtLjAxOC0uMDAxLS4wMDRjLS4wMzQtLjA5Ni0uMDY3LS4xOTQtLjEtLjI5MnptLTEuNDQ2LTMuNzA3bC0xOC4xNzQgOC4xMjVjLjE0LjMxMy4yNzMuNjMyLjM5Ny45NTFsMTguNTQ0LTcuMjM4YTM5LjA2OSAzOS4wNjkgMCAwIDAtLjc2Ny0xLjgzOHptLTEuNzk3LTMuNTUybC0xNy4zMSA5LjgzM2MuMTY5LjI5OS4zMzMuNjA0LjQ4OS45MTFsMTcuNzYxLTguOTkxYTQxLjgyNCA0MS44MjQgMCAwIDAtLjgxOS0xLjUzN3YtLjAwMWwtLjAxNS0uMDI2LS4wMDEtLjAwMS0uMDE3LS4wMjgtLjAxMy0uMDIzLS4wMDMtLjAwNS0uMDExLS4wMi0uMDA3LS4wMS0uMDEtLjAxNy0uMDA2LS4wMTItLjAwNy0uMDE0LS4wMDgtLjAxNS0uMDA3LS4wMTItLjAxMi0uMDItLjAwMy0uMDA2LS4wMDEtLjAwNnptLTIuMTMtMy4zNjFsLTE2LjI4OSAxMS40NDZjLjE5OC4yODEuMzkyLjU3Mi41NzcuODYzbDE2LjgxNy0xMC42NTMtLjEyOS0uMjAyLS4wMDctLjAxMS0uMDA1LS4wMDgtLjAxMy0uMDItLjAwMS0uMDAxYy0uMjE0LS4zMzItLjQzMi0uNjYtLjY1NC0uOTg1bC0uMDA2LS4wMDktLjAxMS0uMDE1LS4wMTEtLjAxNy0uMDA1LS4wMDZhMTIuODkgMTIuODkgMCAwIDAtLjI2My0uMzgyem0tMi40NDItMy4xNDRMMTQyLjkxMiAyNy40N2MuMjI2LjI2My40NDYuNTMzLjY1OC44MDdsMTUuNzIyLTEyLjIxMi0uMTE0LS4xNDdhLjM4NS4zODUgMCAwIDAtLjAxOS0uMDIzbC0uMDAyLS4wMDMtLjAxNi0uMDIxLS4wMDYtLjAwNy0uMDEzLS4wMTctLjAwNy0uMDA5LS4wMTItLjAxNS0uMDEtLjAxMi0uMDA5LS4wMTFhLjA2OS4wNjkgMCAwIDAtLjAxMS0uMDEzbC0uMDA3LS4wMTEtLjAxMi0uMDE2LS4wMDctLjAwOC0uMDE0LS4wMTctLjAwNS0uMDA3Yy0uMDA1LS4wMDYtLjAxMS0uMDEyLS4wMTUtLjAxOWwtLjAwNS0uMDA1LS4wMTYtLjAyLS4wMDMtLjAwNC0uMDE3LS4wMjEtLjAwMi0uMDAyLS4wMjEtLjAyNC0uMDE3LS4wMjEtLjAwMy0uMDAzYS4yMi4yMiAwIDAgMC0uMDItLjAyM2wtLjAxOC0uMDIyLS4wMDItLjAwMi0uMDE4LS4wMjItLjAwMy0uMDAzLS4wMTYtLjAyMS0uMDAzLS4wMDQtLjAxNy0uMDItLjAwNC0uMDA0LS4wMTYtLjAyLS4wMDMtLjAwNC0uMDE3LS4wMTktLjAwNC0uMDA2LS4wMTUtLjAxOC0uMDA1LS4wMDctLjAxNS0uMDE3LS4wMDYtLjAwOC0uMDEzLS4wMTctLjAwNy0uMDA4LS4wMTQtLjAxNi0uMDA3LS4wMDktLjAxMi0uMDE1LS4wMDgtLjAxLS4wMTEtLjAxNC0uMDEtLjAxMS0uMDExLS4wMTItLjAwOS0uMDEyLS4wMDktLjAxMi0uMDExLS4wMTMtLjAwOS0uMDExYS4wNzYuMDc2IDAgMCAxLS4wMTEtLjAxNGwtLjAwOC0uMDEtLjAxMy0uMDE1LS4wMDctLjAwOC0uMDE0LS4wMTctLjAwNS0uMDA2LS4wMTctLjAxOWEuMDE4LjAxOCAwIDAgMC0uMDA0LS4wMDVsLS4wMTYtLjAyLS4wMDMtLjAwMy0uMDE4LS4wMjEtLjAwMy0uMDA0LS4wMTYtLjAyLS4wMDMtLjAwNC0uMDE4LS4wMi0uMDAzLS4wMDNhLjMxMy4zMTMgMCAwIDAtLjAxNy0uMDIxbC0uMDAzLS4wMDMtLjAxNi0uMDIxLS4wMDQtLjAwNGEuMzEzLjMxMyAwIDAgMC0uMDE3LS4wMjFsLS4wMDMtLjAwMy0uMDE3LS4wMi0uMDA0LS4wMDQtLjAxNy0uMDItLjAwMy0uMDA0LS4wMTctLjAyLS4wMDUtLjAwNS0uMDE1LS4wMTgtLjAwNS0uMDA2LS4wMTUtLjAxOC0uMDA2LS4wMDctLjAxNS0uMDE2LS4wMDYtLjAwNy0uMDE0LS4wMTctLjAwNy0uMDA4LS4wMTQtLjAxNS0uMDA4LS4wMS0uMDExLS4wMTMtLjAxLS4wMTItLjAwOS0uMDExLS4wMTItLjAxNC0uMDA4LS4wMDktLjAxNi0uMDE4YS4wMjIuMDIyIDAgMCAxLS4wMDQtLjAwNWwtLjAxNy0uMDItLjAwMy0uMDAzYS42NzYuNjc2IDAgMCAwLS4xMDUtLjE0NHptLTIuNzI5LTIuODk3bC0xMy44MTkgMTQuMzNjLjI0OS4yMzkuNDk2LjQ4OC43MzIuNzRsMTQuNDg3LTEzLjY1NC0uMDAyLS4wMDJhNDMuMzQ2IDQzLjM0NiAwIDAgMC0xLjM5OC0xLjQxNHptLTIuOTkzLTIuNjI0TDEzOS45MiAyNC41ODNjLjI3LjIxNS41MzkuNDM5Ljc5OC42NjdsMTMuMTIxLTE0Ljk3Mi0uMjMzLS4yMDMtLjAwNi0uMDA1LS4wMTYtLjAxNC0uMDE1LS4wMTItLjAwOC0uMDA3YTQwLjMxMyA0MC4zMTMgMCAwIDAtMS4yNDktMS4wMzV6bS0zLjIzLTIuMzI1bC0xMC44NDYgMTYuNjk0Yy4yODcuMTg3LjU3NS4zODQuODU1LjU4NWwxMS42MzQtMTYuMTU0Yy0uMTUtLjEwOC0uMzAyLS4yMTYtLjQ1NS0uMzIybC0uMDAyLS4wMDEtLjAxNy0uMDExLS4wMS0uMDA3YS4wMy4wMyAwIDAgMC0uMDA3LS4wMDVsLS4wMi0uMDEzaC0uMDAxYTM1Ljk1IDM1Ljk1IDAgMCAwLS41MTQtLjM1M2wtLjAwNi0uMDA0LS4wMi0uMDEzLS4wMTItLjAwOC0uMDEzLS4wMDktLjAyLS4wMTMtLjAwNy0uMDA0YTIwLjIxNyAyMC4yMTcgMCAwIDAtLjUzOS0uMzYyem0tMy40MzgtMi4wMDdsLTkuMTk2IDE3LjY1N2MuMzA2LjE1OC42MDguMzI2LjkwNS41bDEwLjAzNC0xNy4xOTRjLS4xNDMtLjA4My0uMjg3LS4xNjctLjQzMS0uMjQ4bC0uMDU0LS4wMy0uMDU0LS4wMjlhMzguODc0IDM4Ljg3NCAwIDAgMC0xLjIwNC0uNjU2em0tMy42MTMtMS42NjVsLTcuNDU0IDE4LjQ1OWMuMzE3LjEyOC42MzYuMjY2Ljk0Ni40MDlsOC4zMzUtMTguMDgtLjAxMy0uMDA2LS4wMTQtLjAwNi0uMDE0LS4wMDYtLjAxNi0uMDA3LS4wMTQtLjAwNi0uMDE2LS4wMDctLjAxNC0uMDA1LS4wMTUtLjAwNi0uMDE1LS4wMDctLjAxMy0uMDA2LS4wMTQtLjAwNi0uMDE2LS4wMDctLjAxMS0uMDA1YS4xNDIuMTQyIDAgMCAxLS4wMTgtLjAwOGwtLjAxLS4wMDUtLjAxNC0uMDA2LS4wMTUtLjAwNi0uMDE1LS4wMDctLjAwNi0uMDAzLS4wMjItLjAxLS4wMTMtLjAwNi0uMDE1LS4wMDdhMzcuNDU4IDM3LjQ1OCAwIDAgMC0xLjUxNC0uNjV6bS0zLjc2LTEuMzExbC01LjYzOCAxOS4wOTJjLjMyOC4wOTcuNjU3LjIwMy45NzkuMzE1bDYuNTUzLTE4Ljc5OGMtLjQzOS0uMTUzLS44ODMtLjMtMS4zMjktLjQzOGwtLjAwMy0uMDAxLS4wMjctLjAwOGEuMDE5LjAxOSAwIDAgMS0uMDA3LS4wMDJsLS4wMjEtLjAwNi0uMDE0LS4wMDQtLjAxNy0uMDA1LS4wMjEtLjAwNi0uMDA3LS4wMDItLjAyNi0uMDA4aC0uMDAzYTIwLjI2NiAyMC4yNjYgMCAwIDAtLjQxOS0uMTI5em0tMy44NjUtLjk0MkwxMzAuNjM1IDIwLjNjLjMzNS4wNjQuNjc2LjEzOSAxLjAwNy4yMTlsNC43MDgtMTkuMzQ0LS4wMDQtLjAwMS0uMDE5LS4wMDQtLjAxNC0uMDAzLS4wMTctLjAwNC0uMDE3LS4wMDQtLjAxMy0uMDAzLS4wMTktLjAwNC0uMDEyLS4wMDMtLjAyMS0uMDA1LS4wMDktLjAwMi0uMDIzLS4wMDVhLjAxOS4wMTkgMCAwIDEtLjAwNy0uMDAybC0uMDI2LS4wMDZoLS4wMDJsLS4wMjktLjAwN2gtLjAwMWE2My40MTUgNjMuNDE1IDAgMCAwLS44MTYtLjE4NWgtLjAwMWwtLjA2Mi0uMDEzaC0uMDAzbC0uMDI4LS4wMDZoLS4wMDJsLS4wMjctLjAwNi0uMDA2LS4wMDEtLjAyNS0uMDA1LS4wMDYtLjAwMS0uMDIxLS4wMDQtLjAxMi0uMDAyLS4wMTYtLjAwMi0uMDE3LS4wMDMtLjAwOS0uMDAyYTE1LjEgMTUuMSAwIDAgMC0uNjYtLjE0em0tMy45NC0uNTY1bC0xLjg4MSAxOS44MmMuMzQzLjAzMi42OS4wNzMgMS4wMzEuMTIzTDEzMi40NDIuNDIzYTI4LjQ0MiAyOC40NDIgMCAwIDAtLjUyOC0uMDcybC0uMDEtLjAwMS0uMDIxLS4wMDMtLjAxNC0uMDAyLS4wMTYtLjAwMi0uMDItLjAwMi0uMDExLS4wMDFhMS4yMTUgMS4yMTUgMCAwIDEtLjAyMi0uMDAzaC0uMDA2YTEuNzcyIDEuNzcyIDAgMCAxLS4wMjUtLjAwM2gtLjAwNGMtLjMwNy0uMDQtLjYxNC0uMDc1LS45MjItLjEwNmgtLjAwM2wtLjAyLS4wMDItLjAxNC0uMDAxLS4wMTQtLjAwMWEuMTIzLjEyMyAwIDAgMS0uMDE5LS4wMDJsLS4wMTEtLjAwMS0uMDIzLS4wMDJoLS4wMDVjLS4wODgtLjAxNC0uMTgxLS4wMjMtLjI2OC0uMDMyek0xMjYuNDkyIDB2MTkuOTA4Yy4zNTEgMCAuNzAzLjAwOCAxLjA1Mi4wMjRMMTI4LjQ4LjA0NmE0NC4xNjIgNDQuMTYyIDAgMCAwLTEuMjA4LS4wNGgtLjc0NkMxMjYuNTEzIDAgMTI2LjUwMyAwIDEyNi40OTIgMHoiLz4KICAgIDxwYXRoIGZpbGw9IiMyNjI2MjYiIGQ9Ik0xMjYuNDkyIDEuOTkxYzIxLjc5IDAgMzkuNTE2IDE3LjcyOSAzOS41MTYgMzkuNTIxIDAgMjEuNzc5LTE3LjcyNiAzOS40OTgtMzkuNTE2IDM5LjQ5OC0yMS43ODEgMC0zOS41MDEtMTcuNzE5LTM5LjUwMS0zOS40OTggMC0yMS43OTIgMTcuNzItMzkuNTIxIDM5LjUwMS0zOS41MjFtMC0xLjk5MUMxMDMuNTc2IDAgODUgMTguNTc3IDg1IDQxLjUxMSA4NSA2NC40MjUgMTAzLjU3NiA4MyAxMjYuNDkyIDgzYzIyLjkyOSAwIDQxLjUwNy0xOC41NzUgNDEuNTA3LTQxLjQ4OUMxNjcuOTk5IDE4LjU3NyAxNDkuNDIgMCAxMjYuNDkyIDB6Ii8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMDYiIGZpbGw9IiNGRkYiIGQ9Ik0xNjIuMzQ3IDQxLjUxMWMwIDE5Ljc4NC0xNi4wNTIgMzUuODM3LTM1Ljg1NCAzNS44MzctMTkuNzg3IDAtMzUuODQtMTYuMDUzLTM1Ljg0LTM1LjgzNyAwLTE5LjgwNiAxNi4wNTMtMzUuODU5IDM1Ljg0LTM1Ljg1OSAxOS44MDIgMCAzNS44NTQgMTYuMDUzIDM1Ljg1NCAzNS44NTl6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMjEyMTIxIiBkPSJNMTI2LjQ5MiA2OS41MTFjLTE1LjQzNyAwLTI3Ljk5NC0xMi41NjEtMjcuOTk0LTI3Ljk5OSAwLTE1LjQzNSAxMi41NTgtMjcuOTkyIDI3Ljk5NC0yNy45OTIgMTUuNDM4IDAgMjcuOTk2IDEyLjU1NyAyNy45OTYgMjcuOTkyLjAwMSAxNS40MzktMTIuNTU3IDI3Ljk5OS0yNy45OTYgMjcuOTk5eiIvPgogICAgPHBhdGggZmlsbD0iIzFBMUExQSIgZD0iTTEyNi40OTIgMTYuNTA2YzEzLjc5MSAwIDI1LjAxMSAxMS4yMTcgMjUuMDExIDI1LjAwNSAwIDEzLjc5Mi0xMS4yMiAyNS4wMTItMjUuMDExIDI1LjAxMi0xMy43OSAwLTI1LjAwOC0xMS4yMi0yNS4wMDgtMjUuMDEyLjAwMS0xMy43ODggMTEuMjE4LTI1LjAwNSAyNS4wMDgtMjUuMDA1bTAtNS45NzNjLTE3LjExNSAwLTMwLjk4IDEzLjg2My0zMC45OCAzMC45NzggMCAxNy4xMTIgMTMuODY1IDMwLjk4NCAzMC45OCAzMC45ODQgMTcuMTE4IDAgMzAuOTgyLTEzLjg3MiAzMC45ODItMzAuOTg0LjAwMS0xNy4xMTUtMTMuODYzLTMwLjk3OC0zMC45ODItMzAuOTc4eiIvPgogICAgPHBhdGggZmlsbD0iI0U1RTVFNSIgZD0iTTgyLjk5OSA0MS41MTFDODIuOTk5IDY0LjQyNSA2NC40MjIgODMgNDEuNDkyIDgzIDE4LjU3NiA4MyAwIDY0LjQyNSAwIDQxLjUxMSAwIDE4LjU3NyAxOC41NzYgMCA0MS40OTIgMGMyMi45MyAwIDQxLjUwNyAxOC41NzcgNDEuNTA3IDQxLjUxMXoiLz4KICAgIDxwYXRoIGZpbGw9IiNCRkJGQkYiIGQ9Ik00MS40OTIgMGgtLjg1NGwtLjE0Ny4wMDNoLS4wMDRsLS4wMjcuMDAxaC0uMDM2bC0uMDI3LjAwMWgtLjAwM2wtLjAyNy4wMDFoLS4wMzVsLS4wMjguMDAxaC0uMDAybC0uMDYyLjAwMmEzNi40MiAzNi40MiAwIDAgMC0uNzQ0LjAyOWwuOTM5IDE5Ljg4NmMuMzUzLS4wMDguNzA3LS4wMTYgMS4wNTctLjAxNlYwem0tMy45NzcuMTg4YTkuNTUzIDkuNTUzIDAgMCAwLS4xOTYuMDJoLS4wMWwtLjAyLjAwMi0uMDE0LjAwMS0uMDE2LjAwMi0uMDIuMDAyaC0uMDA4bC0uMDI1LjAwM2gtLjAwMmMtLjU1OS4wNTgtMS4xMTMuMTI1LTEuNjY0LjIwNWwyLjgzMSAxOS43MDdjLjM0LS4wNDkuNjg2LS4wOTEgMS4wMy0uMTI0TDM3LjUxNS4xODh6bS0zLjkzOS41NjZsLS4wOS4wMThoLS4wMDJsLS4wMjYuMDA1LS4wMDYuMDAxLS4wMjMuMDA1LS4wMDguMDAxLS4wMjIuMDA0LS4wMDkuMDAyLS4wMjEuMDAzLS4wMTEuMDAyLS4wMTcuMDAzLS4wMTYuMDAzLS4wMTYuMDAzLS4wMTUuMDAzLS4wMTYuMDAzLS4wMTcuMDAzLS4wMTUuMDAzLS4wMTYuMDA0LS4wMTIuMDAyYS4wNjUuMDY1IDAgMCAwLS4wMjEuMDA0LjAzNi4wMzYgMCAwIDAtLjAxLjAwMmwtLjAyMi4wMDQtLjAwOS4wMDItLjAyMi4wMDQtLjAwOS4wMDItLjAyNi4wMDVoLS4wMDNsLS4wMy4wMDZoLS4wMDFjLS40ODEuMS0uOTU5LjIwNy0xLjQzNS4zMjNsNC43MTQgMTkuMzQxYy4zMzMtLjA4MS42Ny0uMTU0IDEuMDA2LS4yMkwzMy41NzYuNzU0em0tMy44NjYuOTQzYy0uMjY4LjA4LS41MzQuMTYtLjc5OS4yNDVoLS4wMDFsLS4wNjIuMDItLjA1Ni4wMTgtLjAwNS4wMDEtLjA1LjAxNmMtLjMxLjEtLjYxNy4yMDMtLjkyMy4zMTFsNi41NjIgMTguNzk2Yy4zMjItLjExMy42NS0uMjE5Ljk3OC0uMzE1TDI5LjcxIDEuNjk3em0tMy43NTcgMS4zMTFjLS42MTYuMjQ5LTEuMjI3LjUxNC0xLjgyOC43OWw4LjM0MyAxOC4wNzZjLjMxLS4xNDQuNjI4LS4yODEuOTQ1LS40MDlsLTcuNDYtMTguNDU3em0tMy42MTUgMS42NjljLS41ODkuMzA3LTEuMTcuNjI4LTEuNzQyLjk2MmwxMC4wNDEgMTcuMTljLjI5OC0uMTczLjYwMi0uMzQyLjkwNS0uNUwyMi4zMzggNC42Nzd6bS0zLjQzNSAyLjAwN2MtLjU1Ny4zNjItMS4xMDQuNzM3LTEuNjQzIDEuMTI1bDExLjY0MSAxNi4xNWMuMjc5LS4yMDIuNTY3LS4zOTguODU1LS41ODZMMTguOTAzIDYuNjg0em0tMy4yMjkgMi4zMjdjLS41Mi40MTQtMS4wMjkuODM5LTEuNTI4IDEuMjc3bDEzLjEyOCAxNC45NjVjLjI2MS0uMjI4LjUyOC0uNDUzLjc5OS0uNjY3TDE1LjY3NCA5LjAxMXptLTIuOTkzIDIuNjI0Yy0uMjg0LjI3My0uNTYzLjU1Mi0uODM5LjgzMmwtLjAwMi4wMDItLjAxOS4wMi0uMDAzLjAwNC0uMDE4LjAxOC0uMDA3LjAwOC0uMDE0LjAxMy0uMDExLjAxMS0uMDExLjAxMS0uMDE1LjAxNS0uMDA3LjAwNy0uMDE5LjAxOC0uMDA0LjAwM2MtLjE0NS4xNS0uMjkuMzAxLS40MzIuNDUzbDE0LjQ5MyAxMy42NDdjLjIzNy0uMjUyLjQ4My0uNTAxLjczMi0uNzRMMTIuNjgxIDExLjYzNXptLTIuNzI4IDIuODk5bC0uMDA4LjAwOGEuMDUzLjA1MyAwIDAgMC0uMDEyLjAxNGwtLjAwOC4wMS0uMDEyLjAxNC0uMDEuMDEyLS4wMTEuMDEyLS4wMDkuMDExLS4wMTEuMDE1LS4wMDguMDA5LS4wMTQuMDE1LS4wMDUuMDA2LS4wMTQuMDE3LS4wMDQuMDA1LS4wMTYuMDE5LS4wMDEuMDAyYy0uMzc1LjQ0Mi0uNzQuODkzLTEuMDk2IDEuMzUxbC0uMDIuMDI0IDE1LjcyOSAxMi4yMDRjLjIxMy0uMjc0LjQzMS0uNTQyLjY1Ni0uODA3TDkuOTUzIDE0LjUzNHptLTIuNDQgMy4xNDRsLS4xNTcuMjI2LS4wMDQuMDA1LS4wMS4wMTQtLjAwOS4wMTItLjAwNy4wMDljLS4zMTUuNDU3LS42MjIuOTItLjkxOCAxLjM5TDIzLjIzIDI5Ljk3OWMuMTg0LS4yOTEuMzc3LS41ODEuNTc2LS44NjNMNy41MTMgMTcuNjc4em0tMi4xMjggMy4zNjRjLS4xNTMuMjY5LS4zMDMuNTQtLjQ0OS44MTJsLS4wMDIuMDA0Yy0uMTY3LjMxMS0uMzMxLjYyMy0uNDkuOTM4bDE3Ljc2NiA4Ljk4MmMuMTU0LS4zMDYuMzE5LS42MTIuNDg5LS45MTFMNS4zODUgMjEuMDQyem0tMS43OTYgMy41NTFjLS4wNjcuMTUtLjEzNC4zMDMtLjE5OS40NTRsLS4wMDEuMDAxLS4wMjMuMDU3LS4wMjQuMDU2Yy0uMTc5LjQxOS0uMzUyLjg0Mi0uNTE4IDEuMjY3bDE4LjU0OCA3LjIzMWMuMTI0LS4zMTguMjU3LS42MzguMzk3LS45NTFsLTE4LjE4LTguMTE1em0tMS40NDUgMy43MDljLS4wOS4yNjctLjE3NS41MzEtLjI1OS44bC0uMDAzLjAwOS0uMDA3LjAyMS0uMDAzLjAxLS4wMDYuMDItLjAwNC4wMTItLjAwNi4wMTktLjAwNC4wMDktLjAwNi4wMjEtLjAwMy4wMS0uMDA1LjAyMS0uMDAyLjAwOC0uMDA2LjAyMS0uMDAzLjAxLS4wMDYuMDIxYS4wMTcuMDE3IDAgMCAwLS4wMDMuMDFsLS4wMDcuMDIxLS4wMDMuMDA5LS4wMDcuMDIxYS4wMTkuMDE5IDAgMCAxLS4wMDIuMDA4bC0uMDA2LjAyMi0uMDAzLjAwOS0uMDA2LjAyMS0uMDAyLjAwOC0uMDA3LjAyMi0uMDAyLjAwNi0uMDA4LjAyNS0uMDAxLjAwNGEuMjQxLjI0MSAwIDAgMS0uMDA4LjAyNWwtLjAwMS4wMDZhLjEzNS4xMzUgMCAwIDEtLjAwOC4wMjRsLS4wMDEuMDA0LS4wMDguMDI2LjAwMS4wMDUtLjAwOC4wMjctLjAwMS4wMDItLjAwOC4wMjh2LjAwMmMtLjA1NS4xODQtLjEwNy4zNjUtLjE2LjU1bDE5LjE1OSA1LjQwN2MuMDkzLS4zMjkuMTk1LS42NTkuMzA0LS45ODJMMi4xNDQgMjguMzAyem0tMS4wODEgMy44MzFhNDAuOTEzIDQwLjkxMyAwIDAgMC0uMzMzIDEuNTg1bC0uMDY3LjM2NSAxOS41OSAzLjUzNWMuMDYyLS4zMzYuMTMtLjY3Ny4yMDctMS4wMUwxLjA2MyAzMi4xMzN6bS0uNzA4IDMuOTE1Yy0uMDU2LjQyNS0uMTA0Ljg1MS0uMTQ3IDEuMjc5di4wMDZhLjE5NC4xOTQgMCAwIDAtLjAwMi4wMjRsLS4wMDEuMDEtLjAwMS4wMTgtLjAwMS4wMTctLjAwMS4wMTEtLjAwMi4wMjN2LjAwMmMtLjAyLjE5Ni0uMDM3LjM5Mi0uMDUzLjU4OWwxOS44NCAxLjY0NmMuMDI4LS4zNDUuMDY1LS42OTIuMTEtMS4wMzRMLjM1NSAzNi4wNDh6bS0uMzI5IDMuOTY4Yy0uMDExLjMxNy0uMDE5LjYzNi0uMDIyLjk1NXYuNjM0YzAgLjEzNC4wMDEuMjY5LjAwMy40MDJsMTkuOTA2LS4yMzMtLjAwNC0uMjYyYzAtLjI2NS4wMDQtLjUzLjAxMy0uNzkyTC4wMjYgNDAuMDE2em0xOS45MjEgMi44MDdMLjA3NCA0My45OTdjLjAzMi41NjUuMDc4IDEuMTMyLjEzNCAxLjY4OXYuMDA1YzAgLjAxMi4wMDEuMDIyLjAwMy4wMzRsLjAwMi4wMi4wMDEuMDE3LjAwMS4wMTIuMDAyLjAyMXYuMDA0bC4wMTkuMTgzIDE5Ljc5NC0yLjEyYTIyLjcwOSAyMi43MDkgMCAwIDEtLjA4My0xLjAzOXptLjIyIDIuMDY0TC40OTggNDcuOTUzbC4wMDUuMDM3LjAwMS4wMDguMDAzLjAyMS4wMDMuMDE4YS4wNS4wNSAwIDAgMCAuMDAyLjAxM2wuMDA0LjAyNHYuMDA2Yy4wODMuNTIyLjE3NiAxLjA0NC4yOCAxLjU2M2wuMDA0LjAyMS4wMDMuMDE1LjAwMi4wMTQuMDA0LjAyMS4wMDEuMDA3LjAwNS4wMjh2LjAwMWwuMDM0LjE2NiAxOS40OTktNC4wMWMtLjA2Ny0uMzQtLjEyNy0uNjc5LS4xODEtMS4wMTl6bS40MTUgMi4wMThMMS4yOTkgNTEuODUzYy4xNjUuNjQ2LjM0NiAxLjI4My41NCAxLjkxNmwxOS4wMjItNS44NzRhMjAuNzEzIDIwLjcxMyAwIDAgMS0uMjc5LS45OXptLjYwNyAxLjk2NEwyLjQ3MyA1NS42NTZjLjIyNy42MjYuNDY5IDEuMjQ0LjcyNSAxLjg1NGwxOC4zNjYtNy42ODNhMTguMjcgMTguMjcgMCAwIDEtLjM3NS0uOTU4em0uNzk0IDEuODk5TDQuMDA5IDU5LjMyN2wuMTA0LjIxNy4wMDQuMDEuMDA1LjAxLjAwOS4wMi4wMDEuMDAyYTM5Ljg4MSAzOS44ODEgMCAwIDAgLjU2NCAxLjExN2wuMDAzLjAwNy4wMS4wMTguMDA3LjAxNC4wMDcuMDEyLjAwOS4wMTguMDA0LjAwOS4xNzIuMzI1IDE3LjU0Mi05LjQxNWEyMS41ODkgMjEuNTg5IDAgMCAxLS40NjctLjkyM3ptLjk3NiAxLjgxOUw1Ljg5MSA2Mi44MzVjLjA5Ni4xNTkuMTkyLjMxNy4yOTIuNDc4di4wMDFsLjAxMy4wMjEuMDA0LjAwNi4wMDguMDEzLjAxMy4wMjFjLjIzOC4zODUuNDg0Ljc2Ny43MzUgMS4xNDNsMTYuNTYtMTEuMDU0YTIyLjM0IDIyLjM0IDAgMCAxLS41NTctLjg3N3ptMS4xNTIgMS43MjVMOC4xMDEgNjYuMTQ0bC4yMjMuMy4wMTkuMDIzLjAwMi4wMDIuMDE2LjAyMS4wMDMuMDA0YS4xNy4xNyAwIDAgMCAuMDIuMDI0bC4wMTUuMDIuMDA2LjAwOC4wMTMuMDE2LjAwNy4wMS4wMTEuMDE1LjAwOC4wMTEuMDEyLjAxNC4wMDcuMDEyLjAxLjAxNC4wMS4wMTRhLjAyOC4wMjggMCAwIDEgLjAwOS4wMWwuMDEyLjAxNS4wMDguMDExLjAxMi4wMTguMDA2LjAwOS4wMTQuMDE2LjAwNi4wMDguMDE1LjAyLjAwMy4wMDUuMDE2LjAyMS4wMDMuMDA0LjAxNy4wMjEtLjAwNC0uMDAzLjAxOS4wMjMuMDAxLjAwMWMuMjI5LjI5OC40NjQuNTkzLjcwMS44ODVsMTUuNDI2LTEyLjU4NGMtLjIxOC0uMjY3LS40My0uNTQyLS42MzYtLjgyem0xLjMxNCAxLjYxMkwxMC42MTcgNjkuMjI4Yy40NDMuNDkzLjg5OC45NzcgMS4zNjYgMS40NUwyNi4xNCA1Ni42ODFhMjIuMjA4IDIyLjIwOCAwIDAgMS0uNzE1LS43NTd6bTEuNDY0IDEuNDhMMTMuNDE0IDcyLjA1OWMuMjQ5LjIyOS41MDMuNDU3Ljc1Ny42OGwuMDAzLjAwMi4wMTcuMDE0LjAwOS4wMDkuMDEuMDA5LjAxNi4wMTIuMDA1LjAwNC4wMTkuMDE4LjAwMS4wMDFjLjIyLjE4OS40MzkuMzc4LjY2Mi41NjRsMTIuNzU5LTE1LjI4YTI1LjY2MyAyNS42NjMgMCAwIDEtLjc4My0uNjg4em0xLjU5NyAxLjMzM0wxNi40NjkgNzQuNjExYy41MjkuNCAxLjA2Ny43ODcgMS42MTYgMS4xNjNsMTEuMjQzLTE2LjQyOWEyMC45MDEgMjAuOTAxIDAgMCAxLS44NDItLjYwOHptMS43MTIgMS4xNzNMMTkuNzU0IDc2Ljg1OWwuMTA0LjA2Mi4wMDQuMDAzYS4wNzIuMDcyIDAgMCAwIC4wMTkuMDExbC4wMS4wMDguMDEzLjAwNy4wMTcuMDExLjAwNi4wMDNjLjQ5OC4zMDQgMS4wMDEuNTk2IDEuNTEyLjg3OGwuMDAzLjAwMi4wMi4wMWEuMDQuMDQgMCAwIDAgLjAxMS4wMDZsLjAwNC4wMDMgOS42MTctMTcuNDMxYTIzLjgzMiAyMy44MzIgMCAwIDEtLjg5Ni0uNTIyem0xLjgwOS45OThsLTguNzY4IDE3Ljg3My4zMzQuMTYzLjAwMi4wMDEuMDI0LjAxMi4wMDUuMDAyLjAyMS4wMWMuMDA0LjAwMi4wMDcuMDA0LjAxMS4wMDRsLjAxNy4wMDguMDE0LjAwNy4wMTQuMDA2YS4yNDUuMjQ1IDAgMCAwIC4wMTcuMDA4bC4wMS4wMDYuMDIuMDA4LjAwOS4wMDRhLjIxNS4yMTUgMCAwIDEgLjAyNi4wMTRsLjAyNS4wMTIuMDAxLjAwMmMuNDE2LjE5NS44MzUuMzg1IDEuMjYuNTY5bDcuODk2LTE4LjI3NGEyMi4xODMgMjIuMTgzIDAgMCAxLS45MzgtLjQzNXptMS44OS44MTdMMjYuODkyIDgwLjM2Yy42MjEuMjMzIDEuMjQ1LjQ1MSAxLjg4LjY1NWw2LjA5Ni0xOC45NTFjLS4zMjYtLjEwNi0uNjUtLjIxOC0uOTcxLS4zMzl6bTEuOTU3LjYzbC01LjE3MiAxOS4yMjQuMjM4LjA2M2guMDAxbC4wMjguMDA3LjAwNC4wMDEuMDI0LjAwN2EuMDMuMDMgMCAwIDEgLjAwOS4wMDJsLjAyMS4wMDQuMDE0LjAwNC4wMTUuMDA0LjAxOC4wMDQuMDM0LjAxLjAwNS4wMDFhNDAuOTc2IDQwLjk3NiAwIDAgMCAxLjUyMy4zNjJsNC4yMzktMTkuNDUzYy0uMzM1LS4wNy0uNjcxLS4xNTItMS4wMDEtLjI0em0yLjAxMi40MzdsLTMuMjk3IDE5LjYzNGMuNjU1LjExIDEuMzEyLjIwNCAxLjk3MS4yODJsMi4zNTEtMTkuNzY5Yy0uMzQxLS4wNC0uNjg3LS4wODktMS4wMjUtLjE0N3ptMi4wNi4yNDZsLTEuNDA0IDE5Ljg1OC40MDMuMDI2LjAxNS4wMDEuMDE2LjAwMS4wMjMuMDAxaC4wMDhsLjAyNS4wMDFoLjAwNmMuMzE3LjAyLjYzNi4wMzMuOTU2LjA0NWguMDA4bC4wMTguMDAxaC4wNmwuMDI3LjAwMWguMDAzbC40MjIuMDEyLjQ2Mi0xOS45MDJhMTcuNDUgMTcuNDUgMCAwIDEtMS4wNDgtLjA0NXptMy4xNDcgMGMtLjM0OC4wMjMtLjY5OC4wNDEtMS4wNDcuMDQ5bC40NzUgMTkuOTAyYy4yMDYtLjAwNC40MTItLjAxLjYxNy0uMDE5aC4wMDhsLjAyNS0uMDAxaC4wMDVsLjAzLS4wMDFoLjAwMWE1MC40MiA1MC40MiAwIDAgMCAxLjE3OC0uMDYzaC4wMDFsLjA2MS0uMDA0aC4wMDFsLjAzLS4wMDJoLjAwMmwuMDI4LS4wMDMtMS40MTUtMTkuODU4em0yLjA2Mi0uMjQ3Yy0uMzM4LjA1OC0uNjgzLjEwNy0xLjAyNS4xNDdsMi4zNjEgMTkuNzY5Yy42MS0uMDczIDEuMjE5LS4xNTkgMS44MjQtLjI1OWguMDAxbC4wMjktLjAwNmguMDA3bC4wMjQtLjAwNS4wMDktLjAwMWEuMDY1LjA2NSAwIDAgMCAuMDIxLS4wMDRsLjAxMi0uMDAxLjAyLS4wMDMuMDEyLS4wMDIuMDExLS4wMDItMy4zMDYtMTkuNjMzem0yLjAxNC0uNDRjLS4zMzIuMDktLjY2Ni4xNzEtMS4wMDEuMjQzbDQuMjQ5IDE5LjQ1MS4yMTktLjA0OWguMDAzbC4wMjctLjAwNi4wMDgtLjAwMi4wMjEtLjAwNS4wMTUtLjAwNC4wMTQtLjAwMy4wMjEtLjAwNS4wMDktLjAwMi4wMjMtLjAwNS4wMDctLjAwMi4wMjUtLjAwNmguMDAzbC4wMjgtLjAwNmguMDAyYy4yNTItLjA1OC41MDMtLjExOC43NTQtLjE4MmguMDAxbC4wMjYtLjAwNi4wMDUtLjAwMS4wMjUtLjAwNi4wMDUtLjAwMi4wMjMtLjAwNmguMDA4bC4wMjItLjAwNi4wMDctLjAwMi4wMjMtLjAwNi4wMDctLjAwMy4wMjQtLjAwNS4wMDYtLjAwMi4wMjMtLjAwNi4wMDYtLjAwMS4wMjQtLjAwNi4wMDYtLjAwMi4wMjUtLjAwNmguMDA0YS4xMTIuMTEyIDAgMCAwIC4wMjYtLjAwOGguMDAzYS4xNDcuMTQ3IDAgMCAwIC4wMjUtLjAwOGguMDA0bC4wMjgtLjAwN2guMDAxbC4zODktLjEwMy01LjE3My0xOS4yMjV6bTEuOTU4LS42MzJjLS4zMi4xMjEtLjY0Ni4yMzUtLjk3Mi4zMzlsNi4xMDQgMTguOTQ5Yy4zMDYtLjA5OC42MTEtLjIuOTE1LS4zMDZoLjAwMWEuNDk4LjQ5OCAwIDAgMSAuMDU0LS4wMmwuMDA3LS4wMDQuMDIxLS4wMDUuMDEzLS4wMDQuMDE1LS4wMDYuMDE3LS4wMDYuMDEyLS4wMDQuMDIxLS4wMDguMDA3LS4wMDIuMDI0LS4wMWguMDAzYy4yNTktLjA5Mi41MTQtLjE4Ni43Ny0uMjgxbC03LjAxMi0xOC42MzJ6bTEuODkxLS44MTZhMjQuMDQgMjQuMDQgMCAwIDEtLjkzNi40MzJsNy45MDEgMTguMjcyYy4zNS0uMTUxLjY5Ni0uMzA3IDEuMDM5LS40NjhoLjAwM2wuMDIyLS4wMTIuMDA3LS4wMDIuMDIxLS4wMS4wMDktLjAwNC4wMTgtLjAwOC4wMTItLjAwNi4wMTUtLjAwNmEuMTk2LjE5NiAwIDAgMCAuMDE0LS4wMDZsLjAxMS0uMDA2LjAyLS4wMDkuMDA1LS4wMDJjLjIwNS0uMDk2LjQwOS0uMTk1LjYxMi0uMjk1bC04Ljc3My0xNy44N3ptMS44MDktLjk5OWMtLjI5My4xODEtLjU5Mi4zNTQtLjg5NC41MjFsOS42MjMgMTcuNDI4LjE4LS4xLjAwNC0uMDAyLjAyMS0uMDEyLjAwNi0uMDA0LjAyLS4wMS4wMDktLjAwNi4wMTctLjAwOGEuMDU0LjA1NCAwIDAgMSAuMDEzLS4wMDdsLjAxMS0uMDA2LjAxOC0uMDEuMDA2LS4wMDQuMDIxLS4wMTIuMDA2LS4wMDRjLjQ2OS0uMjY0LjkzMS0uNTM3IDEuMzg5LS44MThsLTEwLjQ1LTE2Ljk0NnptMS43MTItMS4xNzVjLS4yNzQuMjA4LS41NTguNDE0LS44NDMuNjA3bDExLjI0OCAxNi40MjZjLjI1Mi0uMTcyLjUwMS0uMzQ4Ljc1LS41MjVsLjAwMS0uMDAyLjAyNC0uMDE3LjAwMi0uMDAxLjAyMS0uMDE2LjAwNi0uMDA0LjAyLS4wMTYuMDA2LS4wMDQuMDE5LS4wMTIuMDA5LS4wMDcuMDE1LS4wMTIuMDExLS4wMDguMDE0LS4wMDkuMDEyLS4wMTEuMDEyLS4wMDguMDE2LS4wMS4wMDktLjAwNy4wMTgtLjAxMy4wMDgtLjAwNi4wMjEtLjAxNC4wMDMtLjAwMi4wMjItLjAxOC4wMDMtLjAwMmMuMjAxLS4xNDYuNC0uMjk1LjU5Ny0uNDQ0TDU0LjUxOSA1OC43Mjl6bTEuNTk2LTEuMzMxYy0uMjU0LjIzMi0uNTE4LjQ2NC0uNzgzLjY4NWwxMi43NjQgMTUuMjc4LjAxMy0uMDEyLjAwNC0uMDAzLjAyLS4wMTcuMDA1LS4wMDQuMDE4LS4wMTYuMDA3LS4wMDYuMDE3LS4wMTQuMDA4LS4wMDguMDE2LS4wMTIuMDA4LS4wMDcuMDE2LS4wMTQuMDEtLjAwOC4wMTMtLjAxMi4wMTItLjAwOS4wMTItLjAxMWMuMDA1LS4wMDIuMDA5LS4wMDYuMDEzLS4wMWwuMDExLS4wMS4wMTQtLjAxMS4wMS0uMDA5LjAxNC0uMDEyLjAxMS0uMDA4LjAxNC0uMDEzLjAwNy0uMDA2LjAxOC0uMDE1LjAwNi0uMDA2LjAxOC0uMDE1LjAwNC0uMDA0LjAyMS0uMDE3LjAwNC0uMDA0LjAxOS0uMDE3LjAwMi0uMDAxLjAyMi0uMDE5LjAwMi0uMDAyYy4zMzEtLjI4NC42NTYtLjU3Mi45NzYtLjg2M2wuMDA1LS4wMDQuMDE5LS4wMTguMDA2LS4wMDYuMDE2LS4wMTQuMDExLS4wMS4wMTEtLjAxMWEuMTY2LjE2NiAwIDAgMSAuMDE0LS4wMTNsLjAwOC0uMDA4LjAxOS0uMDE2LjAwMy0uMDAyLjAyMi0uMDIxLjAwNy0uMDA4LTEzLjQ4Ny0xNC42Mzd6bTEuNDY0LTEuNDgxYy0uMjMyLjI1Ny0uNDcuNTEtLjcxMy43NTdsMTQuMTYxIDEzLjk5My4wMDUtLjAwNi4wMTctLjAxNi4wMDMtLjAwNGMuMzExLS4zMTYuNjE5LS42MzguOTIxLS45NjRsLjAwMi0uMDAyLjAxOS0uMDIuMDA2LS4wMDYuMDE1LS4wMTYuMDA5LS4wMTIuMDExLS4wMTEuMDE0LS4wMTUuMDA2LS4wMDguMDItLjAyMS4wMDEtLjAwMWMuMTA2LS4xMTYuMjE0LS4yMzQuMzE5LS4zNTJMNTcuNTc5IDU1LjkxN3ptMS4zMTQtMS42MTNjLS4yMDUuMjc2LS40MTkuNTU0LS42MzguODJsMTUuNDI5IDEyLjU4LjAwNi0uMDA3LjAxMi0uMDE2LjAwOC0uMDEuMDEyLS4wMTYuMDEtLjAxYS4wNzYuMDc2IDAgMCAxIC4wMTEtLjAxNGwuMDEtLjAxMy4wMDktLjAxMS4wMTQtLjAxNi4wMDYtLjAwOS4wMTUtLjAxOS4wMDQtLjAwNC4wMTctLjAyMS4wMDItLjAwM2MuMDA1LS4wMDguMDEyLS4wMTUuMDE4LS4wMjJoLjAwMWE0Ni4wMzQgNDYuMDM0IDAgMCAwIC42MzMtLjgwNmwuMDAxLS4wMDIuMDE2LS4wMi4wMDUtLjAwNi4wMTEtLjAxNi4wMDgtLjAxLjAwOC0uMDEyLjAxMi0uMDE1LjAwNS0uMDA3YS4wOTkuMDk5IDAgMCAwIC4wMTMtLjAybC4wMDItLjAwMmMuMTE5LS4xNTUuMjM3LS4zMTMuMzU0LS40NzJMNTguODkzIDU0LjMwNHptMS4xNTEtMS43MjVhMjAuODUgMjAuODUgMCAwIDEtLjU1NC44NzZsMTYuNTYgMTEuMDQ4LjEzOS0uMjEuMDEzLS4wMi4wMDMtLjAwNWMuMzA3LS40NjcuNjA0LS45MzkuODkzLTEuNDJsLjAwMS0uMDAyLjAxMy0uMDIxYS4wMTcuMDE3IDAgMCAwIC4wMDItLjAwNWwtMTcuMDctMTAuMjQxem0uOTc1LTEuODE5Yy0uMTQ2LjMwOS0uMzAzLjYxOC0uNDY1LjkybDE3LjU0MyA5LjQwOWMuMjM2LS40NDEuNDY0LS44ODcuNjg1LTEuMzM2di0uMDAxbC4wMTQtLjAyMy4wMDQtLjAxLjAwOS0uMDE4YS4wNjEuMDYxIDAgMCAxIC4wMDctLjAxNGwuMDA2LS4wMTIuMDExLS4wMjEuMDAzLS4wMDYuMTYtLjMzNi0xNy45NzctOC41NTJ6bS43OTUtMS44OTljLS4xMTcuMzItLjI0Mi42NDMtLjM3NC45NThsMTguMzY5IDcuNjc2Yy4wOTUtLjIyOC4xOS0uNDU3LjI4MS0uNjg4bC4wMDItLjAwNi4wMDktLjAyMWMuMDAxLS4wMDMuMDAyLS4wMDcuMDA0LS4wMDlsLjAwNy0uMDIuMDA2LS4wMTYuMDA1LS4wMTRhLjEwOS4xMDkgMCAwIDEgLjAxLS4wMjVsLjAwMS0uMDAyYy4xMzctLjM0OS4yNy0uNy4zOTgtMS4wNTRsLTE4LjcxOC02Ljc3OXptLjYwNS0xLjk2NWMtLjA4NC4zMzEtLjE3OS42NjQtLjI3OS45OWwxOS4wMjMgNS44NjguMTI1LS40MTQuMDAxLS4wMDQuMDA4LS4wMjQuMDAxLS4wMDUuMDA2LS4wMjNhLjAxOS4wMTkgMCAwIDAgLjAwMi0uMDA4bC4wMDctLjAyMS4wMDItLjAwOC4wMDgtLjAyMy4wMDItLjAwNi4wMDctLjAyNC4wMDEtLjAwNS4wMDctLjAyNC4wMDEtLjAwNS4wMDgtLjAyNi4wMDEtLjAwMmEuMTg3LjE4NyAwIDAgMSAuMDA4LS4wMjh2LS4wMDNsLjAwOS0uMDI3di0uMDAxbC4wMDctLjAyOHYtLjAwMmMuMTE1LS4zOTguMjI0LS43OTkuMzI4LTEuMjAxbC0xOS4yODMtNC45NDZ6bS40MTQtMi4wMTdjLS4wNTQuMzM5LS4xMTUuNjc5LS4xODQgMS4wMTVsMTkuNTAxIDQuMDAzYy4xMzItLjY0OS4yNTEtMS4zMDMuMzUzLTEuOTU4bC0xOS42Ny0zLjA2em0uMjIxLTIuMDY0Yy0uMDIxLjM0NS0uMDQ5LjY5My0uMDg1IDEuMDM2bDE5Ljc5NCAyLjExM2MuMDI1LS4yMzMuMDQ4LS40NjUuMDY5LS43di0uMDAybC4wMDItLjAyNnYtLjAwOGwuMDAyLS4wMjEuMDAxLS4wMTIuMDAxLS4wMTNjLjAzMy0uMzc4LjA2MS0uNzU3LjA4My0xLjEzOGwuMDAzLS4wNjMtMTkuODctMS4xNjZ6TTgyLjk3MiA0MGwtMTkuODk0LjcxYy4wMDkuMjY2LjAxMy41MzMuMDEzLjh2LjI1NWwxOS45MDYuMjI2LjAwMy0uMzg4di0uNTA0bC0uMDAxLS4wODl2LS4wNDFhMzAuNjkyIDMwLjY5MiAwIDAgMC0uMDA4LS40MzF2LS4wMDFsLS4wMDItLjA5MnYtLjA1M2wtLjAwMS0uMDI2LS4wMDEtLjAzM3YtLjAxM2wtLjAwMS0uMDM1di0uMDA2YTUuMjEgNS4yMSAwIDAgMS0uMDE0LS4yNzl6bS0uMzMyLTMuOTY2bC0xOS43MzcgMi41OTljLjA0Ni4zNDEuMDgzLjY4OC4xMTIgMS4wMzRsMTkuODM4LTEuNjU1YTE4LjMxOCAxOC4zMTggMCAwIDAtLjA0Mi0uNDY2YzAtLjAwMSAwIDAgMCAwbC0uMDAzLS4wMjh2LS4wMDhsLS4wMDItLjAyMi0uMDAxLS4wMTMtLjAwMi0uMDE4LS4wMDItLjAyMS0uMDAxLS4wMS0uMDAzLS4wM2MtLjA0NC0uNDU3LS4wOTYtLjkxLS4xNTctMS4zNjJ6bS0uNzA4LTMuOTE2bC0xOS4zOTUgNC40ODNjLjA3Ny4zMzMuMTQ2LjY3Mi4yMDggMS4wMWwxOS41ODktMy41NDNhNDMuODIgNDMuODIgMCAwIDAtLjE4My0uOTQ2di0uMDA0Yy0uMDAyLS4wMDctLjAwMy0uMDE1LS4wMDYtLjAyMmwtLjAwMi0uMDEtLjAwNC0uMDItLjAwMi0uMDEzLS4wMDMtLjAxNi0uMDAzLS4wMTYtLjAwMy0uMDE1LS4wMDQtLjAxOC0uMDAyLS4wMTItLjAwNC0uMDIxLS4wMDItLjAxLS4wMDQtLjAyMi0uMDAyLS4wMDctLjAwNS0uMDI0LS4wMDEtLjAwOC0uMDA1LS4wMjUtLjAwMS0uMDA0LS4wMDYtLjAyNi0uMDAxLS4wMDQtLjAwNi0uMDI4LS4wMDEtLjAwMi0uMDA2LS4wMjl2LS4wMDJsLS4wNjktLjMxMy0uMDAxLS4wMDQtLjAwNS0uMDI2YS4yMjEuMjIxIDAgMCAwLS4wMDUtLjAyNWwtLjAwMS0uMDAzYTEuMDU1IDEuMDU1IDAgMCAwLS4wMDYtLjAyNmwtLjAwMS0uMDA1LS4wNTgtLjI0NHptLTEuMDgyLTMuODMxbC0xOC44NzIgNi4zMzRjLjEwOS4zMjMuMjExLjY1My4zMDMuOTgybDE5LjE1Ny01LjQxNS0uMDAyLS4wMDdjMC0uMDA0LS4wMDItLjAwOS0uMDA0LS4wMTRhLjEyLjEyIDAgMCAwLS4wMDUtLjAxOGwtLjAwMy0uMDExLS4wMDYtLjAyMi0uMDAxLS4wMDYtLjAwOC0uMDI4YTQzLjkzIDQzLjkzIDAgMCAwLS40NDYtMS40NThsLS4wMDMtLjAwOS0uMDA0LS4wMTQtLjAwNS0uMDE4LS4wMDEtLjAwM2E5LjE2OCA5LjE2OCAwIDAgMS0uMS0uMjkzem0tMS40NDctMy43MDdsLTE4LjE3NCA4LjEyNWMuMTM5LjMxMy4yNzQuNjMyLjM5Ny45NTFsMTguNTQ1LTcuMjM4YTQxLjMzNSA0MS4zMzUgMCAwIDAtLjc2OC0xLjgzOHptLTEuNzk4LTMuNTUybC0xNy4zMDkgOS44MzNjLjE2OS4yOTguMzMzLjYwNC40ODguOTExbDE3Ljc2Mi04Ljk5MWE0MC4zNTIgNDAuMzUyIDAgMCAwLS44MTktMS41Mzd2LS4wMDFsLS4wMTUtLjAyNi0uMDAyLS4wMDFjLS4wMDQtLjAxLS4wMS0uMDE5LS4wMTYtLjAyOGwtLjAxMi0uMDIzLS4wMDMtLjAwNS0uMDEyLS4wMi0uMDA2LS4wMS0uMDEtLjAxNy0uMDA2LS4wMTItLjAwOC0uMDE0LS4wMDgtLjAxNS0uMDA4LS4wMTItLjAxMS0uMDItLjAwMy0uMDA2LS4wMDItLjAwNnptLTIuMTI4LTMuMzYxTDU5LjE4OCAyOS4xMTNjLjE5OC4yODIuMzkyLjU3Mi41NzYuODYzbDE2LjgxNy0xMC42NTMtLjEyOC0uMjAyLS4wMDctLjAxMS0uMDA1LS4wMDgtLjAxMi0uMDItLjAwMS0uMDAxYy0uMjE0LS4zMzItLjQzMi0uNjYtLjY1NC0uOTg1bC0uMDA2LS4wMDktLjAxMi0uMDE1LS4wMTEtLjAxNy0uMDA1LS4wMDZjLS4wODYtLjEzLS4xNzUtLjI1Ni0uMjYzLS4zODJ6bS0yLjQ0MS0zLjE0NEw1Ny45MTMgMjcuNDdjLjIyNi4yNjMuNDQ2LjUzMy42NTguODA3bDE1LjcyMi0xMi4yMTEtLjExNS0uMTQ3YS4zODUuMzg1IDAgMCAwLS4wMTktLjAyM2wtLjAwMi0uMDAzLS4wMTctLjAyMS0uMDA1LS4wMDctLjAxMy0uMDE3LS4wMDYtLjAwOS0uMDEyLS4wMTUtLjAxLS4wMTItLjAwNy0uMDEyYS4wNjkuMDY5IDAgMCAwLS4wMTEtLjAxM2wtLjAwOC0uMDExLS4wMTMtLjAxNi0uMDA2LS4wMDgtLjAxNC0uMDE3LS4wMDUtLjAwN2EuMDkuMDkgMCAwIDEtLjAxNS0uMDE5bC0uMDA0LS4wMDUtLjAxNi0uMDItLjAwMy0uMDA0LS4wMTgtLjAyMS0uMDAyLS4wMDItLjAyLS4wMjQtLjAxNy0uMDIxLS4wMDQtLjAwM2EuMjExLjIxMSAwIDAgMC0uMDE5LS4wMjNsLS4wMTctLjAyMi0uMDAyLS4wMDItLjAxOC0uMDIyLS4wMDMtLjAwM2EuMzEzLjMxMyAwIDAgMC0uMDE3LS4wMjFsLS4wMDMtLjAwNC0uMDE3LS4wMmEuMDA4LjAwOCAwIDAgMC0uMDA0LS4wMDRsLS4wMTYtLjAyLS4wMDMtLjAwNC0uMDE2LS4wMTktLjAwNC0uMDA2LS4wMTUtLjAxOC0uMDA1LS4wMDctLjAxNS0uMDE3LS4wMDYtLjAwOC0uMDEzLS4wMTctLjAwNy0uMDA4LS4wMTQtLjAxNi0uMDA3LS4wMDktLjAxMi0uMDE1LS4wMDctLjAxLS4wMDUtLjAxNC0uMDA5LS4wMTEtLjAxMS0uMDEyLS4wMDktLjAxMi0uMDEtLjAxMi0uMDExLS4wMTMtLjAwOS0uMDExYS4wNzYuMDc2IDAgMCAxLS4wMTEtLjAxNGwtLjAwOC0uMDEtLjAxMi0uMDE1LS4wMDctLjAwOC0uMDE0LS4wMTctLjAwNS0uMDA2LS4wMTYtLjAxOWEuMDIyLjAyMiAwIDAgMS0uMDA0LS4wMDVsLS4wMTYtLjAyLS4wMDMtLjAwMy0uMDE4LS4wMjEtLjAwNC0uMDA0LS4wMTYtLjAyLS4wMDMtLjAwNC0uMDE3LS4wMi0uMDAzLS4wMDNhLjMxMy4zMTMgMCAwIDAtLjAxNy0uMDIxbC0uMDAzLS4wMDMtLjAxOC0uMDIxLS4wMDMtLjAwNGEuMzEzLjMxMyAwIDAgMC0uMDE3LS4wMjFsLS4wMDMtLjAwMy0uMDE3LS4wMi0uMDA0LS4wMDQtLjAxNi0uMDItLjAwMy0uMDA0LS4wMS0uMDE5LS4wMDUtLjAwNS0uMDE1LS4wMTgtLjAwNS0uMDA2LS4wMTUtLjAxOC0uMDA2LS4wMDctLjAxNS0uMDE2LS4wMDYtLjAwNy0uMDEzLS4wMTctLjAwNy0uMDA4LS4wMTQtLjAxNS0uMDA4LS4wMS0uMDExLS4wMTMtLjAxLS4wMTItLjAxLS4wMTEtLjAxMi0uMDE0LS4wMDgtLjAwOS0uMDE2LS4wMThhLjAyMi4wMjIgMCAwIDEtLjAwNC0uMDA1bC0uMDE2LS4wMi0uMDAzLS4wMDNhNC40NzggNC40NzggMCAwIDEtLjEyNC0uMTQ1em0tMi43MzEtMi44OTdsLTEzLjgyIDE0LjMyOWMuMjQ5LjIzOS40OTYuNDg4LjczMS43NGwxNC40ODktMTMuNjU0LS4wMDItLjAwMmE0My4zMTUgNDMuMzE1IDAgMCAwLTEuMzk4LTEuNDEzem0tMi45OTMtMi42MjRMNTQuOTIgMjQuNTgzYy4yNy4yMTUuNTQuNDM5Ljc5OC42NjdsMTMuMTIzLTE0Ljk3Mi0uMjMzLS4yMDMtLjAwOC0uMDA0LS4wMTctLjAxNC0uMDE0LS4wMTItLjAwOC0uMDA3YTQyLjg1NyA0Mi44NTcgMCAwIDAtMS4yNDktMS4wMzZ6bS0zLjIzLTIuMzI1TDUzLjIzNSAyMy4zNzFjLjI4OS4xODcuNTc3LjM4NC44NTYuNTg1TDY1LjcyNCA3LjgwMWMtLjE1LS4xMDgtLjMwMi0uMjE2LS40NTQtLjMyMmwtLjAwMy0uMDAxYS4xNTMuMTUzIDAgMCAxLS4wMTYtLjAxMWwtLjAxMS0uMDA3YS4wMy4wMyAwIDAgMC0uMDA3LS4wMDVsLS4wMi0uMDEzaC0uMDAxYTI2LjQ1MyAyNi40NTMgMCAwIDAtLjUxOC0uMzU4bC0uMDItLjAxMy0uMDExLS4wMDgtLjAxMy0uMDA5LS4wMi0uMDEzLS4wMDctLjAwNGMtLjE3Ni0uMTItLjM1OS0uMjQxLS41NDEtLjM2ek02MC42NDQgNC42N2wtOS4xOTcgMTcuNjU3Yy4zMDUuMTU4LjYwOS4zMjYuOTA1LjVMNjIuMzg3IDUuNjMzYTYwLjM2IDYwLjM2IDAgMCAwLS40MzEtLjI0OGwtLjA1NC0uMDMtLjA1NC0uMDI5YTQxLjExMyA0MS4xMTMgMCAwIDAtMS4yMDQtLjY1NnpNNTcuMDMgMy4wMDVsLTcuNDU0IDE4LjQ1OWMuMzE3LjEyOC42MzUuMjY2Ljk0Ni40MDlsOC4zMzUtMTguMDgtLjAxMy0uMDA2LS4wMTQtLjAwNi0uMDE0LS4wMDZhLjA3Ny4wNzcgMCAwIDEtLjAxNi0uMDA3bC0uMDE0LS4wMDYtLjAxNS0uMDA3LS4wMTEtLjAwNC0uMDE1LS4wMDYtLjAxNi0uMDA3Yy0uMDAyLS4wMDQtLjAwNy0uMDA1LS4wMTEtLjAwN2wtLjAxNC0uMDA2LS4wMTYtLjAwNy0uMDEtLjAwNWEuMTQyLjE0MiAwIDAgMS0uMDE4LS4wMDhsLS4wMTUtLjAwNi0uMDE1LS4wMDYtLjAxNC0uMDA2LS4wMTItLjAwNy0uMDA2LS4wMDMtLjAyMi0uMDEtLjAxMi0uMDA2LS4wMTYtLjAwN2EzOS43NjkgMzkuNzY5IDAgMCAwLTEuNTE4LS42NDl6bS0zLjc1OC0xLjMxMWwtNS42MzggMTkuMDkyYy4zMjguMDk3LjY1Ny4yMDMuOTc5LjMxNWw2LjU1NC0xOC43OThjLS40NC0uMTUzLS44ODUtLjMtMS4zMy0uNDM4bC0uMDAzLS4wMDEtLjAyNy0uMDA4YS4wMTkuMDE5IDAgMCAxLS4wMDctLjAwMmwtLjAyMi0uMDA2LS4wMTMtLjAwNGEuMDg0LjA4NCAwIDAgMS0uMDE3LS4wMDVsLS4wMjEtLjAwNi0uMDA3LS4wMDItLjAyNy0uMDA4aC0uMDAzYTIwLjE3NyAyMC4xNzcgMCAwIDAtLjQxOC0uMTI5ek00OS40MDYuNzUyTDQ1LjYzNSAyMC4zYy4zMzUuMDY0LjY3NC4xMzkgMS4wMDYuMjE5bDQuNzA4LTE5LjM0NC0uMDA0LS4wMDEtLjAyLS4wMDQtLjAxMi0uMDAzLS4wMTctLjAwNC0uMDE1LS4wMDMtLjAxMy0uMDAzLS4wMi0uMDA0LS4wMS0uMDAzLS4wMi0uMDA1LS4wMS0uMDAyLS4wMjItLjAwNS0uMDA3LS4wMDItLjAyNy0uMDA2aC0uMDAybC0uMDMtLjAwN2gtLjAwMWE0NS43MjcgNDUuNzI3IDAgMCAwLS44MTUtLjE4N2gtLjAwMUw1MC4yNC45MjJoLS4wMDNsLS4wMjktLjAwNmgtLjAwMkw1MC4xOC45MTEgNTAuMTc0LjkxbC0uMDI1LS4wMDUtLjAwNi0uMDAxTDUwLjEyMi45IDUwLjExLjg5OGwtLjAxNi0uMDAzLS4wMTctLjAwMy0uMDA4LS4wMDJjLS4yMTktLjA1LS40NDItLjA5NS0uNjYzLS4xMzh6bS0zLjk0LS41NjVsLTEuODgxIDE5LjgyYy4zNDMuMDMyLjY5LjA3MyAxLjAzMS4xMjNMNDcuNDQzLjQyM2EyOC41NTMgMjguNTUzIDAgMCAwLS41LS4wNjhsLS4wMjktLjAwNC0uMDA5LS4wMDEtLjAyMi0uMDAzLS4wMTQtLjAwMi0uMDE3LS4wMDItLjAxOS0uMDAzLS4wMTEtLjAwMUExLjIxNSAxLjIxNSAwIDAgMSA0Ni44LjMzNmgtLjAwN2wtLjAyNi0uMDAzaC0uMDA0Yy0uMzA2LS4wNC0uNjEzLS4wNzUtLjkyMS0uMTA2aC0uMDAzbC0uMDItLjAwMi0uMDE0LS4wMDEtLjAxNC0uMDAxLS4wMi0uMDAyLS4wMS0uMDAxLS4wMjEtLjAwMmgtLjAwNmMtLjA4OS0uMDEzLS4xOC0uMDIyLS4yNjgtLjAzMXpNNDEuNDkyIDB2MTkuOTA4Yy4zNTEgMCAuNzA0LjAwOCAxLjA1Mi4wMjRMNDMuNDguMDQ3YTQ0LjE2MiA0NC4xNjIgMCAwIDAtMS4yMDgtLjA0aC0uNzQ2QzQxLjUxNCAwIDQxLjUwMyAwIDQxLjQ5MiAweiIvPgogICAgPHBhdGggZmlsbD0iI0Q5RDlEOSIgZD0iTTQxLjQ5MiAxLjk5MWMyMS43OTEgMCAzOS41MTcgMTcuNzI5IDM5LjUxNyAzOS41MjEgMCAyMS43NzktMTcuNzI2IDM5LjQ5OC0zOS41MTcgMzkuNDk4LTIxLjc4MSAwLTM5LjUwMS0xNy43MTktMzkuNTAxLTM5LjQ5OCAwLTIxLjc5MiAxNy43Mi0zOS41MjEgMzkuNTAxLTM5LjUyMW0wLTEuOTkxQzE4LjU3NiAwIDAgMTguNTc3IDAgNDEuNTExIDAgNjQuNDI1IDE4LjU3NiA4MyA0MS40OTIgODNjMjIuOTMgMCA0MS41MDctMTguNTc1IDQxLjUwNy00MS40ODlDODIuOTk5IDE4LjU3NyA2NC40MjIgMCA0MS40OTIgMHoiLz4KICAgIDxwYXRoIG9wYWNpdHk9Ii4wNiIgZD0iTTc3LjM0OCA0MS41MTFjMCAxOS43ODQtMTYuMDUxIDM1LjgzNy0zNS44NTUgMzUuODM3LTE5Ljc4NyAwLTM1LjgzOS0xNi4wNTMtMzUuODM5LTM1LjgzNyAwLTE5LjgwNiAxNi4wNTItMzUuODU5IDM1LjgzOS0zNS44NTkgMTkuODAzIDAgMzUuODU1IDE2LjA1MyAzNS44NTUgMzUuODU5eiIvPgogICAgPHBhdGggZmlsbD0iI0RFREVERSIgZD0iTTQxLjQ5MiA2OS41MTFjLTE1LjQzNiAwLTI3Ljk5NC0xMi41NjEtMjcuOTk0LTI3Ljk5OSAwLTE1LjQzNSAxMi41NTgtMjcuOTkyIDI3Ljk5NC0yNy45OTIgMTUuNDM4IDAgMjcuOTk3IDEyLjU1NyAyNy45OTcgMjcuOTkyLjAwMSAxNS40MzktMTIuNTU5IDI3Ljk5OS0yNy45OTcgMjcuOTk5eiIvPgogICAgPHBhdGggZmlsbD0iI0U1RTVFNSIgZD0iTTQxLjQ5MiAxNi41MDZjMTMuNzkyIDAgMjUuMDExIDExLjIxNyAyNS4wMTEgMjUuMDA1IDAgMTMuNzkyLTExLjIxOSAyNS4wMTItMjUuMDExIDI1LjAxMi0xMy43OSAwLTI1LjAwOC0xMS4yMi0yNS4wMDgtMjUuMDEyIDAtMTMuNzg4IDExLjIxOS0yNS4wMDUgMjUuMDA4LTI1LjAwNW0wLTUuOTczYy0xNy4xMTUgMC0zMC45OCAxMy44NjMtMzAuOTggMzAuOTc4IDAgMTcuMTEyIDEzLjg2NSAzMC45ODQgMzAuOTggMzAuOTg0IDE3LjExOSAwIDMwLjk4My0xMy44NzIgMzAuOTgzLTMwLjk4NC4wMDEtMTcuMTE1LTEzLjg2NC0zMC45NzgtMzAuOTgzLTMwLjk3OHoiLz4KPC9zdmc+Cg==);background-position:-85px 0;height:83px;width:83px}[data-kind=\"xboxone\"] .stick[data-pressed=\"true\"]{background-position:0 0}[data-kind=\"xboxone\"] .stick.left{top:0;left:0}[data-kind=\"xboxone\"] .stick.right{top:113px;left:288px}[data-kind=\"xboxone\"] .dpad{position:absolute;width:110px;height:111px;top:345px;left:223px}[data-kind=\"xboxone\"] .face{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI3MC42NiIgaGVpZ2h0PSIxMjguMDM2IiB2aWV3Qm94PSIwIDAgNzAuNjYgMTI4LjAzNiI+CiAgICA8cGF0aCBmaWxsPSIjRUJFQkVCIiBkPSJNNDAuMDY0IDQyLjA2OVY3LjQyNGMwLS4wNDMuMDA2LS4wOTQuMDEyLS4xNDRsLjA2MS0uMjI5Yy4wMjktLjA0Mi4wNjQtLjEwOC4wOC0uMTM1LjQ5Mi0uODE5IDIuMDg2LTEuNTM2IDQuNDkyLTIuMDE3LjMwMy0uMDY4LjU4OC0uMTI3Ljg4MS0uMTg0LjMxNC0uMDYzLjYyOS0uMTA4Ljk0OS0uMTM3LjAzNS0uMDAzLjEyNy0uMDE2LjE2LS4wMjYuMjU0LS4wMy41NzItLjA3My44OTgtLjExM2E0MS40NzMgNDEuNDczIDAgMCAxIDIuMDIxLS4xOTRsMi4zNDYtLjA3OGMuMzUtLjAwOC42OTMtLjAxMiAxLjAzNy0uMDEyIDcuMjU0IDAgMTIuOTM4IDEuNDM2IDEyLjkzOCAzLjI2OXYzNC42NDVMNTMuMDAxIDU1LjI4NCA0MC4wNjQgNDIuMDY5eiIvPgogICAgPHBhdGggZmlsbD0iI0VERjRGNCIgZD0iTTUzLjAwMSA0LjY2MWM4LjAxIDAgMTIuNDQxIDEuNjMzIDEyLjQ0MSAyLjc2M1Y0MS44Nkw1My4wMDEgNTQuNTY4IDQwLjU1OCA0MS44NTlWNy40MjdjMC0uMDIxLjAwNC0uMDQzLjAwNC0uMDQzbC4wMDItLjAxMS4wMDItLjAwM2MuMDEyLS4wMzUuMDI3LS4wOTUuMDM3LS4xMzZsLjAzNy0uMDU2Yy4xNS0uMjUzLjg5Ni0xLjEyOCA0LjE0Ni0xLjc4MS4yOTMtLjA2OC41ODgtLjEzLjg4NS0uMTg2bC4wOC0uMDE0YTguMjQgOC4yNCAwIDAgMSAuNzg3LS4xMTUgMS4yOSAxLjI5IDAgMCAwIC4xODYtLjAyYy4zMDUtLjA0My42MDUtLjA4My45MS0uMTIxbC4wMjMtLjAwM2EzNy4xMTcgMzcuMTE3IDAgMCAxIDEuOTg4LS4xOWwuMTE1LS4wMDZjLjE4OS0uMDA4LjM3OS0uMDEzLjU2OC0uMDE3bC4zOTMtLjAxYy4zNzktLjAxOC43NTYtLjAzMiAxLjEzNS0uMDQybC4xMjUtLjAwMWMuMzM5LS4wMDYuNjc5LS4wMTEgMS4wMi0uMDExbTAtMS4wMTJhNDUuMzMgNDUuMzMgMCAwIDAtMi4zMTYuMDU2Yy0uMzIyLjAxLS42NDguMDE0LS45NjcuMDI4bC0uMTM2LjAwN2MtLjMzMi4wMjMtLjY2Mi4wNTEtLjk4Ni4wODItLjAxNC4wMDEtLjAyNy4wMDMtLjA0MS4wMDMtLjM0NC4wMzQtLjY4NC4wNzEtMS4wMTguMTEyaC0uMDAyYy0uMzQ2LjA0Mi0uNjkxLjA4OC0xLjAzNy4xMzdhOC44MTYgOC44MTYgMCAwIDAtLjkyOC4xMzFsLS4wNzQuMDEyYy0uMjk3LjA1OC0uNTkyLjExOC0uODczLjE4NGwtLjAxMi4wMDJjLTIuNDA0LjQ4MS00LjIwOSAxLjIzLTQuODE4IDIuMjVhLjU5LjU5IDAgMCAwLS4xMDUuMTY3bC0uMDA4LjAxNy0uMDQ1LjE4NS0uMDE2LjA0MmExLjE1NyAxLjE1NyAwIDAgMC0uMDMzLjE0NCAxLjU5MSAxLjU5MSAwIDAgMC0uMDIuMjE4VjQyLjI4TDUzIDU2bDEzLjQzMi0xMy43MjFWNy40MjRjLjAwMS0yLjUzMy02LjcyOS0zLjc3NS0xMy40MzEtMy43NzV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjREJEQkRCIiBkPSJNNDQuNjEzIDQuNDAxbC4wMTItLjAwMmMuMjgzLS4wNjQuNTc2LS4xMjUuODczLS4xODNsLjA3NC0uMDEyYy4zMjYtLjA2NC42NTQtLjExLjk4Ni0uMTM5LjMzLS4wNDYuNjUyLS4wODkuOTc5LS4xMjloLjAwMmMuMzM0LS4wNDIuNjc0LS4wNzggMS4wMTgtLjExMi4wMTQgMCAuMDI3LS4wMDIuMDQxLS4wMDMuMzc1LS4wMzUuNzQ4LS4wNjQgMS4xMjMtLjA4OS4zMTgtLjAxNC42NDMtLjAxOC45NjctLjAyOC4zODMtLjAxOC43NjYtLjAzMSAxLjE1LS4wNDJsLjEyMi0uMDAyYy4zNDYtLjAwOC42OTUtLjAxMiAxLjA0My0uMDEyIDYuNzAxIDAgMTMuNDMyIDEuMjQyIDEzLjQzMiAzLjc3NWwyLjcyOS0yLjgwN2MtLjg5My0xLjM4NC0yLjY4OS0yLjc0MS02LjA4Ni0zLjU2OEM2MC4zNjEuMzY2IDU2Ljc4MSAwIDUzLjAwMSAwYy0zLjgxMSAwLTcuMzg5LjM2Ni0xMC4wODQgMS4wNDktMi45MTIuNzI2LTQuNjY4IDEuODE4LTUuNjcgM2wyLjU0NSAyLjYwMmMuNjEyLTEuMDE5IDIuNDE2LTEuNzY5IDQuODIxLTIuMjV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRTNFM0UzIiBkPSJNNjYuNDMzIDcuNDI0djM0Ljg1NEw3MCAzOC42MDhWNy40MjRjMC0uODYzLS4yMjEtMS44NTgtLjgzOC0yLjgwOGwtMi43MjkgMi44MDh6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRDZENkQ2IiBkPSJNMzkuNTY4IDcuNDI0Yy4wMDItLjEyMy4wMi0uMjQ0LjA1My0uMzYybC4wMTYtLjA0Mi4wNDUtLjE4Ni4wMS0uMDE3YS42LjYgMCAwIDEgLjEwNC0uMTY3TDM3LjI1IDQuMDQ5QzM2LjI4OSA1LjE4NCAzNiA2LjM3MSAzNiA3LjQyNFYzOC42MWwzLjU2OCAzLjY3VjcuNDI0eiIvPgogICAgPHBhdGggZmlsbD0iI0VCRUJFQiIgZD0iTTE3LjAwMSA1MS44NDFjLTcuMDYzIDAtMTIuNjItMS4zMzktMTIuOTI0LTMuMTE2YS45My45MyAwIDAgMS0uMDE0LS4xNVYxMy45MzhMMTcuMDAxLjcxNiAyOS45NCAxMy45Mzh2MzQuNjM3YS44NzQuODc0IDAgMCAxLS4wMTUuMTU0Yy0uMzAyIDEuNzcyLTUuODYgMy4xMTItMTIuOTI0IDMuMTEyeiIvPgogICAgPHBhdGggZmlsbD0iI0VERjRGNCIgZD0iTTE3LjAwMSAxLjQzMmwxMi40NDMgMTIuNzE2djM0LjQyN2MwIC4wMjEtLjAwNC4wNDctLjAwNi4wNjQtLjE5MyAxLjEzMS00LjYyMyAyLjY5Ny0xMi40MzggMi42OTctNy44MTMgMC0xMi4yNDItMS41NjYtMTIuNDM2LTIuNjg4LS4wMDMtLjAyOC0uMDA3LS4wNTUtLjAwNy0uMDcxVjE0LjE0OEwxNy4wMDEgMS40MzJtMC0xLjQzMkwzLjU2NyAxMy43Mjl2MzQuODQ3YzAgLjA3MS4wMDcuMTU0LjAyMS4yMzcuNDA0IDIuMzU3IDYuOTA5IDMuNTM0IDEzLjQxMiAzLjUzNCA2LjUwNSAwIDEzLjAwOS0xLjE3NiAxMy40MTItMy41MzQuMDE0LS4wODMuMDIxLS4xNjcuMDIxLS4yMzdWMTMuNzI5TDE3LjAwMSAweiIvPgogICAgPHBhdGggZmlsbD0iI0YwRjBGMCIgZD0iTTMwLjQzNSA0OC41NzVsMi43MjggMi44MDRBNS4xNDYgNS4xNDYgMCAwIDAgMzQgNDguNTc1VjE3LjM5NGwtMy41NjUtMy42NjV2MzQuODQ2eiIvPgogICAgPHBhdGggZmlsbD0iI0U4RThFOCIgZD0iTTMwLjQxNCA0OC44MTNjLS40MDMgMi4zNTgtNi45MDggMy41MzQtMTMuNDEyIDMuNTM0UzMuOTk0IDUxLjE3IDMuNTg5IDQ4LjgxM2ExLjQ0IDEuNDQgMCAwIDEtLjAyMS0uMjM3TC44MSA1MS4zODFjLjkyIDEuMzg0IDIuNzE3IDIuNzM1IDYuMTA5IDMuNTY1QzkuNjE0IDU1LjYyNyAxMy4xOTEgNTYgMTcuMDAxIDU2YzMuNzgxIDAgNy4zNjEtLjM3MyAxMC4wNzctMS4wNTQgMy4zOTctLjgzIDUuMTkzLTIuMTg0IDYuMDg0LTMuNTY3bC0yLjcyOC0yLjgwNGMwIC4wOC0uMDA3LjE1OS0uMDIuMjM4eiIvPgogICAgPHBhdGggZmlsbD0iI0UzRTNFMyIgZD0iTTMuNTY4IDQ4LjU3NVYxMy43MjhMMCAxNy4zOTR2MzIuMDM5bC4wOTIuMjM5Yy4xMjcuNTUxLjM0MiAxLjEzMy43MTcgMS43MDlsMi43NTktMi44MDZ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRUJFQkVCIiBkPSJNMTMuOTM5IDg2LjkyMkwuNzE3IDczLjk5NyAxMy45NCA2MS4wODFoMzQuNjNjMS44MzEgMCAzLjI2NSA1LjY3NSAzLjI2NSAxMi45MjFzLTEuNDM0IDEyLjkyMi0zLjI2NSAxMi45MjJIMTMuOTR2LS4wMDJ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRURGNEY0IiBkPSJNNDguNTcgNjEuNTc2YzEuMTUxIDAgMi43NTkgNC43MjggMi43NTkgMTIuNDI1IDAgNy43MDEtMS42MDcgMTIuNDI4LTIuNzU5IDEyLjQyOEgxNC4xNDlMMS40MzIgNzMuOTk3bDEyLjcxNy0xMi40MjFINDguNTdtMC0uOTlIMTMuNzNMMCA3My45OTdsMTMuNzMgMTMuNDIyaDM0Ljg0YzUuMDI4LS4wMDEgNS4wMjgtMjYuODMzIDAtMjYuODMzeiIvPgogICAgPHBhdGggZmlsbD0iI0U2RTZFNiIgZD0iTTQ4LjU3IDYwLjU4NmwyLjc4OC0yLjc0OUE1LjExNSA1LjExNSAwIDAgMCA0OC41NyA1N0gxNy4zNzVsLTMuNjQ1IDMuNTg3IDM0Ljg0LS4wMDF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRThFOEU4IiBkPSJNNDguNTcgODcuNDE4SDEzLjczTDE3LjM3NCA5MWgzMi43MDlsLjM0NS0uMzQyYy4zMTEtLjEyNy42MjQtLjMwMS45MzYtLjQ5NGwtMi43OTQtMi43NDZ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRjBGMEYwIiBkPSJNNTEuMzU4IDU3LjgzN2wtMi43ODggMi43NDljNS4wMjggMCA1LjAyOCAyNi44MzIgMCAyNi44MzJsMi43OTQgMi43NDZjMS4zODUtLjkyIDIuNzM4LTIuNzE3IDMuNTkxLTYuMDgyLjY3MS0yLjcxNiAxLjA0NS02LjI5IDEuMDQ1LTEwLjA4NSAwLTMuNzkxLS4zNzMtNy4zNjUtMS4wNDUtMTAuMDgyLS44NTUtMy4zNjYtMi4yMDctNS4xNTgtMy41OTctNi4wNzh6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRUJFQkVCIiBkPSJNNy40MyAxMjIuOTI0Yy0xLjg0MiAwLTMuMjg3LTUuNjc3LTMuMjg3LTEyLjkyMyAwLTcuMjQ0IDEuNDQ1LTEyLjkxOSAzLjI4Ny0xMi45MTloMzQuNjMxbDEzLjIyNCAxMi45MTUtMTMuMjI0IDEyLjkyN0g3LjQzeiIvPgogICAgPHBhdGggZmlsbD0iI0VERjRGNCIgZD0iTTQxLjg1MiA5Ny41NzhsMTIuNzE3IDEyLjQyLTEyLjcxNyAxMi40MzJINy40M2MtMS4xNjEgMC0yLjc3OS00LjcyOC0yLjc3OS0xMi40MjZzMS42MTktMTIuNDI4IDIuNzgtMTIuNDI4aDM0LjQyMW0uNDE4LS45ODlINy40M2MtNS4wNTYgMC01LjA1NiAyNi44MzIgMCAyNi44MzJoMzQuODRMNTYgMTA5Ljk5OCA0Mi4yNyA5Ni41ODd6Ii8+CiAgICA8cGF0aCBmaWxsPSIjREJEQkRCIiBkPSJNNDIuMjcgOTYuNTg3TDM4LjYyNSA5M0g3LjQzMWMtLjg3NCAwLTEuODQ0LjIyMy0yLjgxOC44MzdsMi44MTggMi43NDggMzQuODM5LjAwMnoiLz4KICAgIDxwYXRoIGZpbGw9IiNENkQ2RDYiIGQ9Ik03LjQzIDk2LjU4N2wtMi44MTctMi43NWMtMS4zODQuOTIyLTIuNzEyIDIuNzEyLTMuNTY4IDYuMDgxQy4zNzMgMTAyLjYzMyAwIDEwNi4yMDggMCAxMDkuOTk4YzAgMy43OTQuMzczIDcuMzcgMS4wNDUgMTAuMDg3Ljg1NSAzLjM2NyAyLjE4NCA1LjE1NyAzLjU2OCA2LjA3OWwyLjgxNy0yLjc0NGMtNS4wNTYtLjAwMS01LjA1Ni0yNi44MzMgMC0yNi44MzN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRTVFNUU1IiBkPSJNNy40MyAxMjMuNDE5bC0yLjgxNyAyLjc0NGMuOTcyLjYxMyAxLjk0My44MzcgMi44MTcuODM3aDMxLjE5NWwzLjY0Ni0zLjU4MUg3LjQzeiIvPgo8L3N2Zz4K);position:absolute;opacity:0}[data-kind=\"xboxone\"] .face[data-pressed=\"true\"]{opacity:1}[data-kind=\"xboxone\"] .face.up{background-position:35px 0;left:38px;top:1px;width:34px;height:56px}[data-kind=\"xboxone\"] .face.down{background-position:0 0;left:38px;bottom:0;width:34px;height:56px}[data-kind=\"xboxone\"] .face.left{background-position:0 -93px;width:56px;height:34px;top:39px;left:0}[data-kind=\"xboxone\"] .face.right{background-position:0 -57px;width:56px;height:34px;top:39px;right:0}[data-kind=\"ds4\"] .padinner{width:806px;height:598px;background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iODA2IiBoZWlnaHQ9IjU5OC45IiB2aWV3Qm94PSIwIDAgODA2IDU5OC45Ij4KICAgIDxwYXR0ZXJuIHg9Ijk3LjUiIHk9IjY5NS45NSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjEwMyIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgaWQ9ImEiIHZpZXdCb3g9IjAgLTIzMS44IDQwIDEwMyIgb3ZlcmZsb3c9InZpc2libGUiPgogICAgICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wLTEyOC44aDQwdi0xMDNIMHoiLz4KICAgICAgICA8cGF0aCBmaWxsPSJub25lIiBkPSJNMC0yMzEuOGg0MHYxMDNIMHoiLz4KICAgICAgICA8cGF0aCBmaWxsPSJub25lIiBkPSJNMC0yMzEuOGg0MHYxMDNIMHoiLz4KICAgICAgICA8cGF0aCBkPSJNMzQuNSAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zeiIvPgogICAgICAgIDxwYXRoIGQ9Ik0zNC41LTEwM2gzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3oiLz4KICAgICAgICA8cGF0aCBkPSJNMzQuNS0yMDZoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6Ii8+CiAgICA8L3BhdHRlcm4+CiAgICA8cGF0dGVybiB4PSI5Ny41IiB5PSI2OTUuOTUiIHdpZHRoPSI0MCIgaGVpZ2h0PSIxMDMiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJjIiB2aWV3Qm94PSIwIC0yMzEuOCA0MCAxMDMiIG92ZXJmbG93PSJ2aXNpYmxlIj4KICAgICAgICA8cGF0aCBmaWxsPSJub25lIiBkPSJNMC0xMjguOGg0MHYtMTAzSDB6Ii8+CiAgICAgICAgPHBhdGggZmlsbD0ibm9uZSIgZD0iTTAtMjMxLjhoNDB2MTAzSDB6Ii8+CiAgICAgICAgPHBhdGggZmlsbD0ibm9uZSIgZD0iTTAtMjMxLjhoNDB2MTAzSDB6Ii8+CiAgICAgICAgPHBhdGggZD0iTTM0LjUgMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3ptLTggMGgzdi0xNTQuNWgtM3oiLz4KICAgICAgICA8cGF0aCBkPSJNMzQuNS0xMDNoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6bS04IDBoM3YtMTU0LjVoLTN6Ii8+CiAgICAgICAgPHBhdGggZD0iTTM0LjUtMjA2aDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zem0tOCAwaDN2LTE1NC41aC0zeiIvPgogICAgPC9wYXR0ZXJuPgogICAgPHBhdHRlcm4geD0iOTcuNSIgeT0iNjk1Ljk1IiB3aWR0aD0iNzEiIGhlaWdodD0iNzEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJlIiB2aWV3Qm94PSIwIC03MSA3MSA3MSIgb3ZlcmZsb3c9InZpc2libGUiPgogICAgICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wIDBoNzF2LTcxSDB6Ii8+CiAgICAgICAgPHBhdGggZmlsbD0ibm9uZSIgZD0iTTAtNzFoNzFWMEgweiIvPgogICAgICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wLTcxaDcxVjBIMHoiLz4KICAgICAgICA8cGF0aCBmaWxsPSIjQjNCM0IzIiBkPSJNNDEuOC0zNS41YzAgMy41LTIuOCA2LjMtNi4zIDYuM3MtNi4zLTIuOC02LjMtNi4zIDIuOC02LjMgNi4zLTYuMyA2LjMgMi44IDYuMyA2LjN6Ii8+CiAgICA8L3BhdHRlcm4+CiAgICA8cGF0aCBmaWxsPSIjRjhGOEY4IiBkPSJNODAxLjI1IDQxOC41NjdjLTIuODk5LTE1LjUtMTcuNy0xMDIuNS0zMi0xNDQuNi05LjM5OS0yNy43MDEtMTMuMS01My0xNy02NC45LTEyLTM1LjctMzMtNjUuNy0zMy02NS43cy05LjUtMTMuMS0xMC4xLTE2LjNjLS42MDEtMy4zLTQuNy04LjYtNC43LTguNnMtMTcuNC01LjctNjIuMy01LjctNTMuNyA1LTUzLjcgNS0yLjQgMi45LTUuOSA0LjhjLTMuNSAxLjgtMTEuNjk5IDEuNy0xMS42OTkgMS43aC0zMy40cy0uNi0uMS0uOS4zYy0uMzk5LjQtLjYgMi0uNiAyaC0yNjYuMXMtLjMwMS0xLjctLjYwMS0yYy0uMzk5LS40LS44OTktLjMtLjg5OS0uM2gtMzMuNHMtOC4yLjItMTEuNy0xLjdjLTMuNS0xLjgtNS44OTktNC44LTUuODk5LTQuOHMtOC44LTUtNTMuNy01Yy00NC44IDAtNjIuMyA1LjctNjIuMyA1LjdzLTQuMSA1LjMtNC43IDguNmMtLjYgMy4zLTEwLjEgMTYuMy0xMC4xIDE2LjNzLTIxIDMwLTMzIDY1LjdjLTQgMTEuOS03LjcgMzcuMTk5LTE3IDY0LjktMTQuMyA0Mi4xLTI5LjEgMTI5LjEtMzIgMTQ0LjYtNC4zIDIzLjItNC42IDkwLjItNC42IDkwLjJzNC41IDUzLjM5OSAzNi4yIDc0Ljg5OWMzMS43IDIxLjUgNTYuNyAxNCA1Ni43IDE0czMzLjEtOC4yIDU3LjgtNDEuODk5YzI0LjctMzMuNyA1Ni42LTEyOS4yIDU2LjYtMTI5LjJzMi4yLTMgNS43LTUuM2MzLjUtMi4zMDEgNi4zLTIuNjAxIDYuMy0yLjYwMWwxODMuNy4xMDEgMTgzLjctLjEwMXMyLjguMyA2LjMgMi42MDFjMy41IDIuMyA1LjcgNS4zIDUuNyA1LjNzMzEuODk5IDk1LjM5OSA1Ni42IDEyOS4yYzI0LjcgMzMuOCA1Ny44IDQxLjg5OSA1Ny44IDQxLjg5OXMyNSA3LjUgNTYuNy0xNCAzNi4yLTc0Ljg5OSAzNi4yLTc0Ljg5OS0uMzAyLTY2Ljk5OS00LjcwMi05MC4yeiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTM2LjU1IDI3NS45NjhjOS40LTI3LjcwMSAxMy4xLTUzIDE3LTY0LjkgMTItMzUuNyAzMy02NS43IDMzLTY1LjdzOS41LTEzLjEgMTAuMS0xNi4zYy42LTMuMyA0LjctOC42IDQuNy04LjZzMTcuNC01LjcgNjIuMy01LjdjNDQuOCAwIDUzLjcgNSA1My43IDVzMi4zOTkgMi45IDUuODk5IDQuOGMzLjUgMS44IDExLjcgMS43IDExLjcgMS43aDMzLjRzLjYtLjEuODk5LjNjLjQuNC42MDEgMiAuNjAxIDJoMjY2LjJzLjMwMS0xLjcuNjAxLTJjLjM5OS0uNC44OTktLjMuODk5LS4zaDMzLjRzOC4yLjIgMTEuNy0xLjdjMy41LTEuOCA1Ljg5OS00LjggNS44OTktNC44czguODAxLTUgNTMuNy01YzQ0LjkgMCA2Mi4zIDUuNyA2Mi4zIDUuN3M0LjEwMSA1LjMgNC43IDguNmMuNjAxIDMuMyAxMC4xMDEgMTYuMyAxMC4xMDEgMTYuM3MyMSAzMCAzMyA2NS43YzQgMTEuOSA3LjY5OSAzNy4xOTkgMTcgNjQuOSAxNC4zIDQyLjEgMjkuMSAxMjkuMSAzMiAxNDQuNiAzLjg5OSAyMC44OTkgNC42IDc3LjMgNC42OTkgODguM3YtLjFzLS4zLTY2LjktNC42OTktOTAuMTAxYy0yLjktMTUuNS0xNy43LTEwMi41LTMyLTE0NC42LTkuNC0yNy43LTEzLjEwMS01My0xNy02NC45LTEyLTM1LjctMzMtNjUuNy0zMy02NS43cy05LjUtMTMuMS0xMC4xMDEtMTYuM2MtLjYtMy4zLTQuNy04LjYtNC43LTguNnMtMTcuMzk5LTUuNy02Mi4zLTUuN2MtNDQuODk5IDAtNTMuNyA1LTUzLjcgNXMtMi4zOTkgMi45LTUuODk5IDQuOGMtMy41IDEuOC0xMS43IDEuNy0xMS43IDEuN2gtMzMuNHMtLjYtLjEtLjg5OS4zYy0uNC40LS42MDEgMi0uNjAxIDJoLTI2Ni4ycy0uMzAxLTEuNy0uNjAxLTJjLS4zOTktLjQtLjg5OS0uMy0uODk5LS4zaC0zMy40cy04LjIuMi0xMS43LTEuN2MtMy41LTEuOC01Ljg5OS00LjgtNS44OTktNC44cy04LjgtNS01My43LTVjLTQ0LjggMC02Mi4zIDUuNy02Mi4zIDUuN3MtNC4xIDUuMy00LjcgOC42Yy0uNiAzLjMtMTAuMSAxNi4zLTEwLjEgMTYuM3MtMjEgMzAtMzMgNjUuN2MtNCAxMS45LTcuNyAzNy4yLTE3IDY0LjktMTQuMyA0Mi4xLTI5LjEgMTI5LjEtMzIgMTQ0LjYtNC4zIDIzLjEwMS00LjYgOTAuMTAxLTQuNiA5MC4xMDF2LjFjLjEtMTAuOS43LTY3LjQgNC43LTg4LjMgMi45LTE1LjQwMSAxNy42LTEwMi41MDEgMzEuOS0xNDQuNnoiIG9wYWNpdHk9Ii4wNiIvPgogICAgPHBhdGggZmlsbD0iI0Y1RjVGNSIgZD0iTTM1MS4xNSAzNTkuOTY3YzAtNDIuMTk5LTM0LjMtNzYuNDk5LTc2LjUtNzYuNDk5cy03Ni41IDM0LjMtNzYuNSA3Ni40OTljMCAuNyAwIDEuMzAxLjEgMiAwIC43LS4xIDEuMzAxLS4xIDIgMCA0Mi4yIDM0LjMgNzYuNSA3Ni41IDc2LjVzNzYuNS0zNC4zIDc2LjUtNzYuNWMwLS42OTkgMC0xLjMtLjEwMS0yIC4wMDEtLjY5OS4xMDEtMS40LjEwMS0yeiIvPgogICAgPGNpcmNsZSBmaWxsPSIjRjVGNUY1IiBjeD0iMjc0LjY1IiBjeT0iMzU1Ljk2NyIgcj0iNzMiLz4KICAgIDxjaXJjbGUgY3g9IjI3NC42NSIgY3k9IjM1NS45NjciIHI9IjUxLjUiLz4KICAgIDxwYXRoIGZpbGw9IiNGNUY1RjUiIGQ9Ik02MDcuNzUgMzU5Ljk2N2MwLTQyLjE5OS0zNC4zLTc2LjQ5OS03Ni41LTc2LjQ5OXMtNzYuNSAzNC4zLTc2LjUgNzYuNDk5YzAgLjcgMCAxLjMwMS4xMDEgMiAwIC43LS4xMDEgMS4zMDEtLjEwMSAyIDAgNDIuMiAzNC4zIDc2LjUgNzYuNSA3Ni41czc2LjUtMzQuMyA3Ni41LTc2LjVjMC0uNjk5IDAtMS4zLS4xLTIgLjEtLjY5OS4xLTEuNC4xLTJ6Ii8+CiAgICA8Y2lyY2xlIGZpbGw9IiNGNUY1RjUiIGN4PSI1MzEuMjUiIGN5PSIzNTUuOTY3IiByPSI3MyIvPgogICAgPGNpcmNsZSBjeD0iNTMxLjI1IiBjeT0iMzU1Ljk2NyIgcj0iNTEuNSIvPgogICAgPHBhdGggZmlsbD0iIzEyMTIxMiIgZD0iTTUzNC43NSAxMjcuOTY3Yy0uMzk5LTMuMi0zLjMtNS42LTYuNS01LjZoLTI1MC42Yy0zLjIgMC02LjEwMSAyLjMtNi41IDUuNi0uMTAxLjctLjEwMSAxLjQtLjEwMSAyLjF2MTI3LjRjMCA4Ljg5OSA3LjIgMTYuMSAxNi4xMDEgMTYuMWgyMzEuNmM4LjkgMCAxNi4xMDEtNy4yIDE2LjEwMS0xNi4xdi0xMjcuNGMuMDk5LS43IDAtMS40LS4xMDEtMi4xeiIvPgogICAgPGNpcmNsZSBmaWxsPSIjRURFREVEIiBjeD0iNjUyLjI1IiBjeT0iMjQ0Ljc2NyIgcj0iOTQuMyIvPgogICAgPGNpcmNsZSBmaWxsPSIjRURFREVEIiBjeD0iMTUzLjY1IiBjeT0iMjQ0Ljc2NyIgcj0iOTQuMyIvPgogICAgPHBhdGggZmlsbD0iI0NDQyIgZD0iTTIzMC4zNTEgMjU0LjA2N2w5LjUtOC45Yy41LS41LjUtMS4xOTkgMC0xLjY5OWwtOS41LTguOWMtLjctLjctMS45LS4yLTEuOS44djE3Ljc5OWMtLjEgMSAxLjA5OSAxLjUgMS45Ljl6bS04NS40MDEtODQuM2gxNy44YzEgMCAxLjUtMS4yLjgtMS45bC04LjktOS41Yy0uNS0uNS0xLjItLjUtMS43IDBsLTguOSA5LjVjLS42LjctLjEgMS45LjkgMS45em0tNjcuNSA2NC44bC05LjUgOC45Yy0uNS41LS41IDEuMTk5IDAgMS42OTlsOS41IDguOWMuNy42OTkgMS45LjE5OSAxLjktLjgwMXYtMTcuNzk4YzAtMS4xLTEuMi0xLjYtMS45LS45em04NS4zIDg0LjIwMWgtMTcuOGMtMSAwLTEuNSAxLjE5OS0uOCAxLjg5OWw4LjkgOS41Yy41LjUgMS4yLjUgMS43IDBsOC45LTkuNWMuNi0uNy4xLTEuODk5LS45LTEuODk5eiIvPgogICAgPHBhdGggb3BhY2l0eT0iLjEiIGZpbGw9IiNFNkU2RTYiIGQ9Ik0xMDUuMTUgNTQ0LjQ2N2MtNDAuNS0yLjgtNzUuOC0yMC4zLTg3LjMtMzAuNS0xMS41LTEwLjMtMTcuNS0zMS42LTE3LjUtMzEuNi0uNCAxNS0uNCAyNi4zLS40IDI2LjNzNC41IDUzLjQgMzYuMiA3NC45YzMxLjcgMjEuNSA1Ni43IDE0IDU2LjcgMTRzMzMuMS04LjIgNTcuOC00MS45YzQuNS02LjIgOS4zLTE0LjUgMTQuMS0yMy44LS4xIDAtMTkuMiAxNS4zLTU5LjYgMTIuNnoiLz4KICAgIDxwYXR0ZXJuIGlkPSJiIiB4bGluazpocmVmPSIjYSIgcGF0dGVyblRyYW5zZm9ybT0icm90YXRlKDE2LjAwNSAtMTU1NTguODU3IC01NjkwNC4xNikgc2NhbGUoLjM0MzEpIi8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMDgiIGZpbGw9InVybCgjYikiIGQ9Ik0xMDUuMTUgNTQ0LjQ2N2MtNDAuNS0yLjgtNzUuOC0yMC4zLTg3LjMtMzAuNS0xMS41LTEwLjMtMTcuNS0zMS42LTE3LjUtMzEuNi0uNCAxNS0uNCAyNi4zLS40IDI2LjNzNC41IDUzLjQgMzYuMiA3NC45YzMxLjcgMjEuNSA1Ni43IDE0IDU2LjcgMTRzMzMuMS04LjIgNTcuOC00MS45YzQuNS02LjIgOS4zLTE0LjUgMTQuMS0yMy44LS4xIDAtMTkuMiAxNS4zLTU5LjYgMTIuNnoiLz4KICAgIDxwYXRoIG9wYWNpdHk9Ii4yMiIgZD0iTTg5Ljk1IDU5Mi40NjdjLTEyLjUgMS44MDEtMzEuMy0yLTQ1LjEtNy42OTktMTMuNi01LjctMjQtMTYuNC0yNC0xNi40IDQuMiA1LjggOS4zIDExLjEgMTUuMyAxNS4yIDMxLjcgMjEuNSA1Ni43IDE0IDU2LjcgMTRzMTEuNy0yLjkgMjYuMy0xMi4zYzAgMC0xNC42IDUuMTk5LTI5LjIgNy4xOTl6Ii8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMSIgZmlsbD0iI0U2RTZFNiIgZD0iTTcwMC43NSA1NDQuNDY3YzQwLjUtMi44IDc1LjgtMjAuMyA4Ny4zLTMwLjUgMTEuNS0xMC4xOTkgMTcuNS0zMS41IDE3LjUtMzEuNS40IDE1IC40IDI2LjMwMS40IDI2LjMwMXMtNC41IDUzLjM5OS0zNi4yIDc0Ljg5OS01Ni43IDE0LTU2LjcgMTQtMzMuMS04LjItNTcuOC00MS44OTljLTQuNS02LjItOS4zLTE0LjUtMTQuMS0yMy44MDEuMS0uMSAxOS4yMDEgMTUuMiA1OS42IDEyLjV6Ii8+CiAgICA8cGF0dGVybiBpZD0iZCIgeGxpbms6aHJlZj0iI2MiIHBhdHRlcm5UcmFuc2Zvcm09Im1hdHJpeCgtLjMyOTggLjA5NDYgLjA5NDYgLjMyOTggLTMwODM3LjgyIDIxMDQuNzUyKSIvPgogICAgPHBhdGggb3BhY2l0eT0iLjA4IiBmaWxsPSJ1cmwoI2QpIiBkPSJNNzAwLjc1IDU0NC40NjdjNDAuNS0yLjggNzUuOC0yMC4zIDg3LjMtMzAuNSAxMS41LTEwLjE5OSAxNy41LTMxLjUgMTcuNS0zMS41LjQgMTUgLjQgMjYuMzAxLjQgMjYuMzAxcy00LjUgNTMuMzk5LTM2LjIgNzQuODk5LTU2LjcgMTQtNTYuNyAxNC0zMy4xLTguMi01Ny44LTQxLjg5OWMtNC41LTYuMi05LjMtMTQuNS0xNC4xLTIzLjgwMS4xLS4xIDE5LjIwMSAxNS4yIDU5LjYgMTIuNXoiLz4KICAgIDxwYXRoIG9wYWNpdHk9Ii4yMiIgZD0iTTcxNS45NSA1OTIuNDY3YzEyLjUgMS44MDEgMzEuMy0yIDQ1LjEtNy42OTkgMTMuNjAxLTUuNyAyNC0xNi40IDI0LTE2LjQtNC4xOTkgNS44LTkuMyAxMS4xLTE1LjMgMTUuMi0zMS43IDIxLjUtNTYuNyAxNC01Ni43IDE0cy0xMS42OTktMi45LTI2LjMtMTIuM2MwIDAgMTQuNjAxIDUuMTk5IDI5LjIgNy4xOTl6Ii8+CiAgICA8cGF0aCBkPSJNMjQwLjQ1IDE0My40NjdjNi45IDAgMTIuNSA1LjYgMTIuNSAxMi41djE4LjNjMCA2LjktNS42IDEyLjUtMTIuNSAxMi41cy0xMi41LTUuNi0xMi41LTEyLjV2LTE4LjNjMC02LjkgNS42LTEyLjUgMTIuNS0xMi41bTAtMS43Yy03LjggMC0xNC4yIDYuNC0xNC4yIDE0LjJ2MTguM2MwIDcuOCA2LjQgMTQuMiAxNC4yIDE0LjJzMTQuMi02LjQgMTQuMi0xNC4ydi0xOC4zYzAtNy45LTYuNC0xNC4yLTE0LjItMTQuMnoiLz4KICAgIDxwYXRoIGZpbGw9IiMxMDExMUEiIGQ9Ik0yNDAuNDUgMTQzLjQ2N2MtNi45IDAtMTIuNSA1LjYtMTIuNSAxMi41djE4LjNjMCA2LjkgNS42IDEyLjUgMTIuNSAxMi41czEyLjUtNS42IDEyLjUtMTIuNXYtMTguM2MwLTYuOS01LjU5OS0xMi41LTEyLjUtMTIuNXoiLz4KICAgIDxwYXRoIGQ9Ik01NjUuNDUgMTQzLjQ2N2M2LjkgMCAxMi41IDUuNiAxMi41IDEyLjV2MTguM2MwIDYuOS01LjYgMTIuNS0xMi41IDEyLjVzLTEyLjUtNS42LTEyLjUtMTIuNXYtMTguM2MwLTYuOSA1LjYtMTIuNSAxMi41LTEyLjVtMC0xLjdjLTcuOCAwLTE0LjIgNi40LTE0LjIgMTQuMnYxOC4zYzAgNy44IDYuNCAxNC4yIDE0LjIgMTQuMnMxNC4yLTYuNCAxNC4yLTE0LjJ2LTE4LjNjMC03LjktNi40LTE0LjItMTQuMi0xNC4yeiIvPgogICAgPHBhdGggZmlsbD0iIzEwMTExQSIgZD0iTTU2NS40NSAxNDMuNDY3Yy02LjkgMC0xMi41IDUuNi0xMi41IDEyLjV2MTguM2MwIDYuOSA1LjYgMTIuNSAxMi41IDEyLjVzMTIuNS01LjYgMTIuNS0xMi41di0xOC4zYzAtNi45LTUuNTk5LTEyLjUtMTIuNS0xMi41eiIvPgogICAgPGNpcmNsZSBjeD0iNDAyLjk1IiBjeT0iMzE2LjM2NyIgcj0iNC4xIi8+CiAgICA8Y2lyY2xlIGN4PSI0MDIuOTUiIGN5PSIyOTUuNDY3IiByPSI0LjEiLz4KICAgIDxjaXJjbGUgY3g9IjM5Ni4wNSIgY3k9IjMwNS42NjciIHI9IjQuMSIvPgogICAgPGNpcmNsZSBjeD0iMzgxLjM1MSIgY3k9IjMwNS42NjciIHI9IjQuMSIvPgogICAgPGNpcmNsZSBjeD0iMzg4LjY1IiBjeT0iMzE2LjM2NyIgcj0iNC4xIi8+CiAgICA8Y2lyY2xlIGN4PSIzODguNjUiIGN5PSIyOTUuNDY3IiByPSI0LjEiLz4KICAgIDxjaXJjbGUgY3g9IjM3NC4zNTEiIGN5PSIyOTUuNDY3IiByPSI0LjEiLz4KICAgIDxjaXJjbGUgY3g9IjQwOS44NTEiIGN5PSIzMDUuNjY3IiByPSI0LjEiLz4KICAgIDxjaXJjbGUgY3g9IjQyNC41NSIgY3k9IjMwNS42NjciIHI9IjQuMSIvPgogICAgPGNpcmNsZSBjeD0iNDE3LjE1IiBjeT0iMzE2LjM2NyIgcj0iNC4xIi8+CiAgICA8Y2lyY2xlIGN4PSI0MTcuMTUiIGN5PSIyOTUuNDY3IiByPSI0LjEiLz4KICAgIDxjaXJjbGUgY3g9IjQzMS41NSIgY3k9IjI5NS40NjciIHI9IjQuMSIvPgogICAgPHBhdGggZD0iTTQwMi45NSAzMTkuNDY3Yy0yLjEgMC0zLjgtMS42LTQuMS0zLjYgMCAuMi0uMTAxLjMtLjEwMS41IDAgMi4zIDEuOCA0LjEgNC4xMDEgNC4xIDIuMyAwIDQuMS0xLjggNC4xLTQuMSAwLS4yIDAtLjMtLjEtLjUtLjEgMi0xLjggMy42LTMuOSAzLjZ6bTAtMTkuOWMyLjMgMCA0LjEtMS44MDEgNC4xLTQuMSAwLS4yMDEgMC0uMzAxLS4xLS41LS4yIDItMiAzLjYtNC4xIDMuNi0yLjEwMSAwLTMuODAxLTEuNi00LjEwMS0zLjYgMCAuMTk5LS4xLjI5OS0uMS41LjIwMiAyLjIgMi4wMDEgNC4xIDQuMzAxIDQuMXptLTIuOCA2LjFjMC0uMiAwLS4zLS4xMDEtLjUtLjE5OSAyLTIgMy42MDEtNC4xIDMuNjAxcy0zLjgtMS42MDEtNC4xLTMuNjAxYzAgLjItLjEwMS4zLS4xMDEuNSAwIDIuMyAxLjggNC4xMDEgNC4xMDEgNC4xMDEgMi40MDEgMCA0LjMwMS0xLjgwMSA0LjMwMS00LjEwMXptLTE0Ljc5OS0uNWMtLjIgMi0yIDMuNjAxLTQuMTAxIDMuNjAxLTIuMSAwLTMuOC0xLjYwMS00LjEtMy42MDEgMCAuMi0uMTAxLjMtLjEwMS41IDAgMi4zIDEuODAxIDQuMTAxIDQuMTAxIDQuMTAxczQuMS0xLjgwMSA0LjEtNC4xMDFjLjItLjIuMi0uMy4xMDEtLjV6bTMuMzk5IDE0LjNjLTIuMSAwLTMuOC0xLjYtNC4xLTMuNiAwIC4yLS4xMDEuMy0uMTAxLjUgMCAyLjMgMS44MDEgNC4xIDQuMTAxIDQuMXM0LjEtMS44IDQuMS00LjFjMC0uMiAwLS4zLS4xLS41LS4xIDItMS43OTkgMy42LTMuOSAzLjZ6bTAtMTkuOWMyLjMgMCA0LjEwMS0xLjgwMSA0LjEwMS00LjEgMC0uMjAxIDAtLjMwMS0uMTAxLS41LS4yIDItMiAzLjYtNC4xIDMuNi0yLjEwMSAwLTMuOC0xLjYtNC4xMDEtMy42IDAgLjE5OS0uMS4yOTktLjEuNS4xMDEgMi4yIDIuMDAxIDQuMSA0LjMwMSA0LjF6bS0xMC4yLTQuMDk5YzAtLjIwMSAwLS4zMDEtLjEtLjUtLjIgMi0yIDMuNi00LjEgMy42LTIuMTAxIDAtMy44MDEtMS42LTQuMTAxLTMuNiAwIC4xOTktLjEuMjk5LS4xLjUgMCAyLjI5OSAxLjggNC4xIDQuMSA0LjEgMi40MDEtLjAwMSA0LjMwMS0xLjkwMSA0LjMwMS00LjF6bTM1LjQgOS42OTljLS4yIDItMiAzLjYwMS00LjEgMy42MDEtMi4xMDEgMC0zLjgwMS0xLjYwMS00LjEwMS0zLjYwMSAwIC4yLS4xLjMtLjEuNSAwIDIuMyAxLjggNC4xMDEgNC4xIDQuMTAxczQuMTAxLTEuODAxIDQuMTAxLTQuMTAxYy4yLS4yLjEtLjMuMS0uNXptMTAuNiAzLjYwMWMtMi4xIDAtMy44LTEuNjAxLTQuMS0zLjYwMSAwIC4yLS4xLjMtLjEuNSAwIDIuMyAxLjggNC4xMDEgNC4xIDQuMTAxczQuMS0xLjgwMSA0LjEtNC4xMDFjMC0uMiAwLS4zLS4xLS41IDAgMi4xMDEtMS44IDMuNjAxLTMuOSAzLjYwMXptLTcuMyAxMC42OTljLTIuMSAwLTMuOC0xLjYtNC4xLTMuNiAwIC4yLS4xMDEuMy0uMTAxLjUgMCAyLjMgMS44MDEgNC4xIDQuMTAxIDQuMXM0LjEtMS44IDQuMS00LjFjMC0uMiAwLS4zLS4xLS41LS4xIDItMS43OTkgMy42LTMuOSAzLjZ6bTAtMTkuOWMyLjMgMCA0LjEwMS0xLjgwMSA0LjEwMS00LjEgMC0uMjAxIDAtLjMwMS0uMTAxLS41LS4yIDItMiAzLjYtNC4xIDMuNi0yLjEwMSAwLTMuOC0xLjYtNC4xMDEtMy42IDAgLjE5OS0uMS4yOTktLjEuNS4xMDEgMi4yIDIuMDAxIDQuMSA0LjMwMSA0LjF6bTE0LjMtMWMtMi4xIDAtMy44LTEuNi00LjEtMy42IDAgLjE5OS0uMS4yOTktLjEuNSAwIDIuMjk5IDEuOCA0LjEgNC4xIDQuMXM0LjEtMS44MDEgNC4xLTQuMWMwLS4yMDEgMC0uMzAxLS4xLS41LS4wOTkgMi4wMDEtMS44IDMuNi0zLjkgMy42eiIgb3BhY2l0eT0iLjEyIiBmaWxsPSIjRkZGIi8+CiAgICA8cGF0aCBmaWxsPSIjMEIwQjBGIiBkPSJNNDM2LjU1IDQyMC45NjdoLTY3LjljLTIuOCAwLTQuNjAxLjYwMS00LjYwMS0yLjE5OSAwLTIuODAxIDIuMzAxLTUgNS01aDY3LjljMi44IDAgNSAyLjMgNSA1IC4xMDEgMi42OTktMi41OTggMi4xOTktNS4zOTkgMi4xOTl6Ii8+CiAgICA8cGF0aCBkPSJNNDA4LjI1IDQxOC43NjhoLTM2LjVjLS41IDAtLjg5OS0uNC0uODk5LS45IDAtMS4xLjg5OS0yIDItMmgzNC4xOTljMS4xMDEgMCAyIC45IDIgMiAuMS40OTktLjMuOS0uOC45em0yMi4yLjc5OWgtNC4yYy0uODk5IDAtMS43LS44LTEuNy0xLjcgMC0xLjYgMS4zMDEtMi44IDIuODAxLTIuOGgxLjg5OWMxLjYwMSAwIDIuOCAxLjMgMi44IDIuOC4xIDEtLjYgMS43LTEuNiAxLjd6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMDgwODA4IiBkPSJNNTMwLjM1MSAxMjQuMjY3YzAtMS0uODAxLTEuOS0xLjktMS45aC0yNTEuMWMtMSAwLTEuOS44LTEuOSAxLjl2MTI5LjIwMWMwIDguNiA3IDE1LjYgMTUuNiAxNS42aDIyMy44YzguNiAwIDE1LjYtNyAxNS42LTE1LjZWMTMwLjM2N2wtLjEtNi4xeiIvPgogICAgPGcgb3BhY2l0eT0iLjEyIj4KICAgICAgICA8cGF0dGVybiBpZD0iZiIgeGxpbms6aHJlZj0iI2UiIHBhdHRlcm5UcmFuc2Zvcm09InRyYW5zbGF0ZSgtMjEwNTguMDk4IC01NTQ4LjYyKSBzY2FsZSguMTAxNykiIG9wYWNpdHk9Ii4xMiIvPgogICAgICAgIDxwYXRoIGZpbGw9InVybCgjZikiIGQ9Ik0yNzUuNDUgMjUzLjQ2OGMwIDguNiA3IDE1LjYgMTUuNiAxNS42aDIyMy44YzguNiAwIDE1LjYtNyAxNS42LTE1LjZ2LTEwNi41aC0yNTV2MTA2LjV6Ii8+CiAgICA8L2c+CiAgICA8Y2lyY2xlIGZpbGw9IiMwNTA1MDUiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIGN4PSI0MDIuOTUiIGN5PSIzNjEuOTY3IiByPSIyMC4yIi8+CiAgICA8ZyBmaWxsPSIjRjJGMkYyIj4KICAgICAgICA8cGF0aCBkPSJNNDA0LjA1IDM2OC41Njd2LTEyLjhjMC0uNS4xMDEtLjgwMS4zMDEtMSAuMS0uMi4zOTktLjMwMS42OTktLjIuNjAxLjIuOS43LjkgMS43djYuODk5Yy44LjQgMS41LjUgMi4xLjUuNjAxIDAgMS4yLS4yIDEuNjAxLS41IDEtLjcgMS41LTEuODk5IDEuNS0zLjcgMC0xLjg5OS0uNC0zLjM5OS0xLjItNC4zLS44LTEtMi4xLTEuODk5LTQuMS0yLjYtMS4zMDEtLjQtMi41LS44LTMuNjAxLTEuMTAxLTEuMS0uMy0yLS41LTIuODk5LS42OTl2MjAuNTk5bDQuNjk5IDEuNXYtNC4yOTh6bS01LjEtMWwtMS43LjYtLjg5OS40LTEuNjAxLjMtMS41LS4yYy0uMy0uMi0uMzk5LS4zOTktLjItLjYuMTAxLS4xMDEuMi0uMTAxLjMwMS0uMi4xLS4xLjMtLjEuMzk5LS4ybDEuMTAxLS4zOTkgNC4xLTEuNXYtMi43bC0xLjcuNS01LjUgMi0xIC4zOTljLTEuNS42MDEtMi4yIDEuMi0yLjIgMS44MDEuMTAxLjggMSAxLjUgMi43IDEuODk5LjcuMiAxLjQuMyAyLjEwMS40LjY5OS4xIDEuMzk5LjEgMi4xOTkuMSAxIDAgMi4xMDEtLjEgMy4zMDEtLjN2LTIuM2guMDk4eiIvPgogICAgICAgIDxwYXRoIGQ9Ik00MTQuNzUgMzY1LjI2OGMtLjg5OS0uMzAxLTEuNy0uNS0yLjUtLjYwMS0uOC0uMS0xLjctLjItMi41LS4xLS44OTkgMC0xLjg5OS4yLTIuOC4zLS44LjItMS43LjQtMi42Ljh2Mi44bDMuODk5LTEuMzk5IDEuNjAxLS41IDEuMS0uM2gxLjRjLjMuMS42LjE5OS42OTkuMzk5IDAgLjItLjE5OS40LS44LjYwMWwtMS4zOTkuNS02LjUgMi4zOTl2Mi43bDMuNS0xLjMgNi4zOTktMi4zLjctLjRjMS41LS41IDIuMi0xLjIgMi4yLTEuOS4wMDEtLjYtLjc5OC0xLjE5OS0yLjM5OS0xLjY5OXoiLz4KICAgIDwvZz4KICAgIDxwYXRoIGZpbGw9IiMwQTBBMEEiIGQ9Ik02OTcuMTUgMTA5Ljg2N2MwLS44LS40LTEuNS0xLjEwMS0xLjktNC41LTIuOS0yMy4zOTktMTMuNi01MS41LTEzLjYtMjYuODk5IDAtNDEuMSA1LjktNDUuMSA4LS44LjQtMS4yIDEuMi0xLjIgMiAwIDAgOS44LTIuOSA0Ny41LTIuOXM1MS40MDEgOC40IDUxLjQwMSA4LjR6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMTIxMjEyIiBkPSJNNjk3LjA1IDExNi43Njd2LTYuOXMtMTMuNjk5LTguNC01MS4zOTktOC40Yy0zNy44IDAtNDcuNSAyLjktNDcuNSAyLjl2MTFjNy43LTEuMyAyMS4yLTIuNiA0NC4xLTIuNiAyOC40OTkuMSA0NS44OTkgMi40IDU0Ljc5OSA0eiIvPgogICAgPHBhdGggZmlsbD0iIzBBMEEwQSIgZD0iTTEwOC43NSAxMDkuODY3YzAtLjguNC0xLjUgMS4xLTEuOSA0LjUtMi45IDIzLjQtMTMuNiA1MS41LTEzLjYgMjYuOSAwIDQxLjEgNS45IDQ1LjEgOCAuOC40IDEuMiAxLjIgMS4yIDIgMCAwLTkuOC0yLjktNDcuNS0yLjlzLTUxLjQgOC40LTUxLjQgOC40eiIvPgogICAgPHBhdGggZmlsbD0iIzEyMTIxMiIgZD0iTTEwOC44NSAxMTYuNzY3di02LjlzMTMuNy04LjQgNTEuNC04LjRjMzcuOCAwIDQ3LjUgMi45IDQ3LjUgMi45djExYy03LjctMS4zLTIxLjItMi42LTQ0LjEtMi42LTI4LjUuMS00NS45IDIuNC01NC44IDR6bTU4OC4zLTI2cy0zMi43LTMuMi01MC42MDEtMy4yYy0xNy44OTkgMC00OC4zOTkgMi40LTQ4LjM5OSAyLjRzMy4xLTQ0LjcgNC44LTUyYzEuNi03LjMgNy43LTIxLjMgMTYuOS0yNy45IDkuMTk5LTYuNiAxMS44OTktMTAuMSAyMi42OTktMTAuMSAxMC44MDEgMCAyNS40IDYuNCAzNC42MDEgMjEuNCA5LjMgMTUgMjAgNjkuNCAyMCA2OS40eiIvPgogICAgPHBhdGggZmlsbD0iIzBBMEEwQSIgZD0iTTU5OC42NSA4My4xNjdzMjYuMS00LjQgNDktNC40YzIyLjggMCA0Ny44OTkgNC40IDQ3Ljg5OSA0LjQgMSA0LjcgMS42MDEgNy42IDEuNjAxIDcuNnMtMzIuNy0zLjItNTAuNjAxLTMuMmMtMTcuODk5IDAtNDguMzk5IDIuNC00OC4zOTkgMi40cy4yMDEtMi43LjUtNi44eiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTY0OC42NSA2NS42NjdjLTIuMTAxIDEuNy0zLjIgMi42LTMuMiAyLjYtMS4yIDEuMi0xLjkgMi43LTIgNC41aDkuOHYtMi42aC02LjNjLjMtLjUgMS0xLjIgMi4xLTEuOSAxLjQtLjkgMi4zMDEtMS42IDIuNy0yLjEuOS0xIDEuMy0yLjEgMS4zLTMuMyAwLTEuNC0uNS0yLjUtMS4zOTktMy4zLS45LS44LTIuMTAxLTEuMi0zLjUtMS4yLTMuMTAxIDAtNC43IDEuNy00LjcgNWgyLjdjMC0xLjguNy0yLjcgMi4xLTIuNyAxLjMgMCAyIC43IDIgMi4xLjE5OSAxLjEtLjQgMi0xLjYwMSAyLjl6bS0xNy42IDEuNWgzYzEuNSAwIDIuMzAxLjYgMi40IDEuOS4xIDEuMi4yIDIuNS4zIDMuOGgzLjN2LS40Yy0uNS0uMi0uNjk5LS43LS42OTktMS41IDAtLjIgMC0uNC4xLS44di0uN2MwLTEuNy0uNi0yLjktMS44LTMuNSAxLjM5OS0uNSAyLjItMS42IDIuMi0zLjQgMC0xLjMtLjQtMi4zLTEuMzAxLTMtLjgtLjctMS44OTktMS0zLjE5OS0xaC03LjMwMXYxNC4zaDN2LTUuN3ptMC02LjJoMy43YzEuNCAwIDIuMTAxLjYgMi4xMDEgMS45cy0uODAxIDEuOS0yLjMwMSAxLjloLTMuNXYtMy44eiIgb3BhY2l0eT0iLjA4Ii8+CiAgICA8cGF0aCBmaWxsPSIjMTIxMjEyIiBkPSJNMTA4Ljc1IDkwLjc2N3MzMi43LTMuMiA1MC42LTMuMiA0OC4zIDIuNCA0OC4zIDIuNC0zLjEtNDQuNy00LjgtNTJjLTEuNi03LjMtNy43LTIxLjMtMTYuOS0yNy45LTkuMS02LjctMTEuOC0xMC4xLTIyLjYtMTAuMXMtMjUuNCA2LjQtMzQuNiAyMS40Yy05LjIgMTUtMjAgNjkuNC0yMCA2OS40eiIvPgogICAgPHBhdGggZmlsbD0iIzBBMEEwQSIgZD0iTTIwNy4yNSA4My4xNjdzLTI2LjEtNC40LTQ5LTQuNGMtMjIuOCAwLTQ3LjkgNC40LTQ3LjkgNC40LTEgNC43LTEuNiA3LjYtMS42IDcuNnMzMi43LTMuMiA1MC42LTMuMiA0OC4zIDIuNCA0OC4zIDIuNC0uMS0yLjctLjQtNi44eiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTE3My4yNSA2NS42NjdjLTIuMSAxLjctMy4yIDIuNi0zLjIgMi42LTEuMiAxLjItMS45IDIuNy0yIDQuNWg5Ljh2LTIuNmgtNi4yYy4zLS41IDEtMS4yIDIuMS0xLjkgMS40LS45IDIuMy0xLjYgMi43LTIuMS45LTEgMS4zLTIuMSAxLjMtMy4zIDAtMS40LS41LTIuNS0xLjQtMy4zLS45LS44LTIuMS0xLjItMy41LTEuMi0zLjEgMC00LjcgMS43LTQuNyA1aDIuN2MwLTEuOC43LTIuNyAyLjEtMi43IDEuMyAwIDIgLjcgMiAyLjEuMSAxLjEtLjUgMi0xLjcgMi45em0tOC41IDQuNWgtN3YtMTEuN2gtMy4xdjE0LjNoMTAuMXoiIG9wYWNpdHk9Ii4wOCIvPgogICAgPHBhdGggZD0iTTU0Ny41NSAxMzQuNTY3YzAgMi4xLTEuNSAzLjgtNC4xIDMuOHMtNC4xLTEuNy00LjEtMy44YzAtMiAxLjUtMy44IDQuMS0zLjhzNC4xIDEuNyA0LjEgMy44em0tNi42OTkgMGMwIDEuNC44IDIuNyAyLjYgMi43czIuNi0xLjQgMi42LTIuN2MwLTEuNC0uOC0yLjctMi42LTIuN3MtMi42IDEuMy0yLjYgMi43em04LTMuNmgzLjhjMi4zOTkgMCAyLjg5OSAxLjMgMi44OTkgMi4yIDAgLjktLjUgMi4yLTIuODk5IDIuMmgtMi4zdjIuOGgtMS41di03LjJ6bTEuNSAzLjRoMi4xOTljLjcgMCAxLjUtLjMgMS41LTEuMiAwLS45LS42OTktMS4yLTEuNS0xLjJoLTIuMTk5djIuNHptNS42OTktMy40aDYuOXYxLjFoLTIuN3Y2LjFoLTEuNXYtNi4yaC0yLjd2LTF6bTggMGgxLjV2Ny4yaC0xLjV2LTcuMnptMTEgMy42YzAgMi4xLTEuNSAzLjgtNC4xIDMuOHMtNC4xLTEuNy00LjEtMy44YzAtMiAxLjUtMy44IDQuMS0zLjhzNC4xIDEuNyA0LjEgMy44em0tNi42OTkgMGMwIDEuNC44IDIuNyAyLjYgMi43czIuNi0xLjQgMi42LTIuN2MwLTEuNC0uOC0yLjctMi42LTIuN3MtMi42IDEuMy0yLjYgMi43em04LjA5OS0zLjZoMS42bDMuOSA1LjN2LTUuM2gxLjR2Ny4yaC0xLjYwMWwtMy44OTktNS4zdjUuM2gtMS40di03LjJ6bTkuNyA0LjhjMCAxLjEgMSAxLjUgMi4yIDEuNSAxLjMgMCAxLjgtLjYgMS44LTEuMSAwLS42LS40LS44LS43LS45LS42LS4yLTEuNC0uMy0yLjYtLjYtMS41LS4zLTEuOS0xLjEtMS45LTEuOCAwLTEuNSAxLjYtMi4xIDMuMS0yLjEgMS44MDEgMCAzLjMwMS44IDMuMzAxIDIuM2gtMS41Yy0uMTAxLS45LS44MDEtMS4zLTEuODAxLTEuMy0uNjk5IDAtMS42LjItMS42LjkgMCAuNS40LjggMSAuOS4xIDAgMiAuNCAyLjUuNiAxLjEuMyAxLjcgMS4xIDEuNyAxLjggMCAxLjYtMS43IDIuMy0zLjQgMi4zLTIgMC0zLjUtLjgtMy42LTIuNmgxLjV2LjF6bS0zNjQgMGMwIDEuMSAxIDEuNSAyLjIgMS41IDEuMyAwIDEuOC0uNiAxLjgtMS4xIDAtLjYtLjQtLjgtLjctLjktLjYtLjItMS40LS4zLTIuNi0uNi0xLjUtLjMtMS45LTEuMS0xLjktMS44IDAtMS41IDEuNi0yLjEgMy4xLTIuMSAxLjgwMSAwIDMuMzAxLjggMy4zMDEgMi4zaC0xLjVjLS4xMDEtLjktLjgwMS0xLjMtMS44MDEtMS4zLS42OTkgMC0xLjYuMi0xLjYuOSAwIC41LjQuOCAxIC45LjEgMCAyIC40IDIuNS42IDEuMS4zIDEuNyAxLjEgMS43IDEuOCAwIDEuNi0xLjcgMi4zLTMuNCAyLjMtMiAwLTMuNS0uOC0zLjYtMi42aDEuNXYuMXptNi43MDEtNC44aDEuNXYyLjloMy44OTl2LTIuOWgxLjV2Ny4yaC0xLjV2LTMuMmgtMy44OTl2My4yaC0xLjV2LTcuMnptMTEgMGgxLjZsMy4zIDcuMmgtMS42bC0uOC0xLjloLTMuNGwtLjggMS45aC0xLjVsMy4yLTcuMnptLS41IDQuM2gyLjZsLTEuMy0zLjEtMS4zIDMuMXptNi4xOTktNC4zaDQuMTAxYzEuODk5IDAgMi44LjcgMi44IDEuOSAwIDEuNC0xLjEgMS43LTEuNCAxLjguNS4xIDEuMzAxLjQgMS4zMDEgMS41IDAgLjguMSAxLjYuNSAxLjloLTEuNjAxYy0uMi0uMy0uMi0uNy0uMi0xLjEgMC0xLjMtLjMtMS45LTEuNjk5LTEuOWgtMi4ydjNoLTEuNXYtNy4xaC0uMTAyem0xLjUgMy4yaDIuNWMxIDAgMS41LS40IDEuNS0xLjEgMC0uOS0uNjk5LTEuMS0xLjUtMS4xaC0yLjM5OXYyLjJoLS4xMDF6bTctMy4yaDYuMnYxLjFoLTQuN3YxLjloNC4zMDF2MWgtNC4zMDF2Mi4xaDQuN3YxLjFoLTYuMnYtNy4yeiIgZmlsbD0iI0NDQyIvPgo8L3N2Zz4K);background-repeat:no-repeat}[data-kind=\"ds4\"] .triggers{width:588px;height:90px;position:absolute;left:109px}[data-kind=\"ds4\"] .trigger{width:99px;height:100%;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTkuOSIgaGVpZ2h0PSI5MC44IiB2aWV3Qm94PSIwIDAgMTk5LjkgOTAuOCI+CiAgICA8cGF0aCBmaWxsPSIjRURFREVEIiBkPSJNMTk5Ljk1IDkwLjc5OXMtMzIuNy0zLjE5OS01MC42MDEtMy4xOTljLTE3Ljg5OSAwLTQ4LjM5OSAyLjQtNDguMzk5IDIuNHMzLjEtNDQuNzAxIDQuOC01MmMxLjctNy4zMDEgNy43LTIxLjMwMSAxNi45LTI3LjkgOS4xOTktNi42IDEyLTEwLjEgMjIuOC0xMC4xczI1LjM5OSA2LjQgMzQuNiAyMS40IDE5LjkgNjkuMzk5IDE5LjkgNjkuMzk5eiIvPgogICAgPHBhdGggZmlsbD0iI0Y1RjVGNSIgZD0iTTEwMS40NSA4My4yczI2LjEtNC40IDQ5LTQuNGMyMi44IDAgNDcuODk5IDQuNCA0Ny44OTkgNC40IDEgNC42OTkgMS42MDEgNy42IDEuNjAxIDcuNnMtMzIuNy0zLjE5OS01MC42MDEtMy4xOTljLTE3Ljg5OSAwLTQ4LjM5OSAyLjQtNDguMzk5IDIuNHMuMi0yLjcwMi41LTYuODAxeiIvPgogICAgPHBhdGggZD0iTTE1MS40NSA2NS43YTY4Ni44MyA2ODYuODMgMCAwIDAtMy4yIDIuNmMtMS4yIDEuMjAxLTEuOSAyLjcwMS0yIDQuNWg5Ljh2LTIuNmgtNi4yYy4zMDEtLjUgMS0xLjE5OSAyLjEwMS0xLjkgMS4zOTktLjkgMi4zLTEuNiAyLjctMi4xLjg5OS0xIDEuMy0yLjEgMS4zLTMuMzAxIDAtMS4zOTgtLjUtMi41LTEuNC0zLjI5OS0uODk5LS44MDEtMi4xLTEuMjAxLTMuNS0xLjIwMS0zLjEgMC00LjcgMS43MDEtNC43IDVoMi43YzAtMS43OTkuNy0yLjY5OSAyLjEwMS0yLjY5OSAxLjMgMCAyIC42OTkgMiAyLjEuMDk4IDEuMDk5LS41MDIgMS45OTktMS43MDIgMi45em0tMTcuNSAxLjVoM2MxLjUgMCAyLjMuNiAyLjM5OSAxLjkuMTAxIDEuMTk5LjIgMi41LjMwMSAzLjc5OWgzLjNWNzIuNWMtLjUtLjIwMS0uNy0uNzAxLS43LTEuNSAwLS4yMDEgMC0uNC4xLS44MDFWNjkuNWMwLTEuNzAxLS42LTIuOS0xLjgtMy41IDEuNC0uNSAyLjItMS42MDIgMi4yLTMuNCAwLTEuMzAxLS40LTIuMzAxLTEuMy0zLS44LS43MDEtMS45LTEtMy4yLTFoLTcuM3YxNC4yOTloM1Y2Ny4yem0wLTYuMmgzLjdjMS4zOTkgMCAyLjEuNiAyLjEgMS44OTggMCAxLjMwMS0uOCAxLjktMi4zIDEuOWgtMy41VjYxeiIgb3BhY2l0eT0iLjA4Ii8+CiAgICA8cGF0aCBmaWxsPSIjRURFREVEIiBkPSJNLjA1IDkwLjc5OVMzMi43NSA4Ny42IDUwLjY1MSA4Ny42YzE3Ljg5OSAwIDQ4LjMgMi40IDQ4LjMgMi40cy0zLjEwMS00NC43MDEtNC44LTUyYy0xLjctNy4zMDEtNy43LTIxLjMwMS0xNi45LTI3LjlTNjUuMzQ5IDAgNTQuNTUgMHMtMjUuNCA2LjQtMzQuNiAyMS40Uy4wNSA5MC43OTkuMDUgOTAuNzk5eiIvPgogICAgPHBhdGggZmlsbD0iI0Y1RjVGNSIgZD0iTTk4LjQ1IDgzLjJzLTI2LjEwMS00LjQtNDktNC40Yy0yMi44IDAtNDcuOSA0LjQtNDcuOSA0LjQtMSA0LjY5OS0xLjYgNy42LTEuNiA3LjZzMzIuNy0zLjE5OSA1MC42LTMuMTk5IDQ4LjQgMi40IDQ4LjQgMi40LS4xMDEtMi43MDItLjUtNi44MDF6Ii8+CiAgICA8cGF0aCBkPSJNNjQuNTUgNjUuN2MtMi4xIDEuNjk5LTMuMiAyLjYtMy4yIDIuNi0xLjE5OSAxLjIwMS0xLjg5OSAyLjcwMS0yIDQuNWg5Ljd2LTIuNmgtNi4yYy4zMDEtLjUgMS0xLjE5OSAyLjEwMS0xLjkgMS4zOTktLjkgMi4zLTEuNiAyLjctMi4xLjg5OS0xIDEuMy0yLjEgMS4zLTMuMzAxIDAtMS4zOTgtLjUtMi41LTEuNC0zLjI5OS0uODk5LS44MDEtMi4xLTEuMjAxLTMuNS0xLjIwMS0zLjEgMC00LjcgMS43MDEtNC43IDVoMi43YzAtMS43OTkuNy0yLjY5OSAyLjEwMS0yLjY5OSAxLjMgMCAyIC42OTkgMiAyLjEuMDk4IDEuMDk5LS40MDIgMS45OTktMS42MDIgMi45em0tOC41IDQuNWgtNy4xVjU4LjVoLTN2MTQuMjk5aDEwLjF6IiBvcGFjaXR5PSIuMDgiLz4KPC9zdmc+Cg==);position:absolute}[data-kind=\"ds4\"] .trigger.left{left:0}[data-kind=\"ds4\"] .trigger.right{right:0;background-position-x:99px}[data-kind=\"ds4\"] .bumper{width:99px;height:23px;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5OC45IiBoZWlnaHQ9IjIyLjQiIHZpZXdCb3g9Ii0yNTYgMzg1LjYgOTguOSAyMi40Ij4KICAgIDxwYXRoIGZpbGw9IiNGNUY1RjUiIGQ9Ik0tMjU2IDQwMS4xYzAtLjguNC0xLjUgMS4xLTEuOSA0LjUtMi45IDIzLjMtMTMuNiA1MS41LTEzLjYgMjYuOSAwIDQxLjEgNS45IDQ1LjEgOCAuOC40IDEuMiAxLjIgMS4yIDIgMCAwLTkuOC0yLjktNDcuNS0yLjlzLTUxLjQgOC40LTUxLjQgOC40eiIvPgogICAgPHBhdGggZmlsbD0iI0VERURFRCIgZD0iTS0yNTYgNDA4di02LjlzMTMuNy04LjQgNTEuNC04LjRjMzcuOCAwIDQ3LjUgMi45IDQ3LjUgMi45djExYy03LjctMS4zLTIxLjItMi42LTQ0LjEtMi42LTI4LjUgMC00NS45IDIuMy01NC44IDR6Ii8+Cjwvc3ZnPgo=) no-repeat;opacity:0;position:absolute}[data-kind=\"ds4\"] .bumpers{position:absolute;width:588px;height:23px;left:109px;top:94px}[data-kind=\"ds4\"] .bumper[data-pressed=\"true\"]{opacity:1}[data-kind=\"ds4\"] .bumper.left{left:0}[data-kind=\"ds4\"] .bumper.right{right:0;transform:rotateY(180deg)}[data-kind=\"ds4\"] .touchpad{width:262px;height:151px;position:absolute;left:272px;top:122px}[data-kind=\"ds4\"] .touchpad[data-pressed=\"true\"]{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjYzLjkiIGhlaWdodD0iMTUxLjIiIHZpZXdCb3g9IjAgMCAyNjMuOSAxNTEuMiI+CiAgICA8cGF0dGVybiB4PSItMTczLjU1IiB5PSI0NzIuMSIgd2lkdGg9IjcxIiBoZWlnaHQ9IjcxIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBpZD0iYSIgdmlld0JveD0iMCAtNzEgNzEgNzEiIG92ZXJmbG93PSJ2aXNpYmxlIj4KICAgICAgICA8cGF0aCBmaWxsPSJub25lIiBkPSJNMCAwaDcxdi03MUgweiIvPgogICAgICAgIDxwYXRoIGZpbGw9Im5vbmUiIGQ9Ik0wIDBoNzF2LTcxSDB6Ii8+CiAgICAgICAgPHBhdGggZmlsbD0iIzRDNEM0QyIgZD0iTTQxLjgtMzUuNWMwLTMuNS0yLjgtNi4zLTYuMy02LjNzLTYuMyAyLjgtNi4zIDYuMyAyLjggNi4zIDYuMyA2LjMgNi4zLTIuOCA2LjMtNi4zeiIvPgogICAgPC9wYXR0ZXJuPgogICAgPHBhdGggZmlsbD0iI0VERURFRCIgZD0iTTI2My43NDkgNS42MDFjLS40LTMuMjAxLTMuMy01LjYwMS02LjUtNS42MDFINi42NDljLTMuMiAwLTYuMSAyLjMwMS02LjUgNS42MDJDLjA1IDYuMy4wNSA3IC4wNSA3LjcwMXYxMjcuNGMwIDguODk4IDcuMTk5IDE2LjEgMTYuMSAxNi4xaDIzMS42YzguOSAwIDE2LjEwMS03LjIwMSAxNi4xMDEtMTYuMVY3LjcwMWMtLjAwMi0uODAxLS4wMDItMS41LS4xMDItMi4xeiIvPgogICAgPHBhdGggZmlsbD0iI0Y3RjdGNyIgZD0iTTI1OS4zNDkgMS45YzAtMS0uOC0xLjktMS45LTEuOUg2LjM0OWMtMSAwLTEuOS44MDEtMS45IDEuOXYxMjkuMjAxYzAgOC42IDcgMTUuNiAxNS42MDEgMTUuNmgyMjMuNzk5YzguNiAwIDE1LjYtNyAxNS42LTE1LjZWNy45bC0uMS02eiIvPgogICAgPGcgb3BhY2l0eT0iLjEyIj4KICAgICAgICA8cGF0dGVybiBpZD0iYiIgeGxpbms6aHJlZj0iI2EiIHBhdHRlcm5UcmFuc2Zvcm09Im1hdHJpeCguMTAxNyAwIDAgLS4xMDE3IC0xNDg2MC44NDIgLTIzODAuMjk0KSIgb3BhY2l0eT0iLjEyIi8+CiAgICAgICAgPHBhdGggZmlsbD0idXJsKCNiKSIgZD0iTTQuNDQ5IDEzMS4xMDFjMCA4LjYgNyAxNS42IDE1LjYwMSAxNS42aDIyMy43OTljOC42IDAgMTUuNi03IDE1LjYtMTUuNlYyNC41SDQuNTV2MTA2LjYwMmgtLjEwMXoiLz4KICAgIDwvZz4KPC9zdmc+Cg==) no-repeat center}[data-kind=\"ds4\"] .meta{width:42px;height:42px;position:absolute;left:382px;bottom:216px}[data-kind=\"ds4\"] .meta[data-pressed=\"true\"]{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0Mi4zIiBoZWlnaHQ9IjQyLjMiIHZpZXdCb3g9IjAgMCA0Mi4zIDQyLjMiPgogICAgPGNpcmNsZSBmaWxsPSIjRkFGQUZBIiBjeD0iMjEuMTUiIGN5PSIyMS4xNSIgcj0iMjAuMiIvPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTIxLjE1IDQyLjM1Yy0xMS42OTkgMC0yMS4xOTktOS41LTIxLjE5OS0yMS4xOTlDLS4wNDkgOS40NSA5LjQ1MS0uMDUgMjEuMTUtLjA1YzExLjcgMCAyMS4yIDkuNSAyMS4yIDIxLjIwMSAwIDExLjY5OS05LjUgMjEuMTk5LTIxLjIgMjEuMTk5em0wLTQwLjRjLTEwLjYgMC0xOS4xOTkgOC42MDItMTkuMTk5IDE5LjIwMVMxMC41NSA0MC4zNSAyMS4xNSA0MC4zNXMxOS4yLTguNiAxOS4yLTE5LjE5OVMzMS43NSAxLjk1IDIxLjE1IDEuOTV6Ii8+CiAgICA8ZyBmaWxsPSIjMEQwRDBEIj4KICAgICAgICA8cGF0aCBkPSJNMjIuMjUgMjcuNzV2LTEyLjhjMC0uNS4xMDEtLjc5OS4zMDEtMSAuMS0uMTk5LjQtLjI5OS42OTktLjE5OS42MDEuMTk5LjkuNjk5LjkgMS42OTl2Ni45Yy44MDEuNCAxLjUuNSAyLjEuNS42MDEgMCAxLjIwMS0uMTk5IDEuNjAxLS41IDEtLjY5OSAxLjUtMS45IDEuNS0zLjY5OSAwLTEuOS0uMzk5LTMuNC0xLjItNC4zMDEtLjgtMS0yLjEtMS45LTQuMS0yLjYtMS4zMDEtLjQtMi41LS44MDEtMy42LTEuMS0xLjEwMS0uMzAxLTItLjUtMi45LS43MDFWMzAuNTVsNC42OTkgMS41di00LjN6bS01LTFsLTEuNjk5LjYtLjkuNC0xLjYuMzAxLTEuNS0uMjAxYy0uMzAxLS4xOTktLjQtLjQtLjItLjYuMTAxLS4xLjItLjEuMy0uMTk5LjEtLjEwMi4zMDEtLjEwMi40LS4yMDFsMS4xLS40IDQuMS0xLjV2LTIuN2wtMS42OTkuNS01LjUgMi0xIC40Yy0xLjUuNi0yLjIgMS4xOTktMi4yIDEuNzk5LjEwMS44MDEgMSAxLjUgMi43IDEuOS42OTkuMjAxIDEuNC4zMDEgMi4xLjQuNy4xIDEuNC4xIDIuMi4xIDEgMCAyLjEwMS0uMSAzLjMtLjI5OXYtMi4zaC4wOTh6Ii8+CiAgICAgICAgPHBhdGggZD0iTTMzLjA1IDI0LjQ1Yy0uOS0uMjk5LTEuNy0uNS0yLjUtLjYtLjgwMS0uMS0xLjctLjE5OS0yLjUtLjEtLjkgMC0xLjkuMTk5LTIuODAxLjMwMS0uNzk5LjE5OS0xLjY5OS4zOTgtMi42Ljc5OXYyLjgwMWwzLjktMS40IDEuNi0uNSAxLjEtLjMwMWgxLjRjLjMwMS4xMDIuNi4yMDEuNy40IDAgLjIwMS0uMi40LS44LjZsLTEuNC41LTYuNSAyLjR2Mi43MDFsMy41LTEuMzAxIDYuNC0yLjMwMS42OTktLjM5OGMxLjUtLjUgMi4yMDEtMS4yMDEgMi4yMDEtMS45LjAwMi0uNi0uNzk5LTEuMjAxLTIuMzk5LTEuNzAxeiIvPgogICAgPC9nPgo8L3N2Zz4K) no-repeat center}[data-kind=\"ds4\"] .arrows{position:absolute;width:352px;height:46px;top:142px;left:227px}[data-kind=\"ds4\"] .select,[data-kind=\"ds4\"] .start{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOC40IiBoZWlnaHQ9IjQ2LjciIHZpZXdCb3g9IjAgMCAyOC40IDQ2LjciPgogICAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTE0LjIgMS43MDFjNi45IDAgMTIuNSA1LjYgMTIuNSAxMi41VjMyLjVjMCA2LjktNS42IDEyLjUtMTIuNSAxMi41UzEuNyAzOS40IDEuNyAzMi41VjE0LjIwMWMwLTYuOTAxIDUuNi0xMi41IDEyLjUtMTIuNU0xNC4yIDBDNi40IDAgMCA2LjQgMCAxNC4yMDFWMzIuNWMwIDcuOCA2LjQgMTQuMjAxIDE0LjIgMTQuMjAxUzI4LjQgNDAuMyAyOC40IDMyLjVWMTQuMjAxQzI4LjQgNi40IDIyIDAgMTQuMiAweiIvPgogICAgPHBhdGggZmlsbD0iI0VGRUVFNSIgZD0iTTE0LjIgMS43MDFjLTYuOSAwLTEyLjUgNS42LTEyLjUgMTIuNVYzMi41QzEuNyAzOS40IDcuMyA0NSAxNC4yIDQ1czEyLjUtNS42IDEyLjUtMTIuNVYxNC4yMDFjMC02LjkwMS01LjYtMTIuNS0xMi41LTEyLjV6Ii8+Cjwvc3ZnPgo=);width:28px;height:46px;opacity:0;position:absolute}[data-kind=\"ds4\"] .select[data-pressed=\"true\"],[data-kind=\"ds4\"] .start[data-pressed=\"true\"]{opacity:1}[data-kind=\"ds4\"] .select{left:0}[data-kind=\"ds4\"] .start{right:0;background-position:28px 0}[data-kind=\"ds4\"] .buttons{position:absolute;width:170px;height:170px;top:159px;left:567px}[data-kind=\"ds4\"] .button{position:absolute;width:56px;height:56px;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMjQiIGhlaWdodD0iMTEyIiB2aWV3Qm94PSIwIDAgMjI0IDExMiI+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNODQuMDUxIDU0Ljg3M2MtMTQuODk5IDAtMjcuMDI0LTEyLjEwNC0yNy4wMjQtMjYuOTc1IDAtMTQuODczIDEyLjEyNS0yNi44NzIgMjcuMDI0LTI2Ljg3MnMyNi45MiAxMi4xMDIgMjYuOTIgMjYuODcyYy4wMDIgMTQuNzctMTIuMTIzIDI2Ljk3NS0yNi45MiAyNi45NzV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEYwRjBGIiBkPSJNODQuMDUxIDIuMDUxYzE0LjI4MyAwIDI1Ljg5NCAxMS41ODkgMjUuODk0IDI1Ljk0OFM5OC4zMzQgNTMuODQ4IDg0LjA1MSA1My44NDhjLTE0LjI4MyAwLTI1Ljk5Ni0xMS41OTEtMjUuOTk2LTI1Ljg0OSAwLTE0LjI1NiAxMS42MTEtMjUuOTQ4IDI1Ljk5Ni0yNS45NDhtMC0yLjA1MUM2OC42MzggMCA1NiAxMi41MTIgNTYgMjcuOTk5IDU2IDQzLjQ4OCA2OC41MzYgNTYgODQuMDUxIDU2IDk5LjU2NyA1NiAxMTIgNDMuMzg0IDExMiAyNy45OTkgMTEyIDEyLjYxNSA5OS40NjQgMCA4NC4wNTEgMHoiLz4KICAgIDxwYXRoIGZpbGw9IiNGMTY2NjciIGQ9Ik04NC4wNTEgOC42MTVjLTEwLjY4NiAwLTE5LjQyIDguNzE4LTE5LjQyIDE5LjM4NCAwIDEwLjY2NyA4LjczNCAxOS4zODYgMTkuNDIgMTkuMzg2IDEwLjY4NyAwIDE5LjQyLTguNzE4IDE5LjQyLTE5LjM4Ni0uMTAyLTEwLjc3LTguNzMzLTE5LjM4NC0xOS40Mi0xOS4zODR6bTAgMzUuNzk1Yy05LjE0NSAwLTE2LjQ0LTcuMzg0LTE2LjQ0LTE2LjQxMSAwLTkuMTI4IDcuMzk3LTE2LjQxIDE2LjQ0LTE2LjQxIDkuMDQyIDAgMTYuNDM5IDcuMzg2IDE2LjQzOSAxNi40MS4wMDIgOS4wMjYtNy4zOTYgMTYuNDExLTE2LjQzOSAxNi40MTF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMjcuODk3IDU0Ljg3M2MtMTQuNzcgMC0yNi44NzItMTIuMTA0LTI2Ljg3Mi0yNi44NzQgMC0xNC43NjkgMTIuMTAyLTI2Ljk3NCAyNi44NzItMjYuOTc0IDE0Ljc2OSAwIDI2Ljk3NCAxMi4xMDIgMjYuOTc0IDI2Ljk3NCAwIDE0Ljg3My0xMi4xMDEgMjYuODc0LTI2Ljk3NCAyNi44NzR6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMEYwRjBGIiBkPSJNMjggMi4wNTFjMTQuMjU3IDAgMjUuOTQ5IDExLjU4OSAyNS45NDkgMjUuOTQ4UzQyLjI1NyA1My44NDggMjggNTMuODQ4IDIuMDUyIDQyLjI1NyAyLjA1MiAyNy45OTlDMi4wNTEgMTMuNzQzIDEzLjY0MSAyLjA1MSAyOCAyLjA1MU0yOCAwQzEyLjUxMyAwIDAgMTIuNTEyIDAgMjcuOTk5IDAgNDMuMzg1IDEyLjUxMyA1NiAyOCA1NnMyOC0xMi41MTMgMjgtMjguMDAxQzU1Ljg5NyAxMi41MTIgNDMuMzg0IDAgMjggMHoiLz4KICAgIDxwYXRoIGZpbGw9IiM3RkIxREYiIGQ9Ik00Mi42NjcgMTUuMjgybC0yLjA1Mi0yLjA1MkwyOCAyNS44NDYgMTUuMjgyIDEzLjIzbC0yLjA1MiAyLjA1MiAxMi42MTYgMTIuNjE1TDEzLjIzIDQwLjYxNmwyLjA1MiAyLjA1MkwyOCAzMC4wNWwxMi42MTUgMTIuNjE4IDIuMDUyLTIuMDUyLTEyLjYxNi0xMi43MTl6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNMTQwIDU0Ljk3M2MtMTQuODcyIDAtMjYuODcxLTEyLjEyNS0yNi44NzEtMjYuOTIgMC0xNC43OTcgMTIuMTA0LTI3LjAyNSAyNi44NzEtMjcuMDI1IDE0Ljc3IDAgMjYuOTc1IDEyLjEyNiAyNi45NzUgMjcuMDI1UzE1NC43NyA1NC45NzMgMTQwIDU0Ljk3M3oiLz4KICAgIDxwYXRoIGZpbGw9IiMwRjBGMEYiIGQ9Ik0xNDAgMi4wNTVjMTQuMjU3IDAgMjUuOTQ3IDExLjYxMiAyNS45NDcgMjUuOTk3UzE1NC4zNTggNTMuOTQ1IDE0MCA1My45NDVzLTI1Ljk0Ny0xMS42MTEtMjUuOTQ3LTI1Ljk5NmMwLTE0LjM4NSAxMS41ODktMjUuODk0IDI1Ljk0Ny0yNS44OTRNMTQwIDBjLTE1LjM4NSAwLTI4IDEyLjUzNi0yOCAyOC4wNTJDMTEyIDQzLjU2NyAxMjQuNTE0IDU2IDE0MCA1NmMxNS40ODggMCAyOC0xMi41MzUgMjgtMjcuOTQ3QzE2OCAxMi42MzkgMTU1LjM4NSAwIDE0MCAweiIvPgogICAgPHBhdGggZmlsbD0iI0NCNzlCMSIgZD0iTTE1MS43OTUgMTMuMTUzaC0yNi40NjJ2MjkuMzg1aDI5LjMzNFYxMy4xNTRsLTIuODcyLS4wMDF6bTAgMjYuNjEyaC0yMy41OVYxNi4xMzJoMjMuNTl2MjMuNjMzeiIvPgogICAgPHBhdGggZmlsbD0iIzFBMUExQSIgZD0iTTE5NS45NDkgNTQuODcyYy0xNC44OTkgMC0yNy4wMjMtMTIuMTAyLTI3LjAyMy0yNi45NzMgMC0xNC44NzIgMTIuMTI0LTI2Ljk3NiAyNy4wMjMtMjYuOTc2IDE0Ljg5NyAwIDI3LjAyMiAxMi4yMDYgMjcuMDIyIDI3LjA3OHMtMTIuMTIzIDI2Ljg3MS0yNy4wMjIgMjYuODcxeiIvPgogICAgPHBhdGggZmlsbD0iIzBGMEYwRiIgZD0iTTE5Ni4wNTEgMi4wNTFjMTQuMjgzIDAgMjUuOTk1IDExLjU5MSAyNS45OTUgMjUuOTVTMjEwLjQzNyA1My45NSAxOTYuMDUxIDUzLjk1Yy0xNC4zODUgMC0yNS45OTUtMTEuNTktMjUuOTk1LTI1Ljk0OSAwLTE0LjM1OSAxMS42MS0yNS45NSAyNS45OTUtMjUuOTVtMC0yLjA1MUMxODAuNjM5IDAgMTY4IDEyLjUxNCAxNjggMjguMDAxUzE4MC41MzYgNTYgMTk2LjA1MSA1NkMyMTEuNTY2IDU2IDIyNCA0My4zODYgMjI0IDI4LjAwMSAyMjQgMTIuNjE2IDIxMS40NjQgMCAxOTYuMDUxIDB6Ii8+CiAgICA8cGF0aCBmaWxsPSIjNjZDMTk0IiBkPSJNMjEyLjQ0IDM1LjgzNGwtMTYuNDM5LTI4LjMwNy0xNi40MzkgMjguMzA3LTEuNjQ2IDIuODcyaDM2LjE2OGwtMS42NDQtMi44NzJ6bS0xNi4zMzYgMGgtMTMuMDUxbDEzLjA1MS0yMi40NjIgMTMuMDQ5IDIyLjQ2MmgtMTMuMDQ5eiIvPgogICAgPHBhdGggZmlsbD0iI0U2RTZFNiIgZD0iTTg0LjA1MSAxMTAuOTdjLTE0Ljg5OCAwLTI3LjAyMy0xMi4xMjMtMjcuMDIzLTI3LjAxOSAwLTE0LjkgMTIuMTI1LTI2LjkyNSAyNy4wMjMtMjYuOTI1IDE0Ljg5OSAwIDI2LjkyMSAxMi4xMjcgMjYuOTIxIDI3LjAyNS4wMDEgMTQuODk4LTEyLjEyNCAyNi45MTktMjYuOTIxIDI2LjkxOXoiLz4KICAgIDxwYXRoIGZpbGw9IiNGMEYwRjAiIGQ9Ik04NC4wNTEgNTguMDU1YzE0LjI4MyAwIDI1Ljk5NyAxMS42MTIgMjUuOTk3IDI1Ljg5NCAwIDE0LjI3OS0xMS42MTEgMjUuOTk0LTI1Ljk5NyAyNS45OTRTNTguMDU1IDk4LjMzMyA1OC4wNTUgODQuMDVzMTEuNjExLTI1Ljk5NSAyNS45OTYtMjUuOTk1bTAtMi4wNTVDNjguNjM5IDU2IDU2IDY4LjUzNyA1NiA4My45NTIgNTYgOTkuMzYzIDY4LjUzNiAxMTIgODQuMDUxIDExMiA5OS41NjYgMTEyIDExMiA5OS40NjQgMTEyIDg0LjA1MlM5OS40NjQgNTYgODQuMDUxIDU2eiIvPgogICAgPHBhdGggZmlsbD0iI0YxNjY2NyIgZD0iTTg0LjA1MSA2NC42MzFjLTEwLjY4NiAwLTE5LjQyIDguNzMyLTE5LjQyIDE5LjQyMSAwIDEwLjY4NyA4LjczNCAxOS40MTkgMTkuNDIgMTkuNDE5IDEwLjY4OCAwIDE5LjQyMS04LjczMiAxOS40MjEtMTkuNDE5LS4xMDMtMTAuNzktOC43MzQtMTkuNDIxLTE5LjQyMS0xOS40MjF6bTAgMzUuODYxYy05LjE0NSAwLTE2LjQzOS03LjM5Ny0xNi40MzktMTYuNDM5IDAtOS4xNDYgNy4zOTctMTYuNDM5IDE2LjQzOS0xNi40MzlzMTYuNDQgNy4zOTcgMTYuNDQgMTYuNDM5Yy4wMDEgOS4wMzktNy4zOTcgMTYuNDM5LTE2LjQ0IDE2LjQzOXoiLz4KICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIGQ9Ik0yNy44OTcgMTEwLjg3NGMtMTQuNzcgMC0yNi44NzItMTItMjYuODcyLTI2Ljg3MyAwLTE0Ljg3MiAxMi4xMDItMjYuODcyIDI2Ljk3NC0yNi44NzJTNTQuOTc0IDY5LjIzMSA1NC45NzQgODRzLTEyLjIwNCAyNi44NzQtMjcuMDc3IDI2Ljg3NHoiLz4KICAgIDxwYXRoIGZpbGw9IiNGMEYwRjAiIGQ9Ik0yOCA1OC4wNTNjMTQuMjU3IDAgMjUuOTQ5IDExLjU4OSAyNS45NDkgMjUuODQ3IDAgMTQuMjU1LTExLjU5IDI1Ljk0Ny0yNS45NDkgMjUuOTQ3UzIuMDUyIDk4LjI1OCAyLjA1MiA4NEMyLjA1MSA2OS43NDQgMTMuNjQxIDU4LjA1MyAyOCA1OC4wNTNNMjggNTZDMTIuNTE0IDU2IDAgNjguNjE3IDAgODRjMCAxNS4zODcgMTIuNTEzIDI4IDI4IDI4czI4LTEyLjUxMiAyOC0yOGMtLjEwMy0xNS4zODMtMTIuNjE2LTI4LTI4LTI4eiIvPgogICAgPHBhdGggZmlsbD0iIzdGQjFERiIgZD0iTTQyLjY2NyA3MS4yODNsLTIuMDUyLTIuMDUyTDI4IDgxLjk1IDE1LjI4MiA2OS4yMzFsLTIuMDUyIDIuMDUyTDI1Ljg0NiA4NCAxMy4yMyA5Ni42MTZsMi4wNTIgMi4xNTZMMjggODYuMDUybDEyLjYxNSAxMi43MiAyLjA1Mi0yLjE1NkwzMC4wNTEgODR6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRTZFNkU2IiBkPSJNMTQwLjAwMSAxMTAuOTdjLTE0Ljg3MiAwLTI2Ljg3Mi0xMi4xMjMtMjYuODcyLTI3LjAxOSAwLTE0LjkgMTIuMTA0LTI2LjkyNSAyNi44NzItMjYuOTI1IDE0Ljc3MSAwIDI2Ljk3NSAxMi4xMjcgMjYuOTc1IDI2LjkyNSAwIDE0Ljc5NC0xMi4yMDUgMjcuMDE5LTI2Ljk3NSAyNy4wMTl6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRjBGMEYwIiBkPSJNMTQwLjAwMSA1OC4wNTVjMTQuMjU4IDAgMjUuOTQ4IDExLjYxMiAyNS45NDggMjUuODk0IDAgMTQuMjc5LTExLjU5IDI1Ljk5NC0yNS45NDggMjUuOTk0cy0yNS45NDctMTEuNjA5LTI1Ljk0Ny0yNS44OTMgMTEuNTg5LTI1Ljk5NSAyNS45NDctMjUuOTk1bTAtMi4wNTVDMTI0LjYxNiA1NiAxMTIgNjguNTM3IDExMiA4My45NTIgMTEyIDk5LjM2MyAxMjQuNTE0IDExMiAxNDAuMDAxIDExMlMxNjggOTkuNDY0IDE2OCA4My45NTJDMTY4IDY4LjQzMiAxNTUuMzg2IDU2IDE0MC4wMDEgNTZ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjQ0I3OUIxIiBkPSJNMTUxLjc5NyA2OS4yNTVoLTI2LjQ2M3YyOS4zODZoMjkuMzMzVjY5LjI1NWgtMi44N3ptMCAyNi42MTNoLTIzLjU5MlY3Mi4yMzVoMjMuNTkydjIzLjYzM3oiLz4KICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIGQ9Ik0xOTUuOTQ5IDExMC45N2MtMTQuODk4IDAtMjcuMDIzLTEyLjEyMy0yNy4wMjMtMjcuMDE5IDAtMTQuOSAxMi4xMjUtMjYuOTI1IDI3LjAyMy0yNi45MjUgMTQuODk3IDAgMjcuMDIyIDEyLjEyNyAyNy4wMjIgMjcuMDI1LjAwMSAxNC44OTgtMTIuMTIzIDI2LjkxOS0yNy4wMjIgMjYuOTE5eiIvPgogICAgPHBhdGggZmlsbD0iI0YwRjBGMCIgZD0iTTE5Ni4wNTEgNTguMDU1YzE0LjI4MyAwIDI1Ljk5NSAxMS42MTIgMjUuOTk1IDI1Ljg5NCAwIDE0LjI3OS0xMS42MDkgMjUuOTk0LTI1Ljk5NSAyNS45OTQtMTQuMzg1IDAtMjUuOTk1LTExLjYwOS0yNS45OTUtMjUuODkzczExLjYxLTI1Ljk5NSAyNS45OTUtMjUuOTk1bTAtMi4wNTVDMTgwLjYzOSA1NiAxNjggNjguNTM3IDE2OCA4My45NTIgMTY4IDk5LjM2MyAxODAuNTM2IDExMiAxOTYuMDUxIDExMiAyMTEuNTY2IDExMiAyMjQgOTkuNDY0IDIyNCA4NC4wNTJTMjExLjQ2NCA1NiAxOTYuMDUxIDU2eiIvPgogICAgPHBhdGggZmlsbD0iIzY2QzE5NCIgZD0iTTIxMi4zODkgOTIuMjczTDE5NS45NSA2My45MTVsLTE2LjQ0IDI4LjM1OC0xLjY0NSAyLjg3NWgzNi4xNjhsLTEuNjQ0LTIuODc1em0tMTYuMzM4IDBoLTEzLjA1bDEzLjA1LTIyLjUwNCAxMy4wNSAyMi41MDRoLTEzLjA1eiIvPgo8L3N2Zz4K)}[data-kind=\"ds4\"] .button[data-pressed=\"true\"]{background-position-y:56px}[data-kind=\"ds4\"] .a{background-position:0 0;bottom:0;left:56px}[data-kind=\"ds4\"] .b{background-position:-56px 0;top:56px;right:0}[data-kind=\"ds4\"] .x{background-position:112px 0;top:56px;left:0}[data-kind=\"ds4\"] .y{background-position:56px 0;left:56px;top:0}[data-kind=\"ds4\"] .sticks{position:absolute;width:361px;height:105px;top:308px;left:228px}[data-kind=\"ds4\"] .stick{position:absolute;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyODYiIGhlaWdodD0iOTQiIHZpZXdCb3g9IjAgMCAyODYgOTQiPgogICAgPHBhdGggZmlsbD0iIzBGMEYwRiIgZD0iTTQ3IDkyLjVDMjEuOSA5Mi41IDEuNSA3Mi4xIDEuNSA0N1MyMS44OTkgMS41IDQ3IDEuNSA5Mi41IDIxLjkgOTIuNSA0NyA3Mi4xIDkyLjUgNDcgOTIuNXoiLz4KICAgIDxwYXRoIGZpbGw9IiMxMjEyMTIiIGQ9Ik00NyAzYzI0LjMgMCA0NCAxOS43IDQ0IDQ0UzcxLjMgOTEgNDcgOTEgMyA3MS4zIDMgNDcgMjIuNyAzIDQ3IDNtMC0zQzIxIDAgMCAyMSAwIDQ3czIxIDQ3IDQ3IDQ3IDQ3LTIxIDQ3LTQ3UzczIDAgNDcgMHoiLz4KICAgIDxjaXJjbGUgZmlsbD0iIzE0MTQxNCIgY3g9IjQ3IiBjeT0iNDciIHI9IjI3LjMiLz4KICAgIDxwYXRoIGZpbGw9IiNGMEYwRjAiIGQ9Ik0yMzkgOTIuNWMtMjUuMTAxIDAtNDUuNS0yMC40LTQ1LjUtNDUuNVMyMTMuODk5IDEuNSAyMzkgMS41YzI1LjEgMCA0NS41IDIwLjQgNDUuNSA0NS41UzI2NC4xIDkyLjUgMjM5IDkyLjV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRURFREVEIiBkPSJNMjM5IDNjMjQuMjk5IDAgNDQgMTkuNyA0NCA0NHMtMTkuNzAxIDQ0LTQ0IDQ0Yy0yNC4zMDEgMC00NC0xOS43LTQ0LTQ0czE5LjY5OS00NCA0NC00NG0wLTNjLTI2IDAtNDcgMjEtNDcgNDdzMjEgNDcgNDcgNDcgNDctMjEgNDctNDctMjEtNDctNDctNDd6Ii8+CiAgICA8Y2lyY2xlIGZpbGw9IiNFQkVCRUIiIGN4PSIyMzkiIGN5PSI0NyIgcj0iMjcuMyIvPgogICAgPHBhdGggZmlsbD0iI0YwRjBGMCIgZD0iTTE0MyA5Mi41Yy0yNS4xIDAtNDUuNS0yMC40LTQ1LjUtNDUuNVMxMTcuOSAxLjUgMTQzIDEuNXM0NS41IDIwLjQgNDUuNSA0NS41LTIwLjQgNDUuNS00NS41IDQ1LjV6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRURFREVEIiBkPSJNMTQzIDNjMjQuMjk5IDAgNDQgMTkuNyA0NCA0NHMtMTkuNzAxIDQ0LTQ0IDQ0Yy0yNC4zIDAtNDQtMTkuNy00NC00NHMxOS43LTQ0IDQ0LTQ0bTAtM2MtMjYgMC00NyAyMS00NyA0N3MyMSA0NyA0NyA0NyA0Ny0yMSA0Ny00Ny0yMS00Ny00Ny00N3oiLz4KICAgIDxjaXJjbGUgZmlsbD0iI0VCRUJFQiIgY3g9IjE0MyIgY3k9IjQ3IiByPSIyNy4zIi8+Cjwvc3ZnPgo=);height:94px;width:94px}[data-kind=\"ds4\"] .stick[data-pressed=\"true\"].left{background-position-x:-96px}[data-kind=\"ds4\"] .stick[data-pressed=\"true\"].right{background-position-x:-192px}[data-kind=\"ds4\"] .stick.left{top:0;left:0}[data-kind=\"ds4\"] .stick.right{top:calc(100% - 105px);left:calc(100% - 105px)}[data-kind=\"ds4\"] .dpad{position:absolute;width:125px;height:126px;top:181px;left:92px}[data-kind=\"ds4\"] .face{background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNzguNSIgaGVpZ2h0PSIxMDQiIHZpZXdCb3g9IjAgMCAxNzguNSAxMDQiPgogICAgPHBhdGggZmlsbD0iIzFBMUExQSIgZD0iTTEyNC41MDUgMjAuNjU0YzEuMzk5LTIgMS4yLTIuOSAxLjItMi45cy4xOTktLjktMS4yLTIuOS0xNS0xMy42LTE1LjctMTRjLS42OTktLjM5OS0yOC41LTIuMTk5LTMxLjQgMS4zMDFzLTIuNiAxNS42LTIuNiAxNS42LS4zIDEyLjEgMi42IDE1LjYgMzAuNzAxIDEuNyAzMS40IDEuMzAxYy43LS40MDIgMTQuMy0xMi4wMDIgMTUuNy0xNC4wMDJ6Ii8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMjUiIGQ9Ik0xMjQuNTA1IDIwLjY1NGMxLjM5OS0yIDEuMi0yLjkgMS4yLTIuOXMuMTk5LS45LTEuMi0yLjljLS44OTktMS4zLTYuODk5LTYuNi0xMS4yLTEwLjMtMi4xIDMuOS0zLjQgOC40LTMuNCAxMy4yczEuMjAxIDkuMyAzLjQgMTMuMmM0LjMtMy43IDEwLjMtOSAxMS4yLTEwLjN6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMUExQTFBIiBkPSJNNTIuMjA1IDQ5Ljc1NGMyIDEuNCAyLjkgMS4yIDIuOSAxLjJzLjkuMiAyLjktMS4yIDEzLjYtMTUgMTQtMTUuNyAyLjItMjguNS0xLjMtMzEuMzk5Yy0zLjUtMi45LTE1LjYtMi42MDEtMTUuNi0yLjYwMXMtMTIuMS0uMi0xNS42IDIuNjAxYy0zLjUgMi44LTEuNyAzMC42OTktMS4zIDMxLjM5OS40LjcgMTIgMTQuMyAxNCAxNS43eiIvPgogICAgPHBhdGggb3BhY2l0eT0iLjI1IiBkPSJNNTIuMjA1IDQ5Ljc1NGMyIDEuNCAyLjkgMS4yIDIuOSAxLjJzLjkuMiAyLjktMS4yYzEuMy0uOSA2LjYtNi45IDEwLjMtMTEuMi0zLjktMi4xLTguNC0zLjM5OS0xMy4yLTMuMzk5LTQuOCAwLTkuMyAxLjE5OS0xMy4yIDMuMzk5IDMuNyA0LjMgOSAxMC4zIDEwLjMgMTEuMnoiLz4KICAgIDxwYXRoIGZpbGw9IiMxQTFBMUEiIGQ9Ik0xNzUuOTA0IDIuMjU0Yy0yLjg5OS0zLjUtMzAuNjk5LTEuNy0zMS4zOTktMS4zLS43LjM5OS0xNC4zIDEyLTE1LjcgMTRzLTEuMTk5IDIuODk5LTEuMTk5IDIuODk5LS4yMDEuOSAxLjE5OSAyLjkgMTUgMTMuNiAxNS43IDE0IDI4LjUgMi4yIDMxLjM5OS0xLjNjMi45LTMuNSAyLjYwMS0xNS42MDEgMi42MDEtMTUuNjAxcy4zLTEyLjA5OC0yLjYwMS0xNS41OTh6Ii8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMjUiIGQ9Ik0xNDAuMTA1IDQuNjU0Yy00LjMwMSAzLjY5OS0xMC4zMDEgOS0xMS4yMDEgMTAuMy0xLjM5OSAyLTEuMTk5IDIuODk5LTEuMTk5IDIuODk5cy0uMi45IDEuMTk5IDIuOWMuOSAxLjMgNi45IDYuNiAxMS4yMDEgMTAuMyAyLjEtMy44OTkgMy4zOTktOC4zOTkgMy4zOTktMTMuMi4wMDEtNC43OTktMS4yOTktOS4yOTktMy4zOTktMTMuMTk5eiIvPgogICAgPHBhdGggZmlsbD0iIzFBMUExQSIgZD0iTTIwLjYwNSAxLjI1NGMtMi0xLjQtMi45LTEuMi0yLjktMS4ycy0uOS0uMi0yLjkgMS4yLTEzLjYgMTUtMTQgMTUuN2MtLjQuNy0yLjIgMjguNSAxLjMgMzEuMzk5IDMuNSAyLjkgMTUuNiAyLjYwMSAxNS42IDIuNjAxczEyLjEuMyAxNS42LTIuNjAxYzMuNS0yLjg5OSAxLjctMzAuNjk5IDEuMy0zMS4zOTlzLTEyLTE0LjMtMTQtMTUuN3oiLz4KICAgIDxwYXRoIG9wYWNpdHk9Ii4yNSIgZD0iTTIwLjYwNSAxLjI1NGMtMi0xLjQtMi45LTEuMi0yLjktMS4ycy0uOS0uMi0yLjkgMS4yYy0xLjMuOS02LjYgNi45LTEwLjMgMTEuMiAzLjkgMi4xIDguNCAzLjM5OSAxMy4yIDMuMzk5IDQuOCAwIDkuMy0xLjE5OSAxMy4yLTMuMzk5LTMuNy00LjMtOS0xMC4zLTEwLjMtMTEuMnoiLz4KICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIGQ9Ik0xMjQuNTA1IDczLjY1NGMxLjM5OS0yIDEuMi0yLjkgMS4yLTIuOXMuMTk5LS45LTEuMi0yLjktMTUtMTMuNi0xNS43LTE0Yy0uNjk5LS4zOTktMjguNS0yLjE5OS0zMS40IDEuMzAxcy0yLjYgMTUuNi0yLjYgMTUuNi0uMyAxMi4xIDIuNiAxNS42IDMwLjcwMSAxLjcgMzEuNCAxLjMwMWMuNy0uNDAyIDE0LjMtMTIuMDAyIDE1LjctMTQuMDAyeiIvPgogICAgPHBhdGggb3BhY2l0eT0iLjI1IiBmaWxsPSIjRkZGIiBkPSJNMTI0LjUwNSA3My42NTRjMS4zOTktMiAxLjItMi45IDEuMi0yLjlzLjE5OS0uOS0xLjItMi45Yy0uODk5LTEuMy02Ljg5OS02LjYtMTEuMi0xMC4zLTIuMSAzLjktMy40IDguNC0zLjQgMTMuMnMxLjIwMSA5LjMgMy40IDEzLjJjNC4zLTMuNyAxMC4zLTkgMTEuMi0xMC4zeiIvPgogICAgPHBhdGggZmlsbD0iI0U2RTZFNiIgZD0iTTUyLjIwNSAxMDIuNzU0YzIgMS40IDIuOSAxLjIgMi45IDEuMnMuOS4yIDIuOS0xLjIgMTMuNi0xNSAxNC0xNS43IDIuMi0yOC41LTEuMy0zMS4zOTljLTMuNS0yLjktMTUuNi0yLjYwMS0xNS42LTIuNjAxcy0xMi4xLS4yLTE1LjYgMi42MDFjLTMuNSAyLjgtMS43IDMwLjY5OS0xLjMgMzEuMzk5LjQuNyAxMiAxNC4zIDE0IDE1Ljd6Ii8+CiAgICA8cGF0aCBvcGFjaXR5PSIuMjUiIGZpbGw9IiNGRkYiIGQ9Ik01Mi4yMDUgMTAyLjc1NGMyIDEuNCAyLjkgMS4yIDIuOSAxLjJzLjkuMiAyLjktMS4yYzEuMy0uOSA2LjYtNi45IDEwLjMtMTEuMi0zLjktMi4xLTguNC0zLjM5OS0xMy4yLTMuMzk5LTQuOCAwLTkuMyAxLjE5OS0xMy4yIDMuMzk5IDMuNyA0LjMgOSAxMC4zIDEwLjMgMTEuMnoiLz4KICAgIDxwYXRoIGZpbGw9IiNFNkU2RTYiIGQ9Ik0xNzUuOTA0IDU1LjE1NGMtMi44OTktMy41LTMwLjY5OS0xLjctMzEuMzk5LTEuMzAxLS43LjQtMTQuMyAxMi0xNS43IDE0cy0xLjE5OSAyLjktMS4xOTkgMi45LS4yMDEuOSAxLjE5OSAyLjkgMTUgMTMuNiAxNS43IDE0Yy43LjM5OSAyOC41IDIuMTk5IDMxLjM5OS0xLjMwMSAyLjktMy41IDIuNjAxLTE1LjYgMi42MDEtMTUuNnMuMy0xMi4wOTgtMi42MDEtMTUuNTk4eiIvPgogICAgPHBhdGggb3BhY2l0eT0iLjI1IiBmaWxsPSIjRkZGIiBkPSJNMTQwLjEwNSA1Ny42NTRjLTQuMzAxIDMuNjk5LTEwLjMwMSA5LTExLjIwMSAxMC4zLTEuMzk5IDItMS4xOTkgMi44OTktMS4xOTkgMi44OTlzLS4yLjkgMS4xOTkgMi45Yy45IDEuMyA2LjkgNi42IDExLjIwMSAxMC4zIDIuMS0zLjg5OSAzLjM5OS04LjM5OSAzLjM5OS0xMy4yLjAwMS00Ljc5OS0xLjI5OS05LjI5OS0zLjM5OS0xMy4xOTl6Ii8+CiAgICA8cGF0aCBmaWxsPSIjRTZFNkU2IiBkPSJNMjAuNjA1IDU0LjI1NGMtMi0xLjQtMi45LTEuMi0yLjktMS4ycy0uOS0uMi0yLjkgMS4yLTEzLjYgMTUtMTQgMTUuN2MtLjQuNy0yLjIgMjguNSAxLjMgMzEuMzk5IDMuNSAyLjkgMTUuNiAyLjYwMSAxNS42IDIuNjAxczEyLjEuMyAxNS42LTIuNjAxYzMuNS0yLjg5OSAxLjctMzAuNjk5IDEuMy0zMS4zOTlzLTEyLTE0LjMtMTQtMTUuN3oiLz4KICAgIDxwYXRoIG9wYWNpdHk9Ii4yNSIgZmlsbD0iI0ZGRiIgZD0iTTIwLjYwNSA1NC4yNTRjLTItMS40LTIuOS0xLjItMi45LTEuMnMtLjktLjItMi45IDEuMmMtMS4zLjktNi42IDYuOS0xMC4zIDExLjIgMy45IDIuMSA4LjQgMy4zOTkgMTMuMiAzLjM5OSA0LjggMCA5LjMtMS4xOTkgMTMuMi0zLjM5OS0zLjctNC4zLTktMTAuMy0xMC4zLTExLjJ6Ii8+Cjwvc3ZnPgo=);position:absolute}[data-kind=\"ds4\"] .face.up,[data-kind=\"ds4\"] .face.down{width:36px;height:52px}[data-kind=\"ds4\"] .face.left,[data-kind=\"ds4\"] .face.right{width:52px;height:36px}[data-kind=\"ds4\"] .face.up{left:44px;top:0;background-position:-37px 0}[data-kind=\"ds4\"] .face.down{left:44px;bottom:0;background-position:0 0}[data-kind=\"ds4\"] .face.left{top:44px;left:0;background-position:104px 0}[data-kind=\"ds4\"] .face.right{top:44px;right:0;background-position:52px 0}[data-kind=\"ds4\"] .face[data-pressed=\"true\"]{background-position-y:52px}";
  var _padCssInjected = false;
  function ensurePadCss() {
    if (_padCssInjected) return;
    _padCssInjected = true;
    var st = document.createElement("style");
    st.textContent = PAD_CSS;
    document.head.appendChild(st);
  }
  var PAD_LABELS = {
    ds4: { 0: "X", 1: "Circulo", 2: "Quadrado", 3: "Triangulo", 4: "L1", 5: "R1", 6: "L2", 7: "R2", 8: "Share", 9: "Options", 10: "L3", 11: "R3", 12: "D-Pad Cima", 13: "D-Pad Baixo", 14: "D-Pad Esquerda", 15: "D-Pad Direita", 16: "PS", 17: "Touchpad" },
    xboxone: { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "Voltar", 9: "Menu", 10: "L3", 11: "R3", 12: "D-Pad Cima", 13: "D-Pad Baixo", 14: "D-Pad Esquerda", 15: "D-Pad Direita", 16: "Xbox" }
  };
  function detectPadKind(gp) {
    var id = (gp && gp.id || "").toLowerCase();
    if (id.indexOf("xbox") >= 0 || id.indexOf("xinput") >= 0) return "xboxone";
    return "ds4";
  }
  function buildPadInner(kind) {
    var kids = [
      h("div", { class: "triggers" }, [h("span", { class: "trigger left", "data-button": "6" }), h("span", { class: "trigger right", "data-button": "7" })]),
      h("div", { class: "bumpers" }, [h("span", { class: "bumper left", "data-button": "4" }), h("span", { class: "bumper right", "data-button": "5" })]),
      h("div", { class: "meta", "data-button": "16" }),
      h("div", { class: "arrows" }, [h("span", { class: "select", "data-button": "8" }), h("span", { class: "start", "data-button": "9" })]),
      h("div", { class: "buttons" }, [h("span", { class: "button a", "data-button": "0" }), h("span", { class: "button b", "data-button": "1" }), h("span", { class: "button x", "data-button": "2" }), h("span", { class: "button y", "data-button": "3" })]),
      h("div", { class: "sticks" }, [h("span", { class: "stick left", "data-button": "10" }), h("span", { class: "stick right", "data-button": "11" })]),
      h("div", { class: "dpad" }, [h("span", { class: "face up", "data-button": "12" }), h("span", { class: "face down", "data-button": "13" }), h("span", { class: "face left", "data-button": "14" }), h("span", { class: "face right", "data-button": "15" })])
    ];
    if (kind === "ds4") kids.splice(2, 0, h("div", { class: "touchpad", "data-button": "17" }));
    return h("div", { class: "padinner" }, kids);
  }
  var PAD_NATIVE = { ds4: [806, 598], xboxone: [750, 630] };
  function buildPadDiagram(kind) {
    ensurePadCss();
    var native = PAD_NATIVE[kind];
    var targetW = 560;
    var scale = targetW / native[0];
    var outer = h("div", { class: "padwrap", "data-kind": kind, style: "position:relative;width:" + targetW + "px;max-width:100%;height:" + Math.round(native[1] * scale) + "px;overflow:hidden;flex:none" }, [
      h("div", { style: "transform:scale(" + scale + ");transform-origin:top left" }, [buildPadInner(kind)])
    ]);
    return outer;
  }
  var _padPoll = null;
  function controlesPage(c) {
    var curKind = "ds4";
    var pressedLabel = h("div", { id: "gpPressed", style: "margin-top:16px;font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--muted);text-align:center" }, ["Nenhum botao pressionado"]);
    var kindLabel = h("div", { id: "gpKind", style: "margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);text-align:center;opacity:.7" }, ["Aguardando controle..."]);
    var diagramSlot = h("div", {}, [buildPadDiagram(curKind)]);
    var padBox = h("div", { style: "background:var(--panel);border:1px solid var(--line-soft);border-radius:14px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;max-width:600px" }, [diagramSlot, pressedLabel, kindLabel]);
    var status = h("span", { class: "c", id: "gpCount" }, ["nenhum conectado"]);
    var list = h("div", { class: "rows", id: "gpList", style: "margin-top:14px" }, [h("div", { class: "lrow" }, ["Conecte um controle USB/Bluetooth e aperte qualquer botao."])]);
    c.appendChild(h("div", { class: "sectionhead" }, [h("h4", {}, ["Controles"]), status]));
    c.appendChild(h("div", { style: "display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start" }, [padBox, h("div", { style: "flex:1;min-width:260px" }, [list])]));
    c.appendChild(h("div", { class: "note", html: "<b>Mapeamento automatico.</b> Assim que o controle aparecer aqui ja funciona nos jogos — nao precisa configurar nada a mais. O desenho troca sozinho entre PlayStation e Xbox conforme o controle detectado." }));

    function poll() {
      var gps = Array.from(navigator.getGamepads() || []).filter(Boolean);
      status.textContent = gps.length ? gps.length + " conectado" + (gps.length > 1 ? "s" : "") : "nenhum conectado";
      list.innerHTML = "";
      if (!gps.length) list.appendChild(h("div", { class: "lrow" }, ["Conecte um controle USB/Bluetooth e aperte qualquer botao."]));
      gps.forEach(function (gp) {
        list.appendChild(h("div", { class: "lrow" }, [
          h("div", {}, [h("div", { class: "nm2" }, [gp.id || ("Controle " + (gp.index + 1))]), h("div", { class: "sub2" }, [gp.buttons.length + " botoes · " + gp.axes.length + " eixos"])]),
          h("div", { class: "right" }, [h("span", { class: "pill good" }, ["conectado"])])
        ]));
      });
      var gp = gps[0];
      var kind = gp ? detectPadKind(gp) : "ds4";
      if (kind !== curKind) {
        curKind = kind;
        diagramSlot.innerHTML = "";
        diagramSlot.appendChild(buildPadDiagram(curKind));
      }
      kindLabel.textContent = gp ? (kind === "xboxone" ? "Detectado: controle Xbox" : "Detectado: controle PlayStation / generico") : "Aguardando controle...";
      var labels = PAD_LABELS[curKind];
      var pressedNames = [];
      $$("[data-button]", diagramSlot).forEach(function (el) {
        var i = Number(el.getAttribute("data-button"));
        var btn = gp && gp.buttons[i];
        var isOn = !!(btn && btn.pressed);
        if (isOn && labels[i]) pressedNames.push(labels[i]);
        if (el.classList.contains("trigger")) {
          var val = btn ? btn.value : 0;
          el.style.opacity = val > 0 ? "1" : "0";
          el.style.clipPath = "inset(" + ((1 - val) * 100) + "% 0 0 0)";
        } else {
          el.setAttribute("data-pressed", isOn ? "true" : "false");
        }
      });
      pressedLabel.textContent = pressedNames.length ? "Pressionado: " + pressedNames.join(", ") : "Nenhum botao pressionado";
      _padPoll = requestAnimationFrame(poll);
    }
    poll();
  }
  /* ---------------------------------------------------------------- admin */
  var ADMIN_TABS = [["conexao", "Conexao"], ["licencas", "Licencas"], ["planos", "Planos"], ["pagamentos", "Pagamentos"], ["indicacoes", "Indicacoes"], ["retroanvil", "RetroAnvil"], ["sql", "SQL"]];
  function adminPage(c) {
    c.innerHTML = "";
    if (!S._adminTab) S._adminTab = "conexao";
    var tabs = h("div", { class: "badgerow" }, ADMIN_TABS.map(function (t) {
      return h("span", { class: "chip" + (S._adminTab === t[0] ? " on" : ""), style: "cursor:pointer", onclick: function () { S._adminTab = t[0]; adminPage(c); } }, [t[1]]);
    }));
    var wrap = h("div", { class: "adm" }, []);
    c.appendChild(tabs); c.appendChild(wrap);
    var fn = { conexao: adminConexao, licencas: adminLicencas, planos: adminPlanos, pagamentos: adminPagamentos, indicacoes: adminIndicacoes, retroanvil: adminRetroAnvil, sql: adminSql }[S._adminTab];
    if (fn) fn(wrap);
  }
  function adminConexao(wrap) {
    var cfgCard = h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Configuracao"]), h("pre", { id: "admCfg" }, ["carregando..."])]);
    wrap.appendChild(cfgCard);
    call("adminConfigLoad", undefined, undefined, {}).then(function (cfg) { $("#admCfg").textContent = JSON.stringify(cfg, null, 2); });
    var restOut = h("span", { class: "sub2" }, [""]);
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Teste REST"]),
      h("button", { class: "mini", onclick: function () {
        restOut.textContent = "...";
        call("adminRestQuery", "pix_orders?select=id&limit=1", undefined, { success: false }).then(function (r) { restOut.textContent = r && r.success ? "Conexao OK" : "Erro: " + (r && r.error); });
      } }, ["Pingar pix_orders"]), " ", restOut]));
  }
  function adminSql(wrap) {
    var ta = h("textarea", { placeholder: "SELECT ... FROM ... LIMIT 20" });
    var out = h("pre", { id: "admSql" }, ["—"]);
    function run(sql) { ta.value = sql; out.textContent = "executando..."; call("adminDbQuery", sql, [], { success: false, error: "IPC ausente" }).then(function (r) { out.textContent = r && r.success ? JSON.stringify(r.rows, null, 2) : "ERRO: " + (r && r.error); }); }
    var quick = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" }, [
      ["Licencas recentes", "SELECT key,nome,plano,ativo,expira_em,created_at FROM keyvortex ORDER BY created_at DESC LIMIT 20"],
      ["Pedidos PIX (24h)", "SELECT txid,license_key,product_name,amount,status,created_at FROM pix_orders WHERE created_at > now()-interval '24 hours' ORDER BY created_at DESC LIMIT 30"],
      ["Resgates pendentes", "SELECT * FROM referral_redemptions WHERE status='pending' ORDER BY created_at DESC LIMIT 20"],
      ["Planos", "SELECT key,name,price,game_limit,bypass,multiplayer,premiumaccounts,nsfw,emuladores,active FROM plans ORDER BY price"]
    ].map(function (q) { return h("button", { class: "mini", onclick: function () { run(q[1]); } }, [q[0]]); }));
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Banco (adminDbQuery — SQL livre, full admin)"]), quick, ta,
      h("button", { class: "mini", style: "margin-top:8px", onclick: function () { run(ta.value.trim()); } }, ["Executar SQL"]), out]));
  }
  // editor generico de 1 linha de tabela: busca por PK, mostra todo campo escalar
  // como input, salva com UPDATE parametrizado. Funciona pra qualquer tabela sem
  // eu precisar saber o schema de antemao.
  function dbRowEditor(wrap, table, pkCol, pkPlaceholder) {
    var keyIn = h("input", { class: "field", placeholder: pkPlaceholder || pkCol, style: "max-width:260px" });
    var status = h("span", { class: "sub2" }, [""]);
    var formBox = h("div", { style: "margin-top:14px" }, []);
    function load() {
      var key = keyIn.value.trim(); if (!key) return;
      status.textContent = "buscando..."; formBox.innerHTML = "";
      call("adminDbQuery", "SELECT * FROM " + table + " WHERE " + pkCol + " = $1 LIMIT 1", [key], { success: false }).then(function (r) {
        if (!r.success || !r.rows || !r.rows.length) { status.textContent = "nao encontrado" + (r.error ? " (" + r.error + ")" : ""); return; }
        status.textContent = ""; renderForm(r.rows[0]);
      });
    }
    function renderForm(row) {
      formBox.innerHTML = "";
      var grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px" });
      var inputs = {};
      Object.keys(row).forEach(function (k) {
        var v = row[k];
        if (v !== null && typeof v === "object") return; // pula json/array
        var box = h("div", {}, [h("label", { class: "lb", style: "margin-top:0" }, [k + (k === pkCol ? " (chave)" : "")]),
          h("input", { class: "field", value: v == null ? "" : String(v), disabled: k === pkCol ? "1" : null })]);
        inputs[k] = box.querySelector("input");
        grid.appendChild(box);
      });
      formBox.appendChild(grid);
      formBox.appendChild(h("button", { class: "btn pri", style: "margin-top:14px", onclick: function () {
        var sets = [], vals = [], i = 1;
        Object.keys(inputs).forEach(function (k) {
          if (k === pkCol) return;
          sets.push(k + "=$" + i); vals.push(inputs[k].value === "" ? null : inputs[k].value); i++;
        });
        vals.push(row[pkCol]);
        call("adminDbQuery", "UPDATE " + table + " SET " + sets.join(",") + " WHERE " + pkCol + "=$" + i, vals, { success: false }).then(function (r) {
          toast(r.success ? "Salvo" : "Erro: " + r.error);
        });
      } }, ["Salvar alteracoes"]));
    }
    keyIn.addEventListener("keydown", function (e) { if (e.key === "Enter") load(); });
    wrap.appendChild(h("div", { class: "acard" }, [
      h("h4", { style: "margin-bottom:8px" }, [table]),
      h("div", { style: "display:flex;gap:8px;align-items:center" }, [keyIn, h("button", { class: "mini", onclick: load }, ["Buscar"]), status]),
      formBox
    ]));
  }
  function adminLicencas(wrap) {
    wrap.appendChild(h("div", { class: "note", html: "<b>Busca por chave.</b> Edite qualquer campo (plano, ativo, expira_em, emuladores, nsfw, multiplayer, premiumaccounts, add_games, game_limit...) e salve." }));
    dbRowEditor(wrap, "keyvortex", "key", "CHAVE-DA-LICENCA");
  }
  function adminPlanos(wrap) {
    var out = h("pre", {}, ["carregando..."]);
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Planos ativos"]), out]));
    call("adminDbQuery", "SELECT key,name,price,game_limit,bypass,multiplayer,premiumaccounts,nsfw,emuladores,add_games,active FROM plans ORDER BY price", [], { success: false }).then(function (r) {
      out.textContent = r.success ? JSON.stringify(r.rows, null, 2) : "Erro: " + r.error;
    });
    wrap.appendChild(h("div", { class: "note", html: "<b>Editar um plano.</b> Busca pela chave (ex: <span class='mono'>licenca_vitalicia</span>) e altera qualquer campo." }));
    dbRowEditor(wrap, "plans", "key", "chave do plano");
  }
  function adminPagamentos(wrap) {
    var out = h("pre", {}, ["carregando..."]);
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Pedidos PIX/Cartao (24h)"]), out]));
    call("adminDbQuery", "SELECT txid,license_key,product_name,amount,status,payment_method,created_at FROM pix_orders WHERE created_at > now()-interval '24 hours' ORDER BY created_at DESC LIMIT 50", [], { success: false }).then(function (r) {
      out.textContent = r.success ? JSON.stringify(r.rows, null, 2) : "Erro: " + r.error;
    });
    dbRowEditor(wrap, "pix_orders", "txid", "TXID do pedido");
  }
  function adminIndicacoes(wrap) {
    var out = h("pre", {}, ["carregando..."]);
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Resgates pendentes"]), out,
      h("div", { style: "margin-top:8px;font-size:11px;color:var(--text-faint)" }, ["Aprovar/rejeitar: busca o id abaixo e edita o campo status."])]));
    call("adminDbQuery", "SELECT * FROM referral_redemptions WHERE status='pending' ORDER BY created_at DESC LIMIT 30", [], { success: false }).then(function (r) {
      out.textContent = r.success ? JSON.stringify(r.rows, null, 2) : "Erro: " + r.error;
    });
    dbRowEditor(wrap, "referral_redemptions", "id", "ID do resgate");
  }
  function adminRetroAnvil(wrap) {
    var status = h("pre", {}, ["carregando..."]);
    var pathIn = h("input", { class: "field", value: "\\\\192.168.5.40\\roms\\ARENABOX\\sistema\\roms", style: "font-family:'IBM Plex Mono';font-size:12px" });
    wrap.appendChild(h("div", { class: "note", style: "border-left-color:var(--steel)", html:
      "<b>Apontar direto pro servidor (LAN).</b> Se este PC esta na mesma rede do R210, aponta a pasta de ROMs pro compartilhamento de rede — joga direto de la, sem baixar/extrair cada jogo antes.<br><br>" +
      "<b>Aviso real:</b> emuladores <i>libretro</i> (a maioria dos consoles de cartucho/arcade) costumam abrir <span class='mono'>.7z</span> direto. Emuladores standalone (PCSX2/PS2, Dolphin/GameCube-Wii) geralmente NAO abrem .7z — para esses, o download+extracao normal continua sendo necessario." }));
    wrap.appendChild(h("div", { class: "acard" }, [
      h("h4", { style: "margin-bottom:8px" }, ["Caminho atual"]), status,
      h("label", { class: "lb" }, ["Caminho de rede (UNC)"]), pathIn,
      h("div", { style: "display:flex;gap:8px;margin-top:10px" }, [
        h("button", { class: "btn pri", onclick: function () {
          call("arenaRomsPathSetManual", pathIn.value.trim(), undefined, { success: false }).then(function (r) {
            toast(r.success ? "Apontado pro servidor" : (r.error || "Falha"));
            refresh();
          });
        } }, ["Usar este caminho"]),
        h("button", { class: "btn", onclick: function () { call("arenaRomsPathSet").then(function () { toast("Pasta local escolhida"); refresh(); }); } }, ["Escolher pasta local..."]),
        h("button", { class: "btn", onclick: function () { call("arenaRomsPathReset").then(function () { toast("Voltou ao padrao"); refresh(); }); } }, ["Resetar p/ padrao"])
      ])
    ]));
    function refresh() { call("arenaRomsPathGet", undefined, undefined, {}).then(function (r) { status.textContent = JSON.stringify(r, null, 2); }); }
    refresh();
  }

  /* --------------------------------------------------------- card grid */
  function fillGrid(grid, list, ctx) {
    grid.innerHTML = "";
    var cc = $("#cCount");
    if (cc) cc.textContent = list.length + (ctx === "bypass" ? " bypasses" : ctx === "retro" ? " ROMs" : ctx === "denuvo" ? " jogos" : " titulos");
    if (!list.length) { grid.appendChild(h("div", { class: "empty" }, ["Nada encontrado."])); return; }
    list.forEach(function (it) { grid.appendChild(gameCard(it, ctx)); });
  }
  // catalogo local pode ter dezenas de milhares de itens - renderiza em paginas
  // e carrega mais conforme o scroll chega perto do fim (sem cortar a lista).
  function fillGridPaged(grid, fullList, ctx) {
    grid.innerHTML = "";
    var cc = $("#cCount");
    if (cc) cc.textContent = fullList.length + (ctx === "bypass" ? " bypasses" : ctx === "retro" ? " ROMs" : ctx === "denuvo" ? " jogos" : " titulos");
    if (!fullList.length) { grid.appendChild(h("div", { class: "empty" }, ["Nada encontrado."])); return; }
    var PAGE = 240, shown = 0;
    function more() {
      fullList.slice(shown, shown + PAGE).forEach(function (it) { grid.appendChild(gameCard(it, ctx)); });
      shown = Math.min(shown + PAGE, fullList.length);
      if (shown < fullList.length) grid.appendChild(more._sentinel = (more._sentinel || h("div", { class: "empty", style: "grid-column:1/-1" }, [h("span", { class: "spin" }), " carregando mais..."])));
      else if (more._sentinel) { more._sentinel.remove(); more._sentinel = null; }
    }
    more();
    var host = $(".content");
    if (host._pagedScroll) host.removeEventListener("scroll", host._pagedScroll);
    host._pagedScroll = function () {
      if (shown >= fullList.length) return;
      if (host.scrollTop + host.clientHeight > host.scrollHeight - 900) {
        if (more._sentinel) more._sentinel.remove();
        more();
      }
    };
    host.addEventListener("scroll", host._pagedScroll);
  }
  function gameCard(it, ctx) {
    var p = pal(hash(it.name));
    var dl = S.downloads[it.id];
    var stKey = dl ? "dl" : it.st;
    var stTxt = ({ ok: "Instalado", upd: "Atualizar", get: ctx === "retro" ? "Baixar" : ctx === "denuvo" ? "Comprar" : "Instalar", na: "Indisp.", dl: "Baixando" })[stKey] || "";
    var actTxt = ({ ok: "Jogar", upd: "Atualizar", get: ctx === "retro" ? "Baixar" : ctx === "denuvo" ? "Comprar" : "Instalar", na: "Nao disponivel", dl: dl ? Math.round(dl.pct) + "%" : "..." })[stKey];
    var art = h("div", { class: "art", style: "--a1:" + p[0] + ";--a2:" + p[1], onclick: function () { if (ctx === "steam" || ctx === "bypass") openDrawer(it, ctx); } }, [
      h("span", { class: "st " + stKey }, [stTxt]),
      h("span", { class: "k" }, [ctx === "retro" ? (it.rom ? it.rom.console.toUpperCase() : "ROM") : ("APPID " + it.id)])
    ]);
    if (ctx === "steam" || ctx === "bypass") { var im = new Image(); im.onload = function () { art.style.backgroundImage = "url(" + capFor(it.id) + ")"; }; im.src = capFor(it.id); }
    var actBtn = h("button", { class: "act" + (stKey === "na" ? " na" : "") + (stKey === "dl" ? " busy" : "") }, [actTxt]);
    var meta = h("div", { class: "meta" }, [h("div", { class: "nm", title: it.name }, [it.name]), actBtn]);
    if (dl) meta.appendChild(h("div", { class: "prog" }, [h("i", { style: "width:" + dl.pct + "%" })]));
    var card = h("article", { class: "gcard cut cut-sm", "data-id": it.id }, [art, meta]);
    actBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (stKey === "na" || stKey === "dl") return;
      if (stKey === "ok") return playIt(it, ctx);
      if (ctx === "denuvo") return denuvoBuy(it.denuvo);
      startInstall(it, ctx, card);
    });
    return card;
  }
  // le os controles conectados (Gamepad API do Chromium) no formato que o main
  // espera pra montar os args -pN* do emulatorLauncher.exe - mapeamento e
  // automatico (guid sintetico por vendor/produto, ou XInput padrao).
  function liveGamepads() {
    try {
      return Array.from(navigator.getGamepads() || []).filter(Boolean).map(function (gp) {
        return { index: gp.index, id: gp.id, buttonCount: gp.buttons.length, axisCount: gp.axes.length };
      });
    } catch (e) { return []; }
  }
  function playIt(it, ctx) {
    if (ctx === "retro" && it.rom && E.arenaLaunchGame) {
      var gps = liveGamepads();
      toast(it.name + " — abrindo..." + (gps.length ? " (" + gps.length + " controle" + (gps.length > 1 ? "s" : "") + ")" : ""));
      var off = E.onArenaEmuProgress ? E.onArenaEmuProgress(function (p) { toast("Preparando emulador " + pctOf(p) + "%"); }) : null;
      E.arenaLaunchGame({ system: it.rom.console, file: it.rom.file, gamepads: gps }).then(function (r) {
        if (off) try { off(); } catch (e) {}
        if (!r || !r.success) toast((r && r.error) || "Falha ao abrir");
      });
    } else toast(it.name + " — abra pela Steam");
  }

  /* ------------------------------------------------------------ install */
  function startInstall(it, ctx, card) {
    if (S.downloads[it.id]) return;
    if ((ctx === "steam") && !S.myGames.has(it.id) && !can("game_limit_ok")) {
      return toast("Limite do seu plano: " + S.plan.game_limit + " jogos. Veja a Loja para aumentar.");
    }
    var d = { name: it.name, pct: 0, phase: ctx === "retro" ? "rom" : ctx === "bypass" ? "bypass" : "lua" };
    S.downloads[it.id] = d; renderHud();
    var st = card && $(".st", card), act = card && $(".act", card), barI;
    if (st) { st.className = "st dl"; st.textContent = "Baixando"; }
    if (act) { act.className = "act busy"; act.textContent = "0%"; }
    if (card && !$(".prog", card)) $(".meta", card).appendChild(h("div", { class: "prog" }, [h("i", { style: "width:0" })]));
    barI = card && $(".prog i", card);
    function step(pct) { d.pct = Math.max(d.pct, Math.min(100, pct || 0)); if (barI) barI.style.width = d.pct + "%"; if (act) act.textContent = Math.round(d.pct) + "%"; renderHud(); }
    function done(ok, err) {
      delete S.downloads[it.id]; renderHud();
      if (ok) {
        S.myGames.add(it.id);
        if (st) { st.className = "st ok"; st.textContent = "Instalado"; }
        if (act) { act.className = "act"; act.textContent = "Jogar"; }
        var pr = card && $(".prog", card); if (pr) pr.remove();
        toast(it.name + " — instalado");
      } else {
        if (st) { st.className = "st " + it.st; st.textContent = ({ get: ctx === "retro" ? "Baixar" : "Instalar" })[it.st] || ""; }
        if (act) { act.className = "act"; act.textContent = ctx === "retro" ? "Baixar" : "Instalar"; }
        var pr2 = card && $(".prog", card); if (pr2) pr2.remove();
        toast(err || "Este jogo ainda nao esta disponivel para instalacao.");
      }
    }
    if (ctx === "retro" && it.rom && E.arenaRomsDownloadGame) {
      var offp = E.onArenaRomsDownloadProgress ? E.onArenaRomsDownloadProgress(function (p) { if (!p || !p.file || p.file === it.rom.file) step(pctOf(p)); }) : null;
      E.arenaRomsDownloadGame(it.rom.console, it.rom.file).then(function (r) { if (offp) try { offp(); } catch (e) {} done(!!(r && r.success), r && r.error); })
        .catch(function () { if (offp) try { offp(); } catch (e) {} done(false); });
    } else if (ctx === "bypass" && it.bypass) {
      call("bypassPickFolder", undefined, undefined, null).then(function (f) {
        var folder = f && (f.path || (typeof f === "string" ? f : (f.success && f.folder)));
        if (!folder || (f && f.canceled)) return done(false, "Selecione a pasta do jogo");
        var offb = E.on ? E.on("bypass-progress", function (p) { step(pctOf(p)); }) : null;
        call("bypassExtract", it.bypass.href, folder, { success: false }).then(function (r) {
          if (offb && E.off) try { E.off("bypass-progress", offb); } catch (e) {}
          done(!!(r && (r.success || r.ok)), r && r.error);
        });
      });
    } else {
      step(8);
      var tick = setInterval(function () { step(Math.min(90, d.pct + 6 + Math.random() * 10)); }, 400);
      // downloadManifestorLua(appid, name, skipRestart, servidor). servidor=2 => base local (ALMAZ) primeiro.
      (E.downloadManifestorLua ? E.downloadManifestorLua(it.id, it.name, false, 2) : Promise.resolve({ success: false })).then(function (r) {
        clearInterval(tick);
        if (r && r.success) { step(100); setTimeout(function () { done(true); }, 200); }
        else done(false, r && r.error);
      }).catch(function () { clearInterval(tick); done(false); });
    }
  }

  /* ------------------------------------------------------------ drawer */
  function openDrawer(it, ctx) {
    var dr = $("#drawer");
    if (!dr) { dr = buildDrawer(); document.body.appendChild(dr); }
    dr.dataset.id = it.id;
    var p = pal(hash(it.name));
    var head = $("#dHead"), body = $("#dBody");
    head.innerHTML = "<button class='close' data-close>✕</button>";
    head.style.setProperty("--a1", p[0]); head.style.setProperty("--a2", p[1]);
    head.style.backgroundImage = (ctx === "steam" || ctx === "bypass") ? "url(" + capFor(it.id) + ")" : "";
    $$("[data-close]", dr).forEach(function (x) { x.onclick = closeDrawer; });
    var inst = S.myGames.has(it.id);
    body.innerHTML = "";
    body.appendChild(h("h3", {}, [it.name]));
    body.appendChild(h("div", { class: "dmeta", id: "dMeta" }, [h("span", {}, ["APPID " + it.id]), h("span", {}, [ctx === "bypass" ? "Bypass" : "Base local"])]));
    body.appendChild(h("p", { id: "dDesc" }, [ctx === "bypass"
      ? "Fix de bypass. Selecione a pasta do jogo para aplicar."
      : "Instala pela base local (Servidor 2): adiciona o .lua na Steam e libera pra jogar."]));
    var shots = h("div", { class: "shots", id: "dShots" }, []);
    body.appendChild(shots);
    var cta = h("div", { class: "cta" }, [
      inst ? h("button", { class: "go", onclick: function () { playIt(it, ctx); } }, ["Jogar"])
           : h("button", { class: "go", onclick: function () { closeDrawer(); S.page === "bypass" ? startInstall(it, "bypass", cardById(it.id)) : startInstall(it, "steam", cardById(it.id)); } }, [ctx === "bypass" ? "Aplicar bypass" : "Instalar"]),
      h("button", { onclick: function () { openUrl("https://store.steampowered.com/app/" + it.id); } }, ["Ver na Steam"])
    ]);
    body.appendChild(cta);
    dr.classList.add("on");
    if (ctx === "steam" || ctx === "bypass") call("getGameDetails", it.id, undefined, { success: false }).then(function (d) {
      if (!d || !d.success) return;
      if (d.shortDescription) $("#dDesc").textContent = d.shortDescription;
      var m = $("#dMeta");
      if (d.genres && d.genres.length) m.appendChild(h("span", {}, [d.genres.slice(0, 3).join(" / ")]));
      if (d.releaseDate) m.appendChild(h("span", {}, [d.releaseDate]));
      (d.screenshots || []).slice(0, 8).forEach(function (s) { var im = h("img", { src: s.thumb || s.full, loading: "lazy" }); shots.appendChild(im); });
      if (d.trailerUrl && HAS_HLS) playTrailer(head, d.trailerUrl);
    });
  }
  function playTrailer(head, url) {
    try {
      var v = h("video", { autoplay: "1", muted: "1", loop: "1", playsinline: "1" });
      head.insertBefore(v, head.firstChild);
      if (/\.m3u8/.test(url) && window.Hls && window.Hls.isSupported()) { var hls = new window.Hls(); hls.loadSource(url); hls.attachMedia(v); }
      else v.src = url;
    } catch (e) {}
  }
  function buildDrawer() {
    return h("div", { class: "drawer", id: "drawer" }, [
      h("div", { class: "veil", "data-close": "1" }),
      h("div", { class: "panel" }, [h("div", { class: "dhead", id: "dHead" }, []), h("div", { class: "dbody", id: "dBody" }, [])])
    ]);
  }
  function closeDrawer() { var d = $("#drawer"); if (d) { d.classList.remove("on"); var v = $("#dHead video"); if (v) v.remove(); } }
  function cardById(id) { return $('.gcard[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }

  /* -------------------------------------------------------------- PIX flow */
  function pixModal(order, checkFn, onPaid) {
    var m = ensureModal();
    m.innerHTML = "";
    var box = h("div", { class: "box cut" }, []);
    m.appendChild(box);
    box.appendChild(h("h3", {}, ["Pagamento PIX"]));
    if (order.qrCodeImage) box.appendChild(h("img", { class: "qr", src: order.qrCodeImage, alt: "QR" }));
    box.appendChild(h("div", { style: "text-align:center;font-family:'Chakra Petch';font-size:20px;margin-bottom:8px" }, [money(order.amount)]));
    if (order.qrCodeText) {
      box.appendChild(h("div", { class: "code" }, [order.qrCodeText]));
      box.appendChild(h("button", { class: "btn", style: "width:100%;margin-top:8px", onclick: function () { copy(order.qrCodeText); toast("Codigo PIX copiado"); } }, ["Copiar codigo PIX"]));
    }
    var stt = h("div", { class: "stt" }, [h("span", { class: "spin" }), " aguardando pagamento..."]);
    box.appendChild(stt);
    box.appendChild(h("div", { class: "btns" }, [h("button", { onclick: hideModal }, ["Fechar"])]));
    m.classList.add("on");
    var tries = 0, timer = setInterval(function () {
      tries++;
      if (tries > 80 || !document.querySelector(".modal.on")) { clearInterval(timer); return; }
      call(checkFn, order.txid, undefined, { paid: false }).then(function (r) {
        if (r && r.paid) {
          clearInterval(timer);
          stt.innerHTML = "";
          stt.appendChild(h("span", { style: "color:var(--good)" }, ["Pagamento confirmado ✓"]));
          setTimeout(function () { hideModal(); if (onPaid) onPaid(r); }, 900);
        }
      });
    }, 4000);
  }
  function pixPoll(txid, checkFn, onPaid) {
    toast("Verificando pagamento...");
    call(checkFn, txid, undefined, { paid: false }).then(function (r) {
      if (r && r.paid) { toast("Pagamento confirmado!"); if (onPaid) onPaid(r); }
      else toast("Ainda nao identificamos o pagamento.");
    });
  }

  /* --------------------------------------------------------- shared UI */
  function stat(k, nHtml, isHtml) { return h("div", { class: "stat" }, [h("div", { class: "k" }, [k]), h("div", { class: "n", html: isHtml ? nHtml : esc(nHtml) })]); }
  // tile clicavel na tela principal pra ligar/desligar o sistema de desbloqueio
  // (a mesma DLL de controle que Configuracoes tambem mexe) - "como antes".
  function statSystemToggle() {
    var box = h("div", { class: "stat", style: "cursor:pointer" }, [
      h("div", { class: "k" }, ["Sistema"]),
      h("div", { class: "n", id: "sysToggleN", html: "<span style='font-size:15px;color:var(--text-faint)'>...</span>" })
    ]);
    function paint(on, busy) {
      box.querySelector("#sysToggleN").innerHTML = busy
        ? "<span class='spin'></span>"
        : "<span style='font-size:16px;color:" + (on ? "var(--good)" : "var(--crit)") + "'>" + (on ? "ATIVO ●" : "DESATIVADO ○") + "</span>";
    }
    call("hidDllStatus", undefined, undefined, {}).then(function (r) { paint(!!(r && r.enabled)); box.dataset.on = (r && r.enabled) ? "1" : "0"; });
    box.addEventListener("click", function () {
      var on = box.dataset.on === "1";
      paint(on, true);
      call(on ? "disableHidDll" : "enableHidDll").then(function () {
        box.dataset.on = on ? "0" : "1"; paint(!on);
        toast(on ? "Sistema desativado" : "Sistema ativado");
      });
    });
    return box;
  }
  function loadingCell() { return h("div", { class: "empty" }, [h("span", { class: "spin" }), " carregando..."]); }
  function mkSearch(ph) {
    var i = h("input", { class: "search", placeholder: ph, value: S.search });
    i.addEventListener("input", debounce(function () {
      S.search = i.value;
      if (S.mode === "retro" && S.page === "home") { var g = $("#grid"); if (g) loadRoms(S.console, g); return; }
      renderPage($("#content"));
      var ni = $(".search"); if (ni) { ni.focus(); ni.value = S.search; ni.setSelectionRange(ni.value.length, ni.value.length); }
    }, 220));
    return i;
  }
  function steamNote() { return h("div", { class: "note", html: "<b>Gamaxy · Steam.</b> Instala pela base local (Servidor 2). O que nao estiver na base aparece como “Nao disponivel”." }); }
  function retroNote() { return h("div", { class: "note", html: "<b>Gamaxy · Retro.</b> ROM baixa comprimida do servidor, o emulador certo vem sob demanda, extrai e abre." }); }
  function pctOf(p) { if (!p) return 0; var v = p.pct != null ? p.pct : (p.percent != null ? p.percent : (p.progress != null ? p.progress : 0)); return Math.round(v > 1 ? v : v * 100); }

  function renderHud() {
    var hud = $("#dlhud");
    if (!hud) { hud = h("div", { class: "dlhud", id: "dlhud" }, []); document.body.appendChild(hud); }
    var ids = Object.keys(S.downloads);
    hud.classList.toggle("on", ids.length > 0);
    hud.innerHTML = "";
    if (!ids.length) return;
    hud.appendChild(h("div", { class: "hh" }, [h("span", { class: "pulse" }), "Downloads · " + ids.length]));
    ids.forEach(function (id) {
      var d = S.downloads[id];
      hud.appendChild(h("div", { class: "it" }, [
        h("div", { class: "tp" }, [h("b", {}, [d.name]), h("span", {}, [Math.round(d.pct) + "%"])]),
        h("div", { class: "bar" }, [h("i", { style: "width:" + d.pct + "%" })]),
        h("small", {}, [d.phase === "rom" ? "baixando ROM" : d.phase === "bypass" ? "aplicando fix" : "instalando na base local"])
      ]));
    });
  }

  var toastT;
  function toast(msg) {
    var t = $("#toast");
    if (!t) { t = h("div", { class: "toast", id: "toast" }, []); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2400);
  }
  function ensureModal() { var m = $("#modal"); if (!m) { m = h("div", { class: "modal", id: "modal" }, []); document.body.appendChild(m); } return m; }
  function showModal(title, body, btns) {
    var m = ensureModal(); m.innerHTML = "";
    m.appendChild(h("div", { class: "box cut" }, [
      h("h3", {}, [title || ""]),
      h("div", { class: "txt" }, [body || ""]),
      h("div", { class: "btns" }, (btns || [{ t: "Fechar", act: hideModal }]).map(function (b) { return h("button", { class: b.pri ? "pri" : "", onclick: b.act }, [b.t]); }))
    ]));
    m.classList.add("on");
  }
  function hideModal() { var m = $("#modal"); if (m) m.classList.remove("on"); }
  function showTerms() {
    showModal("Termos de Uso", "Para usar o Gamaxy voce precisa aceitar os Termos de Uso e a Politica de Privacidade.\n\nO uso e pessoal e vinculado ao seu HWID. Nao redistribua sua licenca.", [
      { t: "Recusar", act: function () { hideModal(); logout("Voce precisa aceitar os termos."); } },
      { t: "Aceitar e continuar", pri: true, act: function () {
        svc.termsAccept(S.licenseKey).then(function (r) {
          hideModal();
          if (r && (r.ok || r.accepted || r.success)) postTerms(); else postTerms();
        });
      } }
    ]);
  }
  // HUD de atualizacao: mostra progresso real do download e, quando terminar,
  // deixa o USUARIO escolher a hora de reiniciar (nunca fecha o app sozinho).
  function updateHud(state) {
    var hud = $("#uphud");
    if (!state) { if (hud) hud.remove(); return; }
    if (!hud) {
      hud = h("div", { class: "dlhud on", id: "uphud", style: "left:18px;right:auto" }, []);
      document.body.appendChild(hud);
    }
    hud.innerHTML = "";
    if (state.phase === "downloading") {
      var pct = Math.round(state.percent || 0);
      hud.appendChild(h("div", { class: "hh" }, [h("span", { class: "pulse" }), "Baixando atualizacao " + (state.version ? "v" + state.version : "")]));
      hud.appendChild(h("div", { class: "it" }, [
        h("div", { class: "tp" }, [h("b", {}, ["Gamaxy " + (state.version || "")]), h("span", {}, [pct + "%"])]),
        h("div", { class: "bar" }, [h("i", { style: "width:" + pct + "%" })]),
        h("small", {}, [state.total ? ((state.transferred / 1048576).toFixed(0) + " / " + (state.total / 1048576).toFixed(0) + " MB") : "preparando..."])
      ]));
    } else if (state.phase === "ready") {
      hud.appendChild(h("div", { class: "hh" }, [h("span", { class: "pulse", style: "background:var(--good);box-shadow:0 0 8px 1px var(--good)" }), "Atualizacao pronta"]));
      hud.appendChild(h("div", { class: "it" }, [
        h("div", { class: "nm2", style: "margin-bottom:8px" }, ["Gamaxy " + (state.version || "") + " baixada."]),
        h("div", { style: "display:flex;gap:6px" }, [
          h("button", { class: "mini", style: "flex:1;border-color:var(--good);color:var(--good)", onclick: function () { E.restartAndUpdate && E.restartAndUpdate(); } }, ["Reiniciar agora"]),
          h("button", { class: "mini", style: "flex:1", onclick: function () { updateHud(null); } }, ["Depois"])
        ]),
        h("small", { style: "display:block;margin-top:6px" }, ["Se nao reiniciar agora, aplica sozinha na proxima vez que voce fechar o Gamaxy."])
      ]));
    }
  }
  function confirmLogout() {
    showModal("Sair da conta", "Vai deslogar do Gamaxy neste PC. Sua chave sera esquecida aqui.", [
      { t: "Cancelar", act: hideModal },
      { t: "Sair", pri: true, act: function () { hideModal(); logout(); } }
    ]);
  }
  function openUrl(u) { try { E.openExternalUrl ? E.openExternalUrl(u) : window.open(u, "_blank"); } catch (e) {} }

  /* =============================================================== start */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
