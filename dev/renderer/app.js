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
:root{--ground:#0b0a08;--panel:#14110c;--panel-2:#1b1710;--card:#201b13;--line:#332b1e;--line-soft:#261f16;\
--heat:#ff9d1f;--heat-2:#ffbe5c;--heat-dim:#a35f0c;--steel:#37e0d6;--steel-dim:#0d5f5a;\
--text:#e9ebf2;--text-dim:#8b93a7;--text-faint:#5b6376;--good:#4ade80;--warn:#f5b83d;--crit:#ff4d6a;\
--cut:14px;--accent:var(--heat);color-scheme:dark}\
*{box-sizing:border-box}html,body{margin:0;height:100%}\
body{background:var(--ground);color:var(--text);font-family:'Rajdhani',system-ui,sans-serif;font-size:15px;line-height:1.5;overflow:hidden;-webkit-font-smoothing:antialiased}\
#root{height:100%}h1,h2,h3,h4{font-family:'Chakra Petch','Rajdhani',sans-serif;margin:0;font-weight:600;letter-spacing:.01em}\
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}\
.eyebrow{text-transform:uppercase;letter-spacing:.22em;font-size:11px;font-weight:600;color:var(--text-faint)}\
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
*::-webkit-scrollbar{width:11px;height:11px}\
*::-webkit-scrollbar-track{background:var(--panel-2)}\
*::-webkit-scrollbar-thumb{background:var(--line);border:2px solid var(--panel-2);border-radius:6px}\
*::-webkit-scrollbar-thumb:hover{background:var(--heat-dim)}\
*::-webkit-scrollbar-corner{background:var(--panel-2)}\
.content,.dbody,.modal .box,.rail,.adm pre,.consoles,.drawer .shots{scrollbar-width:thin;scrollbar-color:var(--line) var(--panel-2)}\
\
.lg{width:100%;max-width:390px;display:flex;flex-direction:column;align-items:center;animation:fade .4s ease}\
.lg .logo{width:66px;height:66px;filter:drop-shadow(0 0 22px rgba(255,157,31,.45))}\
.lg .kick{margin:16px 0 6px;font-size:10px;letter-spacing:.24em;color:var(--text-faint);text-transform:uppercase}\
.lg h1{font-size:24px;color:#fff}.lg .sub{font-size:12.5px;color:var(--text-dim);margin-top:6px}\
.lg .panel{margin-top:26px;width:100%;background:var(--panel);border:1px solid var(--line);padding:22px}\
.lg input{width:100%;background:var(--panel-2);border:1px solid var(--line);color:var(--heat-2);padding:13px 14px;font-size:14px;font-weight:600;text-align:center;letter-spacing:.18em;text-transform:uppercase;outline:none}\
.lg input:focus{border-color:var(--heat)}\
.lg .msg-e{margin-top:10px;font-size:11.5px;color:var(--crit);background:color-mix(in srgb,var(--crit) 9%,transparent);border:1px solid color-mix(in srgb,var(--crit) 30%,transparent);padding:8px 10px}\
.lg .msg-o{margin-top:10px;font-size:11.5px;color:var(--good);background:color-mix(in srgb,var(--good) 9%,transparent);border:1px solid color-mix(in srgb,var(--good) 26%,transparent);padding:8px 10px;text-align:center}\
.lg .go{margin-top:14px;width:100%;padding:13px;font-weight:700;font-size:13px;color:#1b1206;background:linear-gradient(135deg,var(--heat-2),var(--heat));border:0}\
.lg .go[disabled]{background:var(--panel-2);color:var(--text-faint);cursor:not-allowed}\
.lg .alt{margin-top:16px;font-size:12px;color:var(--text-dim)}.lg .alt b{color:var(--heat);cursor:pointer}\
.foot{position:absolute;bottom:12px;width:100%;text-align:center;font-size:10px;letter-spacing:.08em;color:var(--text-faint)}\
.screen.auth{background:radial-gradient(ellipse 70% 60% at 50% 40%,color-mix(in srgb,var(--heat) 8%,transparent),transparent 70%),var(--ground)}\
.screen.auth::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(color-mix(in srgb,var(--line) 30%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--line) 30%,transparent) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse 62% 62% at 50% 42%,#000 25%,transparent 78%);mask-image:radial-gradient(ellipse 62% 62% at 50% 42%,#000 25%,transparent 78%)}\
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
.hudbar{display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--ground) 60%,transparent)}\
.hudbar .mk{font-family:'Chakra Petch';font-weight:700;letter-spacing:.18em;font-size:16px}\
.hudbar .rd{margin-left:auto;display:flex;gap:22px}\
.rd i{font-style:normal;display:block}.rd .k{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-faint)}.rd .v{font-size:12px}\
.dot{width:7px;height:7px;border-radius:50%;background:var(--good);box-shadow:0 0 9px 1px var(--good);display:inline-block;margin-right:6px}\
.chooser{padding:50px 40px 30px;text-align:center}\
.chooser h1{font-size:clamp(26px,4vw,44px);font-weight:700}\
.chooser h1 .fx{color:var(--heat);text-shadow:0 0 28px color-mix(in srgb,var(--heat) 45%,transparent)}\
.chooser .sub{color:var(--text-dim);margin-top:10px;font-size:15px}\
.worlds{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:36px;text-align:left}\
@media(max-width:780px){.worlds{grid-template-columns:1fr}}\
.world{position:relative;overflow:hidden;border:1px solid var(--line);background:var(--panel-2);padding:28px 26px;min-height:250px;display:flex;flex-direction:column;transition:border-color .15s,transform .15s}\
.world:hover{transform:translateY(-3px)}\
.world.steam:hover{border-color:color-mix(in srgb,var(--heat) 55%,var(--line))}\
.world.retro:hover{border-color:color-mix(in srgb,var(--steel) 55%,var(--line))}\
.world .tag{font-family:'IBM Plex Mono';font-size:10px;letter-spacing:.2em}\
.world.steam .tag{color:var(--heat)}.world.retro .tag{color:var(--steel)}\
.world h2{font-size:28px;font-weight:700;margin-top:8px}\
.world p{color:var(--text-dim);margin:12px 0 0;max-width:38ch;font-size:13.5px}\
.world ul{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:6px}\
.world li{font-size:12.5px;color:var(--text-dim);padding-left:15px;position:relative}\
.world li::before{content:'';position:absolute;left:0;top:8px;width:6px;height:6px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}\
.world.steam li::before{background:var(--heat)}.world.retro li::before{background:var(--steel)}\
.world .go{margin-top:auto;align-self:flex-start;border:1px solid var(--line);padding:11px 22px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;font-size:12px}\
.world.steam .go{border-color:color-mix(in srgb,var(--heat) 55%,var(--line));color:var(--heat-2)}\
.world.retro .go{border-color:color-mix(in srgb,var(--steel) 55%,var(--line));color:var(--steel)}\
.world.locked{filter:grayscale(.65);opacity:.55}\
.world .lk{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:color-mix(in srgb,var(--ground) 55%,transparent)}\
.world .lk span{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim)}\
.efoot{display:flex;justify-content:space-between;padding:13px 22px;border-top:1px solid var(--line);color:var(--text-faint);font-size:10px;letter-spacing:.14em;text-transform:uppercase}\
.efoot span{cursor:pointer}\
\
.app{position:absolute;inset:40px 0 0 0;display:grid;grid-template-columns:224px 1fr}\
@media(max-width:900px){.app{grid-template-columns:66px 1fr}.rail .lbl,.rail .grp,.rail .who span,.rail .logo span{display:none}}\
.rail{border-right:1px solid var(--line);background:var(--panel-2);display:flex;flex-direction:column;padding:14px 0;overflow:auto}\
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
.main{display:flex;flex-direction:column;min-width:0}\
.topbar{display:flex;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--ground) 45%,transparent)}\
.topbar h3{font-size:14px;letter-spacing:.14em;text-transform:uppercase}\
.topbar .exit{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);border:1px solid var(--line);padding:6px 11px}\
.topbar .exit:hover{color:var(--text)}\
.switch{display:flex;border:1px solid var(--line);margin-left:6px}\
.switch button{padding:7px 14px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)}\
.switch button.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text)}\
.content{padding:22px;overflow:auto;flex:1}\
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
  function boot() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
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
    try {
      if (E.onUpdateNotAvailable) E.onUpdateNotAvailable(proceed);
      if (E.onUpdateError) E.onUpdateError(proceed);
      if (E.onUpdateAvailable) E.onUpdateAvailable(function (info) { showUpdateModal(info); });
    } catch (e) {}
    if (E.bootCheckUpdates) { try { E.bootCheckUpdates(); } catch (e) {} setTimeout(proceed, 7000); }
    else proceed();
    setTimeout(proceed, 12000);
  }

  function afterBoot(tries) {
    tries = tries || 0;
    var saved = svc.getSaved();
    if (!saved) return go("login");
    if (!S.hwid && tries < 12) { mount(bootView("Preparando...")); return void setTimeout(function () { afterBoot(tries + 1); }, 500); }
    mount(bootView("Verificando licenca..."));
    // regra: so entra sem passar pelo login se o banco confirmar licenca ATIVA + vinculada a este HWID.
    svc.checkStatus(saved).then(function (r) {
      if (r && r.active === true) { S.licenseKey = saved.toUpperCase(); authed(); }
      else { svc.clear(); go("login", { msg: (r && r.message) || "Faca login para continuar." }); }
    });
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
    var v = h("div", { class: "screen auth" }, [starfield(), h("div", { class: "mid" }, [
      h("div", { class: "frame cut" }, [
        h("div", { class: "hudbar" }, [
          h("span", { class: "mk", html: "GAMAXY" }),
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
        ["__g", "Sistema"], ["config", "Configuracoes", "cog"]]
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
    instalados: "Instalados", emu: "Emuladores", solicitar: "Solicitar Jogo", pasta: "Pasta de ROMs", admin: "Painel Admin", cadastro: "Criar cadastro" };
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
       stat("Base local", "<span style='font-size:16px'>ativa</span>", 1)].forEach(function (x) { stripEl.appendChild(x); });
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
      var list = src.filter(function (g) { return (!q || (g.name || "").toLowerCase().indexOf(q) >= 0) && !nsfwHide(g.name); }).slice(0, 400)
        .map(function (g) { var id = String(g.appid || g.id); return { name: g.name, id: id, st: S.myGames.has(id) ? "ok" : "get" }; });
      fillGrid(grid, list, "steam");
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
      var list = src.filter(function (g) { return NSFW_RE.test(g.name || "") && (!q || (g.name || "").toLowerCase().indexOf(q) >= 0); }).slice(0, 400)
        .map(function (g) { var id = String(g.appid || g.id); return { name: g.name, id: id, st: S.myGames.has(id) ? "ok" : "get" }; });
      fillGrid(grid, list, "steam");
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

  /* ---------------------------------------------------------------- admin */
  function adminPage(c) {
    c.innerHTML = "";
    var wrap = h("div", { class: "adm" }, []); c.appendChild(wrap);
    var cfgCard = h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Configuracao"]), h("pre", { id: "admCfg" }, ["carregando..."])]);
    wrap.appendChild(cfgCard);
    call("adminConfigLoad", undefined, undefined, {}).then(function (cfg) { $("#admCfg").textContent = JSON.stringify(cfg, null, 2); });
    var restOut = h("span", { class: "sub2" }, [""]);
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Teste REST"]),
      h("button", { class: "mini", onclick: function () {
        restOut.textContent = "...";
        call("adminRestQuery", "pix_orders?select=id&limit=1", undefined, { success: false }).then(function (r) { restOut.textContent = r && r.success ? "Conexao OK" : "Erro: " + (r && r.error); });
      } }, ["Pingar pix_orders"]), " ", restOut]));
    var ta = h("textarea", { placeholder: "SELECT ... FROM ... LIMIT 20" });
    var out = h("pre", { id: "admSql" }, ["—"]);
    function run(sql) { ta.value = sql; out.textContent = "executando..."; call("adminDbQuery", sql, [], { success: false, error: "IPC ausente" }).then(function (r) { out.textContent = r && r.success ? JSON.stringify(r.rows, null, 2) : "ERRO: " + (r && r.error); }); }
    var quick = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" }, [
      ["Licencas recentes", "SELECT key,nome,plano,ativo,expira_em,created_at FROM keyvortex ORDER BY created_at DESC LIMIT 20"],
      ["Pedidos PIX (24h)", "SELECT txid,license_key,product_name,amount,status,created_at FROM pix_orders WHERE created_at > now()-interval '24 hours' ORDER BY created_at DESC LIMIT 30"],
      ["Resgates pendentes", "SELECT * FROM referral_redemptions WHERE status='pending' ORDER BY created_at DESC LIMIT 20"],
      ["Planos", "SELECT key,name,price,game_limit,bypass,multiplayer,premiumaccounts,nsfw,emuladores,active FROM plans ORDER BY price"]
    ].map(function (q) { return h("button", { class: "mini", onclick: function () { run(q[1]); } }, [q[0]]); }));
    wrap.appendChild(h("div", { class: "acard" }, [h("h4", { style: "margin-bottom:8px" }, ["Banco (adminDbQuery — full admin)"]), quick, ta,
      h("button", { class: "mini", style: "margin-top:8px", onclick: function () { run(ta.value.trim()); } }, ["Executar SQL"]), out]));
  }

  /* --------------------------------------------------------- card grid */
  function fillGrid(grid, list, ctx) {
    grid.innerHTML = "";
    var cc = $("#cCount");
    if (cc) cc.textContent = list.length + (ctx === "bypass" ? " bypasses" : ctx === "retro" ? " ROMs" : ctx === "denuvo" ? " jogos" : " titulos");
    if (!list.length) { grid.appendChild(h("div", { class: "empty" }, ["Nada encontrado."])); return; }
    list.forEach(function (it) { grid.appendChild(gameCard(it, ctx)); });
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
  function playIt(it, ctx) {
    if (ctx === "retro" && it.rom && E.arenaLaunchGame) {
      toast(it.name + " — abrindo...");
      var off = E.onArenaEmuProgress ? E.onArenaEmuProgress(function (p) { toast("Preparando emulador " + pctOf(p) + "%"); }) : null;
      E.arenaLaunchGame({ system: it.rom.console, file: it.rom.file }).then(function (r) {
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
  function showUpdateModal(info) {
    showModal("Atualizacao disponivel", "Uma nova versao (" + ((info && info.version) || "") + ") esta sendo baixada. Voce pode continuar; ela aplica quando reiniciar.", [{ t: "Ok", pri: true, act: hideModal }]);
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
