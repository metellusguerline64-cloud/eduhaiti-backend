# EDGE-0064 — École / Paramètres : infrastructure D1

Portage des 10 actions restantes identifiées dans l'inventaire réel de Code.gs:
checkAndInitSheets, checkCacheHealth, clearAllSchoolCaches, createSaaSBackup,
ensureSchoolIdsSheet, initSchoolIdsSheet, initSheets, initializeSheetHeaders,
runGlobalBackupTask, warmSchoolCaches.

Google Sheets/CacheService/Drive ne sont plus des dépendances du runtime Worker.
Les actions sont adaptées au modèle D1/R2: vérification des tables, état de santé,
invalidation applicative sans suppression de données, warm-up de lectures D1,
registrements School IDs dans D1, et sauvegarde logique D1 vers R2.

`createSaaSBackup` et `runGlobalBackupTask` délèguent au moteur de backup D1/R2
existant. `initSheets` et les aliases School IDs conservent les noms historiques
mais n'essaient pas de créer des feuilles Google.
