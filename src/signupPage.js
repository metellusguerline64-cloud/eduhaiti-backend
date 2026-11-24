// Single-file HTML/JS/CSS interface, same convention as school.html —
// calls this Worker's own registerAccount, getProvisioningStatus, and
// checkSubdomainAvailable actions (see src/actions/accounts.js). Exported as a string so the Worker
// can serve it directly with zero build step; move to Cloudflare Pages
// later (blueprint Section 2) without changing anything below the <script>.

export const SIGNUP_PAGE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Meigens Tech — Créer un compte</title>
<style>
  :root {
    --ink: #14213d;
    --accent: #2a6f6f;
    --accent-dark: #1d4f4f;
    --bg: #f5f2ea;
    --card: #ffffff;
    --error: #b3261e;
    --ok: #1e6b3a;
    --border: #e2ddd0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 460px;
    background: var(--card);
    border-radius: 16px;
    padding: 32px 28px;
    box-shadow: 0 10px 40px rgba(20, 33, 61, 0.08);
    border: 1px solid var(--border);
  }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .sub { color: #6b6456; font-size: 0.92rem; margin: 0 0 24px; }
  form { display: none; flex-direction: column; gap: 14px; }
  form.active { display: flex; }
  label { font-size: 0.82rem; font-weight: 600; color: #4a4438; margin-bottom: 4px; display: block; }
  input, select {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
    font-size: 0.95rem; background: #fff; color: var(--ink);
  }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  .hint { font-size: 0.76rem; color: #8a8375; margin-top: 3px; }
  .hint.ok { color: var(--ok); }
  .hint.err { color: var(--error); }
  button.submit {
    margin-top: 6px; background: var(--accent); color: #fff; border: none; border-radius: 9px;
    padding: 12px; font-size: 0.96rem; font-weight: 700; cursor: pointer;
  }
  button.submit:hover { background: var(--accent-dark); }
  button.submit:disabled { opacity: 0.6; cursor: not-allowed; }
  .msg { font-size: 0.88rem; padding: 10px 12px; border-radius: 8px; display: none; }
  .msg.err { background: #fbe9e7; color: var(--error); display: block; }
  .msg.ok { background: #e7f3ea; color: var(--ok); display: block; }
  .result { display: none; margin-top: 4px; }
  #provisioningScreen { display:none; }
  .progressHead { display:flex; justify-content:space-between; align-items:center; font-weight:700; margin:18px 0 8px; }
  .progressTrack { height:12px; width:100%; border-radius:99px; background:#ece8df; overflow:hidden; }
  .progressFill { height:100%; width:0; background:linear-gradient(90deg,var(--accent),#42a58e); border-radius:inherit; transition:width .45s ease; }
  .accountInfo { display:none; margin-top:22px; padding-top:16px; border-top:1px solid var(--border); }
  .progressMeta { font-size:.73rem; color:#8a8375; margin-top:9px; }
  .diagnosticLog { margin-top:16px; border:1px solid var(--border); border-radius:9px; background:#fbfaf7; }
  .diagnosticLog summary { cursor:pointer; padding:10px 12px; font-size:.82rem; font-weight:700; }
  .diagnosticLog pre { margin:0; padding:0 12px 12px; max-height:190px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font: .72rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; color:#514b40; }
  .backSignup { width:100%; margin-top:14px; padding:10px; border:1px solid var(--border); border-radius:9px; background:#fff; color:var(--ink); cursor:pointer; }
  .resumeBox { margin-top:18px; padding-top:14px; border-top:1px solid var(--border); }
  .resumeToggle { display:block; width:100%; border:0; background:none; color:var(--accent-dark); padding:8px 0; margin:2px 0 8px; cursor:pointer; text-decoration:underline; text-align:left; font:inherit; font-size:.86rem; }
  #resumeFields { display:none; margin-top:10px; }
  .result .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  .result .row span:first-child { color: #8a8375; }
  .result .row span:last-child { font-weight: 600; }
  .result a.launch {
    display: block; text-align: center; margin-top: 16px; background: var(--accent); color: #fff;
    text-decoration: none; padding: 12px; border-radius: 9px; font-weight: 700;
  }
  .logoRow { display: flex; align-items: center; gap: 12px; }
  .logoPreview {
    width: 56px; height: 56px; border-radius: 12px; border: 1px dashed var(--border);
    background: var(--bg); display: flex; align-items: center; justify-content: center;
    overflow: hidden; flex-shrink: 0; color: #8a8375; font-size: 0.7rem; text-align: center;
  }
  .logoPreview img { width: 100%; height: 100%; object-fit: cover; }
  select:disabled { color: #8a8375; background: var(--bg); }
</style>
</head>
<body>
  <div class="card">
    <h1>Meigens Tech</h1>
    <p class="sub">Créez le compte de votre organisation en quelques étapes.</p>

    <form id="signupForm" class="active">
      <div>
        <label>Type d'organisation</label>
        <select name="orgType" id="orgTypeSelect" required>
          <option value="SCHOOL">École</option>
          <option value="CHURCH">Église</option>
          <option value="BUSINESS">Entreprise</option>
          <option value="HOTEL">Hôtel</option>
          <option value="CARNET_EPARGNE">Carnet d'épargne</option>
        </select>
      </div>
      <div id="schoolInstitutionTypeWrap">
        <label>Type d’établissement scolaire</label>
        <select name="institutionType" id="institutionTypeSelect">
          <option value="classique">Établissement classique</option>
          <option value="university">Université</option>
          <option value="vocational">Établissement professionnel</option>
          <option value="general" selected>Tout — établissement polyvalent</option>
        </select>
        <div class="hint">Ce choix adapte les sections, les cycles et les modules proposés. Vous pourrez le modifier plus tard dans les paramètres de l’établissement.</div>
      </div>
      <div>
        <label>Nom de l'organisation</label>
        <input type="text" name="businessName" required placeholder="Ex: Meigens Learning Center" />
        <div class="hint" id="subdomainHint"></div>
      </div>
      <div>
        <label>Nom de l’application installée</label>
        <input type="text" name="appName" id="appNameInput" required maxlength="50" placeholder="Ex: Meigens Learning Center" />
        <div class="hint">Ce nom apparaîtra sous l’icône de l’application installée.</div>
      </div>
      <div>
        <label>Email</label>
        <input type="email" name="email" required placeholder="admin@ecole.ht" />
      </div>
      <div>
        <label>Téléphone</label>
        <input type="tel" name="phone" placeholder="+509 ..." required />
        <div class="hint">Ce numéro servira uniquement pour la première connexion. Vous créerez ensuite votre PIN personnel.</div>
      </div>
      <div>
        <label>Département</label>
        <select name="department" id="departmentSelect" required>
          <option value="" disabled selected>Choisir un département</option>
        </select>
      </div>
      <div>
        <label>Ville / Commune</label>
        <select name="town" id="townSelect" required disabled>
          <option value="" disabled selected>Choisir d'abord un département</option>
        </select>
      </div>
      <div>
        <label>Mode Compagnie (identifiants automatiques)</label>
        <select name="companyMode" id="companyModeSelect">
          <option value="OFF" selected>Désactivé — je saisis les identifiants moi-même</option>
          <option value="ON">Activé — identifiants générés et verrouillés automatiquement</option>
        </select>
        <div class="hint">En mode Compagnie, les identifiants (élèves, membres, etc.) sont générés automatiquement avec le préfixe de votre organisation et ne peuvent plus être modifiés à la main. Vous pourrez changer ce réglage plus tard dans les paramètres.</div>
      </div>
      <div>
        <label>Logo (optionnel)</label>
        <div class="logoRow">
          <div class="logoPreview" id="logoPreview">Aucun logo</div>
          <input type="file" name="logo" id="logoInput" accept="image/png,image/jpeg,image/webp" />
        </div>
        <div class="hint" id="logoHint">PNG, JPEG ou WebP — 300 Ko maximum. Utilisé comme icône de l'application.</div>
      </div>
      <button type="button" class="resumeToggle" id="resumeToggle" aria-expanded="false" aria-controls="resumeFields">J’ai déjà envoyé mon inscription — reprendre le suivi</button>
      <button type="submit" class="submit">Créer le compte</button>

      <div id="signupMsg" class="msg" aria-live="polite"></div>
    </form>
    <div class="resumeBox" id="resumeBox">
      <div id="resumeFields">
        <label for="resumeEmail">Email utilisé pour l’inscription</label>
        <input type="email" id="resumeEmail" autocomplete="email" />
        <label for="resumePhone" style="margin-top:10px">Téléphone initial</label>
        <input type="tel" id="resumePhone" autocomplete="tel" />
        <button type="button" class="submit" id="resumeButton" style="width:100%;margin-top:12px">Reprendre le suivi</button>
        <div id="resumeMsg" class="msg" aria-live="polite"></div>
      </div>
    </div>
    <section id="provisioningScreen" aria-live="polite">
      <h1>Préparation de votre espace</h1>
      <p class="sub" id="progressSummary">Votre inscription est reçue. Nous configurons votre application.</p>
      <div class="progressHead"><span id="progressStep">Demande reçue</span><span id="progressPercent">0 %</span></div>
      <div class="progressTrack" role="progressbar" aria-label="Progression de la création" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progressFill" id="progressFill"></div></div>
      <div class="progressMeta" id="progressUpdatedAt">En attente de la première confirmation du serveur…</div>
      <div class="hint" id="rProvisioningHint">La progression affichée provient des étapes confirmées par le serveur.</div>
      <details class="diagnosticLog"><summary>Journal du suivi</summary><pre id="provisioningLog" aria-live="polite">En attente des événements de suivi…</pre></details>
      <div class="accountInfo" id="accountInfo">
        <h2 style="font-size:1.05rem;margin:0 0 8px">Votre compte est prêt</h2>
        <div class="result" style="display:block">
          <div class="row"><span>Identifiant</span><span id="rBusinessId"></span></div>
          <div class="row"><span>Nom de l’application</span><span id="rAppName"></span></div>
          <div class="row"><span>Email administrateur</span><span id="rEmail"></span></div>
          <div class="row"><span>Sous-domaine</span><span id="rSubdomain"></span></div>
        </div>
        <p class="hint">Installez l’application depuis le lien, puis connectez-vous avec l’email et le téléphone inscrits. Vous choisirez votre PIN personnel lors de la première connexion.</p>
        <a class="launch" id="rLaunch" href="#" target="_blank" rel="noopener noreferrer">Ouvrir mon application →</a>
      </div>
      <div id="provisioningMsg" class="msg" aria-live="polite"></div>
    </section>
  </div>

<script>
(function () {
  var API_BASE = location.origin;

  // Kept in step with src/lib/haitiLocalities.js (server-side validation
  // uses that file; this is the browser-side copy for the dropdowns —
  // update both together if a commune is added/corrected).
  var TOWNS_BY_DEPARTMENT = {
    "Artibonite": ["Gonaïves","Ennery","L'Estère","Gros-Morne","Anse-Rouge","Terre-Neuve","Dessalines","Grande-Saline","Petite-Rivière-de-l'Artibonite","Verrettes","La Chapelle","Saint-Marc","Saint-Michel-de-l'Attalaye","Marmelade","Desdunes"],
    "Centre": ["Hinche","Maïssade","Thomassique","Cerca-Carvajal","Mirebalais","Saut-d'Eau","Boucan-Carré","Lascahobas","Belladère","Baptiste","Savanette","Thomonde","Cerca-la-Source"],
    "Grand'Anse": ["Jérémie","Abricots","Bonbon","Corail","Moron","Pestel","Beaumont","Anse-d'Hainault","Dame-Marie","Les Irois","Chambellan","Roseaux"],
    "Nippes": ["Miragoâne","Petite-Rivière-de-Nippes","Petit-Trou-de-Nippes","Anse-à-Veau","L'Asile","Fonds-des-Nègres","Plaisance-du-Sud","Baradères","Paillant"],
    "Nord": ["Cap-Haïtien","Quartier-Morin","Limonade","Plaine-du-Nord","Milot","Acul-du-Nord","Grande-Rivière-du-Nord","Bahon","La Victoire","Saint-Raphaël","Dondon","Pignon","Ranquitte","Borgne","Port-Margot","Limbé","Bas-Limbé","Plaisance","Pilate"],
    "Nord-Est": ["Fort-Liberté","Ferrier","Perches","Ouanaminthe","Capotille","Mont-Organisé","Trou-du-Nord","Terrier-Rouge","Caracol","Sainte-Suzanne","Vallières","Carice","Mombin-Crochu"],
    "Nord-Ouest": ["Port-de-Paix","La Tortue","Bassin-Bleu","Chansolme","Saint-Louis-du-Nord","Anse-à-Foleur","Môle-Saint-Nicolas","Bombardopolis","Baie-de-Henne","Jean-Rabel"],
    "Ouest": ["Port-au-Prince","Delmas","Pétion-Ville","Carrefour","Tabarre","Cité Soleil","Kenscoff","Gressier","Léogâne","Grand-Goâve","Petit-Goâve","Croix-des-Bouquets","Cornillon","Thomazeau","Ganthier","Fonds-Verrettes","Arcahaie","Cabaret","Anse-à-Galets","Pointe-à-Raquette"],
    "Sud": ["Les Cayes","Torbeck","Île-à-Vache","Camp-Perrin","Maniche","Chantal","Cavaillon","Saint-Louis-du-Sud","Aquin","Saint-Jean-du-Sud","Port-à-Piment","Roche-à-Bateau","Coteaux","Port-Salut","Arniquet","Chardonnières","Les Anglais","Tiburon"],
    "Sud-Est": ["Jacmel","Cayes-Jacmel","Marigot","Bainet","Côtes-de-Fer","Belle-Anse","Thiotte","Grand-Gosier","Anse-à-Pitres","La Vallée"]
  };
  var DEPARTMENTS = Object.keys(TOWNS_BY_DEPARTMENT);

  // ---- Department / town cascading dropdowns ----
  var departmentSelect = document.getElementById("departmentSelect");
  var townSelect = document.getElementById("townSelect");
  DEPARTMENTS.forEach(function (dep) {
    var opt = document.createElement("option");
    opt.value = dep; opt.textContent = dep;
    departmentSelect.appendChild(opt);
  });
  departmentSelect.addEventListener("change", function () {
    var towns = TOWNS_BY_DEPARTMENT[departmentSelect.value] || [];
    townSelect.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.disabled = true; placeholder.selected = true;
    placeholder.textContent = towns.length ? "Choisir une ville" : "Aucune ville disponible";
    townSelect.appendChild(placeholder);
    towns.forEach(function (town) {
      var opt = document.createElement("option");
      opt.value = town; opt.textContent = town;
      townSelect.appendChild(opt);
    });
    townSelect.disabled = towns.length === 0;
  });

  // ---- Logo upload: convert to a base64 data URL client-side, preview it ----
  var MAX_LOGO_BYTES = 300 * 1024;
  var logoInput = document.getElementById("logoInput");
  var logoPreview = document.getElementById("logoPreview");
  var logoHint = document.getElementById("logoHint");
  var logoDataUrl = null;
  logoInput.addEventListener("change", function () {
    var file = logoInput.files && logoInput.files[0];
    logoDataUrl = null;
    if (!file) {
      logoPreview.innerHTML = "Aucun logo";
      logoHint.textContent = "PNG, JPEG ou WebP — 300 Ko maximum. Utilisé comme icône de l'application.";
      logoHint.className = "hint";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      logoHint.textContent = "Fichier trop volumineux (300 Ko maximum). Choisissez une image plus légère.";
      logoHint.className = "hint err";
      logoInput.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      logoDataUrl = reader.result;
      logoPreview.innerHTML = "";
      var img = document.createElement("img");
      img.src = logoDataUrl;
      logoPreview.appendChild(img);
      logoHint.textContent = "Logo prêt — il sera utilisé comme icône de l'application.";
      logoHint.className = "hint ok";
    };
    reader.onerror = function () {
      logoHint.textContent = "Impossible de lire ce fichier. Réessayez.";
      logoHint.className = "hint err";
    };
    reader.readAsDataURL(file);
  });

  function callApi(action, data) {
    return fetch(API_BASE + "/?action=" + encodeURIComponent(action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, data: data }),
    }).then(function (r) { return r.json(); });
  }

  // The academic establishment type is only relevant for schools. Keep its
  // value out of non-school registrations and default to the all-types profile.
  var orgTypeSelect = document.getElementById("orgTypeSelect");
  var schoolTypeWrap = document.getElementById("schoolInstitutionTypeWrap");
  var institutionTypeSelect = document.getElementById("institutionTypeSelect");
  function syncSchoolInstitutionTypeField() {
    var isSchool = !!orgTypeSelect && orgTypeSelect.value === "SCHOOL";
    if (schoolTypeWrap) schoolTypeWrap.style.display = isSchool ? "" : "none";
    if (institutionTypeSelect) institutionTypeSelect.disabled = !isSchool;
  }
  if (orgTypeSelect) orgTypeSelect.addEventListener("change", syncSchoolInstitutionTypeField);
  syncSchoolInstitutionTypeField();

  // ---- Live subdomain check ----
  var nameInput = document.querySelector('#signupForm input[name="businessName"]');
  var appNameInput = document.getElementById("appNameInput");
  var appNameWasEdited = false;
  if (appNameInput) appNameInput.addEventListener("input", function () { appNameWasEdited = true; });
  var subdomainHint = document.getElementById("subdomainHint");
  var subdomainTimer = null;
  nameInput.addEventListener("input", function () {
    if (appNameInput && !appNameWasEdited) appNameInput.value = nameInput.value.trim();
    clearTimeout(subdomainTimer);
    var name = nameInput.value.trim();
    if (!name) { subdomainHint.textContent = ""; return; }
    subdomainTimer = setTimeout(function () {
      callApi("checkSubdomainAvailable", { businessName: name }).then(function (res) {
        if (!res || !res.success) return;
        var d = res.data || res;
        subdomainHint.textContent = "Votre adresse : " + d.subdomain + ".eduflow.win" + (d.available ? "" : " (déjà pris — un suffixe sera ajouté)");
        subdomainHint.className = "hint " + (d.available ? "ok" : "err");
      }).catch(function () {});
    }, 400);
  });

  // Provisioning is asynchronous because a school receives its own D1 database
  // and tenant routing. Keep checking the durable MASTER_DB status so the
  // school gets its launch link without an operator or manual refresh.
  var provisioningLog = [];
  function logProvisioning(message) {
    var now = new Date();
    var stamp = now.toLocaleTimeString("fr-HT");
    provisioningLog.push("[" + stamp + "] " + String(message));
    if (provisioningLog.length > 60) provisioningLog = provisioningLog.slice(-60);
    var output = document.getElementById("provisioningLog");
    if (output) output.textContent = provisioningLog.join("\\n");
  }

  function pollProvisioningStatus(email, phone) {
    var startedAt = Date.now();
    var checks = 0;
    var stopped = false;
    function check() {
      if (stopped) return;
      var elapsed = Date.now() - startedAt;
      var takingLong = elapsed >= 10 * 60 * 1000;
      checks++;
      logProvisioning("Vérification du statut serveur (tentative " + checks + ").");
      callApi("getProvisioningStatus", { email: email, phone: phone }).then(function (res) {
        var d = res && res.data ? res.data : res;
        var status = d && d.provisioningStatus;
        var percent = Math.max(0, Math.min(100, Number(d && d.progress) || 0));
        var step = (d && d.step) || "En attente de confirmation du serveur";
        logProvisioning("Statut=" + (status || "inconnu") + ", progression=" + percent + " %, étape : " + step + (d && d.subdomain !== undefined ? ", sous-domaine=" + JSON.stringify(String(d.subdomain || "")) + " (longueur=" + String(d.subdomain || "").length + ")" : "") + (d && d.dispatchResult ? ", relance=" + d.dispatchResult + (d.dispatchCode ? " (" + d.dispatchCode + ")" : "") + (d.dispatchMessage ? " — " + d.dispatchMessage : "") : "") + (d && d.requestId ? ", référence=" + d.requestId : ""));
        if (d && d.updatedAt) {
          var updated = new Date(d.updatedAt);
          document.getElementById("progressUpdatedAt").textContent = "Dernière mise à jour confirmée : " + (isNaN(updated.getTime()) ? d.updatedAt : updated.toLocaleString("fr-HT"));
        }
        var fill = document.getElementById("progressFill");
        var percentEl = document.getElementById("progressPercent");
        var stepEl = document.getElementById("progressStep");
        var bar = document.querySelector(".progressTrack");
        fill.style.width = percent + "%";
        percentEl.textContent = percent + " %";
        stepEl.textContent = step;
        bar.setAttribute("aria-valuenow", String(percent));
        var hint = document.getElementById("rProvisioningHint");
        if (takingLong) hint.textContent = "La préparation dépasse le délai habituel. Le serveur n’a pas encore confirmé la fin; la vérification continue.";
        if (res && res.success && status === "ACTIVE" && d.tenantAppUrl) {
          stopped = true;
          fill.style.width = "100%";
          percentEl.textContent = "100 %";
          bar.setAttribute("aria-valuenow", "100");
          stepEl.textContent = "Terminé";
          document.getElementById("rBusinessId").textContent = d.businessId || "";
          document.getElementById("rAppName").textContent = d.appName || d.businessName || "";
          document.getElementById("rEmail").textContent = d.email || email;
          document.getElementById("rSubdomain").textContent = (d.subdomain || "") + ".eduflow.win";
          document.getElementById("rLaunch").href = d.tenantAppUrl;
          document.getElementById("accountInfo").style.display = "block";
          hint.textContent = "Votre application et le compte administrateur sont prêts.";
          hint.className = "hint ok";
          logProvisioning("Provisionnement confirmé terminé; informations du compte affichées.");
          return;
        }
        if (status === "PROVISIONING_FAILED") {
          hint.textContent = "Une étape a échoué. Le système réessaiera automatiquement; vos informations de compte seront affichées après confirmation.";
          hint.className = "hint";
        } else if (step.toLowerCase().includes("déclenchement")) {
          hint.textContent = step + ". La page vérifie de nouveau le statut automatiquement.";
          hint.className = "hint";
        } else {
          hint.textContent = takingLong ? "La préparation dépasse le délai habituel. Vérification automatique en cours." : "La préparation continue. Cette page vérifie régulièrement l’état confirmé par le serveur.";
          hint.className = "hint";
        }
      }).catch(function () {
        document.getElementById("rProvisioningHint").textContent = "Statut temporairement inaccessible. La vérification reprendra automatiquement.";
        logProvisioning("Échec de la lecture du statut serveur; nouvelle tentative programmée.");
      }).then(function () {
        if (!stopped) setTimeout(check, takingLong ? 30000 : (checks < 6 ? 5000 : 15000));
      });
    }
    setTimeout(check, 3000);
  }

  document.getElementById("resumeToggle").addEventListener("click", function () {
    var fields = document.getElementById("resumeFields");
    var opening = fields.style.display !== "block";
    fields.style.display = opening ? "block" : "none";
    this.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) fields.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.getElementById("resumeButton").addEventListener("click", function () {
    var email = document.getElementById("resumeEmail").value.trim();
    var phone = document.getElementById("resumePhone").value.trim();
    var resumeMsg = document.getElementById("resumeMsg");
    resumeMsg.className = "msg"; resumeMsg.textContent = "";
    if (!email || !phone) {
      resumeMsg.className = "msg err"; resumeMsg.textContent = "Saisissez l’email et le téléphone utilisés lors de l’inscription.";
      return;
    }
    var button = document.getElementById("resumeButton");
    button.disabled = true; button.textContent = "Vérification…";
    logProvisioning("Demande de reprise du suivi envoyée au serveur.");
    callApi("getProvisioningStatus", { email: email, phone: phone }).then(function (res) {
      var d = res && res.data ? res.data : res;
      if (!res || !res.success || !d || !d.provisioningStatus) {
        resumeMsg.className = "msg err";
        resumeMsg.textContent = (d && d.message) || "Inscription introuvable avec ces informations.";
        logProvisioning("Reprise refusée : inscription introuvable ou justificatifs non valides.");
        button.disabled = false; button.textContent = "Reprendre le suivi";
        return;
      }
      document.getElementById("signupForm").style.display = "none";
      document.getElementById("resumeBox").style.display = "none";
      document.getElementById("provisioningScreen").style.display = "block";
      document.getElementById("progressSummary").textContent = "Nous reprenons le suivi de votre inscription.";
      document.getElementById("progressFill").style.width = Math.max(0, Math.min(100, Number(d.progress) || 0)) + "%";
      document.getElementById("progressPercent").textContent = Math.max(0, Math.min(100, Number(d.progress) || 0)) + " %";
      document.getElementById("progressStep").textContent = d.step || "Statut récupéré";
      logProvisioning("Inscription retrouvée : " + d.provisioningStatus + ", " + (Number(d.progress) || 0) + " %, " + (d.step || "étape inconnue") + (d.subdomain !== undefined ? "; sous-domaine=" + JSON.stringify(String(d.subdomain || "")) + " (longueur=" + String(d.subdomain || "").length + ")" : "") + (d.dispatchResult ? "; déclenchement=" + d.dispatchResult + (d.dispatchCode ? " (" + d.dispatchCode + ")" : "") + (d.dispatchMessage ? " — " + d.dispatchMessage : "") : "") + (d.requestId ? "; référence=" + d.requestId : "") + ".");
      document.getElementById("provisioningScreen").scrollIntoView({ behavior: "smooth", block: "start" });
      pollProvisioningStatus(email, phone);
    }).catch(function () {
      resumeMsg.className = "msg err"; resumeMsg.textContent = "Échec temporaire de la vérification. Réessayez.";
      logProvisioning("Erreur réseau pendant la reprise du suivi.");
      button.disabled = false; button.textContent = "Reprendre le suivi";
    });
  });

  // ---- Signup ----
  document.getElementById("signupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById("signupMsg");
    msg.className = "msg"; msg.textContent = "";

    var submitBtn = form.querySelector("button.submit");
    submitBtn.disabled = true; submitBtn.textContent = "Création en cours…";
    logProvisioning("Formulaire envoyé; création de l’organisation demandée.");

    callApi("registerAccount", {
      orgType: form.orgType.value,
      institutionType: form.orgType.value === "SCHOOL" ? form.institutionType.value : "",
      businessName: form.businessName.value.trim(),
      appName: form.appName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      department: form.department.value,
      town: form.town.value,
      logoDataUrl: logoDataUrl,
      companyMode: form.companyMode.value === "ON",
    }).then(function (res) {
      var d = res && res.data ? res.data : res;
      if (!res || !res.success) {
        submitBtn.disabled = false; submitBtn.textContent = "Créer le compte";
        msg.className = "msg err";
        msg.textContent = (d && (d.message || res.error)) || "Erreur lors de la création du compte.";
        logProvisioning("Inscription refusée par le serveur.");
        msg.scrollIntoView({ behavior: "smooth", block: "end" });
        return;
      }
      document.getElementById("progressSummary").textContent = "Inscription reçue pour " + form.businessName.value.trim() + ". Nous configurons la base, le compte administrateur et l’application.";
      logProvisioning("Inscription enregistrée. Statut initial : " + (d.provisioningStatus || "PENDING_PROVISIONING") + "; déclenchement=" + (d.provisioningDispatch || "inconnu") + (d.requestId ? "; référence=" + d.requestId : "") + ".");
      document.getElementById("provisioningScreen").style.display = "block";
      form.style.display = "none";
      // Lock the form instead of just hiding the button: a hidden-but-
      // enabled submit button is still a valid implicit-submit target, so
      // pressing Enter in a field afterwards could silently re-fire
      // registerAccount and create a duplicate org. Disabling every
      // control also stops the just-submitted values from sitting there
      // looking live/editable next to the "Compte créé" result.
      Array.prototype.forEach.call(form.elements, function (el) { el.disabled = true; });
      document.getElementById("provisioningScreen").scrollIntoView({ behavior: "smooth", block: "start" });
      pollProvisioningStatus(form.email.value.trim(), form.phone.value.trim());
    }).catch(function () {
      submitBtn.disabled = false; submitBtn.textContent = "Créer le compte";
      msg.className = "msg err"; msg.textContent = "Erreur réseau. Réessayez.";
      logProvisioning("Erreur réseau pendant l’envoi de l’inscription.");
      msg.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  });

})();
</script>
</body>
</html>
`;
