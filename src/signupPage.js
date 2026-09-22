// Single-file HTML/JS/CSS interface, same convention as school.html —
// calls this Worker's own registerAccount/fetchConfig/checkSubdomainAvailable
// actions (see src/actions/accounts.js). Exported as a string so the Worker
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
  .tabs { display: flex; gap: 4px; margin-bottom: 22px; background: var(--bg); border-radius: 10px; padding: 4px; }
  .tab {
    flex: 1; text-align: center; padding: 8px 0; border-radius: 8px; cursor: pointer;
    font-size: 0.88rem; font-weight: 600; color: #6b6456; user-select: none;
  }
  .tab.active { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
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
  .result .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  .result .row span:first-child { color: #8a8375; }
  .result .row span:last-child { font-weight: 600; }
  .result a.launch {
    display: block; text-align: center; margin-top: 16px; background: var(--accent); color: #fff;
    text-decoration: none; padding: 12px; border-radius: 9px; font-weight: 700;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Meigens Tech</h1>
    <p class="sub">Créez le compte de votre organisation, sans classeur Google.</p>

    <div class="tabs">
      <div class="tab active" data-tab="signup">Créer un compte</div>
      <div class="tab" data-tab="login">J'ai déjà un compte</div>
    </div>

    <form id="signupForm" class="active">
      <div id="signupMsg" class="msg"></div>
      <div>
        <label>Type d'organisation</label>
        <select name="orgType" required>
          <option value="SCHOOL">École</option>
          <option value="CHURCH">Église</option>
          <option value="BUSINESS">Entreprise</option>
          <option value="HOTEL">Hôtel</option>
          <option value="CARNET_EPARGNE">Carnet d'épargne</option>
        </select>
      </div>
      <div>
        <label>Nom de l'organisation</label>
        <input type="text" name="businessName" required placeholder="Ex: Living Word School of Ministries" />
        <div class="hint" id="subdomainHint"></div>
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
      <button type="submit" class="submit">Créer le compte</button>

      <div class="result" id="signupResult">
        <div class="row"><span>Identifiant</span><span id="rBusinessId"></span></div>
        <div class="row"><span>Sous-domaine</span><span id="rSubdomain"></span></div>
        <div class="hint" id="rProvisioningHint"></div>
        <a class="launch" id="rLaunch" href="#" target="_blank" style="display:none">Ouvrir mon application →</a>
      </div>
    </form>

    <form id="loginForm">
      <div id="loginMsg" class="msg"></div>
      <div>
        <label>Email</label>
        <input type="email" name="email" required />
      </div>
      <div>
        <label>Numéro de téléphone</label>
        <input type="tel" name="phone" placeholder="+509 ..." required />
      </div>
      <button type="submit" class="submit">Retrouver mon organisation</button>

      <div class="result" id="loginResult">
        <div class="row"><span>Organisation</span><span id="lBusinessName"></span></div>
        <div class="row"><span>Sous-domaine</span><span id="lSubdomain"></span></div>
        <a class="launch" id="lLaunch" href="#" target="_blank">Ouvrir mon application →</a>
      </div>
    </form>
  </div>

<script>
(function () {
  var API_BASE = location.origin;

  function callApi(action, data) {
    return fetch(API_BASE + "/?action=" + encodeURIComponent(action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, data: data }),
    }).then(function (r) { return r.json(); });
  }

  // ---- Tabs ----
  var tabs = document.querySelectorAll(".tab");
  var forms = { signup: document.getElementById("signupForm"), login: document.getElementById("loginForm") };
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      Object.keys(forms).forEach(function (k) { forms[k].classList.remove("active"); });
      forms[tab.dataset.tab].classList.add("active");
    });
  });

  // ---- Live subdomain check ----
  var nameInput = document.querySelector('#signupForm input[name="businessName"]');
  var subdomainHint = document.getElementById("subdomainHint");
  var subdomainTimer = null;
  nameInput.addEventListener("input", function () {
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

  // ---- Signup ----
  document.getElementById("signupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById("signupMsg");
    msg.className = "msg"; msg.textContent = "";

    var submitBtn = form.querySelector("button.submit");
    submitBtn.disabled = true; submitBtn.textContent = "Création en cours…";

    callApi("registerAccount", {
      orgType: form.orgType.value,
      businessName: form.businessName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      phone: form.phone.value.trim(),
    }).then(function (res) {
      submitBtn.disabled = false; submitBtn.textContent = "Créer le compte";
      var d = res && res.data ? res.data : res;
      if (!res || !res.success) {
        msg.className = "msg err";
        msg.textContent = (d && (d.message || res.error)) || "Erreur lors de la création du compte.";
        return;
      }
      msg.className = "msg ok";
      msg.textContent = "Compte créé. Votre espace est en cours de préparation.";
      document.getElementById("rBusinessId").textContent = d.businessId;
      document.getElementById("rSubdomain").textContent = d.subdomain + ".eduflow.win";
      var launch = document.getElementById("rLaunch");
      launch.href = d.tenantAppUrl;
      var provisioningHint = document.getElementById("rProvisioningHint");
      if (d.provisioningStatus === "ACTIVE") {
        provisioningHint.textContent = "Votre application est prête.";
        provisioningHint.className = "hint ok";
        launch.style.display = "block";
      } else {
        provisioningHint.textContent = "L'application sera disponible après la création de votre espace sécurisé.";
        provisioningHint.className = "hint";
        launch.style.display = "none";
      }
      document.getElementById("signupResult").style.display = "block";
      form.querySelector("button.submit").style.display = "none";
    }).catch(function () {
      submitBtn.disabled = false; submitBtn.textContent = "Créer le compte";
      msg.className = "msg err"; msg.textContent = "Erreur réseau. Réessayez.";
    });
  });

  // ---- Login / activation lookup ----
  document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById("loginMsg");
    msg.className = "msg"; msg.textContent = "";

    var submitBtn = form.querySelector("button.submit");
    submitBtn.disabled = true; submitBtn.textContent = "Recherche…";

    callApi("fetchConfig", {
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
    }).then(function (res) {
      submitBtn.disabled = false; submitBtn.textContent = "Retrouver mon organisation";
      var d = res && res.data ? res.data : res;
      if (!res || !res.success) {
        msg.className = "msg err";
        msg.textContent = (d && (d.message || res.error)) || "Compte introuvable.";
        return;
      }
      msg.className = "msg ok"; msg.textContent = "Organisation retrouvée.";
      document.getElementById("lBusinessName").textContent = d.businessName;
      document.getElementById("lSubdomain").textContent = d.subdomain + ".eduflow.win";
      document.getElementById("lLaunch").href = d.tenantAppUrl;
      document.getElementById("loginResult").style.display = "block";
      form.querySelector("button.submit").style.display = "none";
    }).catch(function () {
      submitBtn.disabled = false; submitBtn.textContent = "Retrouver mon organisation";
      msg.className = "msg err"; msg.textContent = "Erreur réseau. Réessayez.";
    });
  });
})();
</script>
</body>
</html>
`;
