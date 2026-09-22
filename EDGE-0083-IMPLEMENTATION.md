# EDGE-0083 — École / Paramètres — finalisation du lot

## Source auditée
- `Code.gs.txt`: `getSaaSSettings_`, `updateSaaSSettings_`, `getSaaSSettingsHealth_` et logique de paramètres historiques.
- Worker de départ: `work82/src/actions/settings.js`.

## Corrections du lot
1. **Lecture historique `targetYear`**
   - `getSaaSSettings` accepte désormais `targetYear` / `year`.
   - Si une archive D1 correspondante existe, ses `snapshot_json.settings` sont utilisés.
   - Sinon la lecture courante reste utilisée.
   - Cela remplace le mécanisme Apps Script `Settings_<année>` / `Archives_Annuelles` sans dépendance Sheets/Drive.

2. **Compatibilité des alias legacy**
   - Ajout des variantes historiques `CONTACTEMAIL`, `CONTACTPHONE`, `SCHOOLPHONE`, `SCHOOLNAME`, `SCHOOLADDRESS`, `ACADEMICYEAR`, `SCHOOLYEAR`, `ADDRESS` vers les clés canoniques frontend.

3. **Sécurité MonCash conservée**
   - `MONCASH_CONFIG_ENC` n'est jamais renvoyé par le payload générique.

4. **Écriture / audit**
   - Les valeurs précédentes sont lues avant écriture et enregistrées dans l'audit D1.
   - Les credentials, emails administratifs et identifiants de dossier ne sont pas hardcodés.

## Limites intentionnelles de migration
- Les doublons de `Settings` qui pouvaient exister comme lignes Google Sheets ne peuvent pas être recréés avec la clé primaire D1 `settings.key`; `cleanupSettingsDuplicates` reste donc un contrôle de compatibilité.
- Le bootstrap propriétaire Apps Script basé sur `Session.getEffectiveUser()` / `Session.getActiveUser()` n'est pas reproduit artificiellement: l'identité Worker est celle de la session D1. Aucun contournement d'autorisation n'a été ajouté.

## Tests
- `run-settings-test.mjs` — PASS
- `run-settings-historical-test.mjs` — PASS
- `run-legacy-communication-settings-test.mjs` — PASS
- `run-codegs-parity-audit-test.mjs` — PASS (242/242 actions enregistrées; ce test confirme le registre, pas une preuve de parité comportementale absolue).
- `node --check src/actions/settings.js` — PASS
