# EDGE-0090 — School IDs / Cartes d'identification — Finalisation de parité

## Objectif
Audit ciblé de `Code.gs` contre `src/actions/school_ids.js` pour fermer les écarts comportementaux résiduels du registre **School IDs** avant de passer à un autre domaine.

## Corrections
1. **Matching compatible avec `schoolCodeVariants_()`**
   - normalisation alphanumérique conservée;
   - variante sans préfixe alphabétique supportée (`MT-123` ↔ `123`).
2. **Upsert aligné sur `upsertSchoolIdRecord_()`**
   - si Student Code/Tracking Number existe, recherche uniquement dans les clés Student Code/Tracking Number correspondantes;
   - si Student Code et Tracking Number sont absents, fallback sur School ID;
   - évite les mises à jour croisées non prévues par le code source.
3. **Contrat `row` restauré**
   - l'action Worker retourne désormais un numéro de ligne déterministe 1-based pour rester compatible avec les anciens appelants.
4. **Tests de régression ajoutés**
   - création + `row`;
   - mise à jour sans duplication + `row`;
   - matching tolérant aux préfixes;
   - fallback School ID sans Student Code/Tracking Number;
   - validation du School ID obligatoire.

## Adaptation d'architecture
Le Worker conserve le stockage D1 tenant-scoped (`school_ids`) au lieu du Google Sheet central `School IDs`. Cette différence est intentionnelle dans l'architecture Cloud/D1; elle ne réintroduit aucun Spreadsheet ID ou identifiant hardcodé.

## Validation
- `node --check src/actions/school_ids.js` : PASS
- `node test/run-school-ids-test.mjs` : PASS
- `node test/run-school-ids-admin-test.mjs` : PASS
- `node test/run-codegs-parity-audit-test.mjs` : PASS (239/239 actions enregistrées)

Le compteur 239/239 confirme le registre des actions, pas une preuve de parité ligne-à-ligne globale. Dans ce lot, les écarts concrets identifiés dans le périmètre School IDs ont été corrigés et couverts par tests.
