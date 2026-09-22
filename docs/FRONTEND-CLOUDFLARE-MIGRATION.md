# Migration du frontend vers Cloudflare

Le fichier `C:\Users\pc\Downloads\school.html` conserve ses écrans et ses noms d'actions. Il peut maintenant appeler le Worker via `window.EDUHAITI_API_URL`.

## Configuration

Injecter cette valeur avant le premier script applicatif de `school.html` :

```html
<script>
  window.EDUHAITI_API_URL = 'https://<sous-domaine-ecole>.eduflow.win/api';
</script>
```

La même valeur peut être fournie par `SETTINGS_CONFIG_CACHE.EDUHAITI_API_URL` ou, pour un test local uniquement, par :

```js
localStorage.setItem('edu_cloudflare_api_url', 'https://<sous-domaine-ecole>.eduflow.win/api');
```

Si le frontend est ouvert depuis `https://<sous-domaine-ecole>.eduflow.win`, il utilise automatiquement cette origine avec `/api`. Un build séparé par école n'est donc pas nécessaire.

L'URL ne doit pas contenir `?action=...`. Le frontend ajoute automatiquement `action`, `token` et les paramètres de l'action.

## Authentification

Le frontend appelle `attemptSheetLogin` avec `{ email, password }`. Le Worker renvoie un token de session, que le frontend conserve dans `edu_token` et transmet ensuite à `getViewerInfo` et aux autres actions.

Le sous-domaine est important : le Worker choisit la base D1 depuis le host. Une URL générique du Worker ne doit donc pas remplacer l'URL du sous-domaine de l'école.

## Déploiement

Construire une version Pages avec l'injection automatique de l'URL Worker :

```powershell
npm run frontend:build -- --source "C:\Users\pc\Downloads\school.html" --out frontend-dist
npx wrangler pages deploy frontend-dist --project-name eduhaiti
```

Puis :

1. Renouveler `eduflow.win` chez le registrar et l'ajouter à Cloudflare.
2. Activer la route Worker `*.eduflow.win/api/*` et vérifier le binding D1 de l'école.
2. Ouvrir le frontend depuis le sous-domaine de l'école et tester login, `getViewerInfo`, lecture des élèves puis une écriture autorisée.

Le Worker autorise déjà `GET`, `POST`, `OPTIONS` et les headers `Content-Type` / `Authorization`. Les actions non encore portées continueront de renvoyer une erreur explicite.

## Compatibilité

Si `window.EDUHAITI_API_URL` n'est pas défini, le frontend continue d'essayer la configuration Apps Script existante (`SCRIPT_EXEC_URL`, puis `edu_http_base_url`). Cela permet une migration progressive école par école.

## Ajouter une nouvelle école

Le frontend Pages est partagé par toutes les écoles. Pour une école `stmarc` :

1. Créer une base D1 et ajouter son binding `DB_STMARC` dans `wrangler.toml`.
2. Ajouter `stmarc: { orgId: "STMARC", dbBinding: "DB_STMARC" }` dans `src/lib/tenants.js`.
3. Appliquer `schema.sql` et les migrations sur la nouvelle base D1.
4. Redéployer le Worker avec `npm run deploy`.
5. Dans Pages, ajouter le domaine personnalisé `stmarc.eduflow.win` au projet `eduflow`.

Le wildcard Worker `*.eduflow.win/api/*` couvre automatiquement l'API de cette école. Le frontend ouvert sur `https://stmarc.eduflow.win` détecte automatiquement `https://stmarc.eduflow.win/api`; aucun build séparé n'est requis.

Le provisioning securise s'exécute depuis une machine CI protégée, jamais depuis le navigateur :

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "..."
$env:CLOUDFLARE_API_TOKEN = "..."
npm run provision:school -- --subdomain stmarc --org-id STMARC --apply
```

Sans `--apply`, la commande reste en simulation. Le token doit avoir les droits D1, Workers, Pages et DNS, et être stocké comme secret CI.
