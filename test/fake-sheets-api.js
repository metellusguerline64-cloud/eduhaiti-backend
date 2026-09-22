// Fixture standing in for a real Generated_IDs sheet — used only by
// test/run-sync-test.mjs, not shipped/imported by production code.
export async function fakeFetchSheetValues(_env, _spreadsheetId, sheetName) {
  if (sheetName !== "Generated_IDs") return [];
  return [
    ["ID", "Nom", "Prenom", "Phone", "OrgId", "PhotoURL", "Status", "Classe", "Sexe", "Adresse", "Date de Naissance"],
    ["STU-001", "Baptiste", "Jean", "+50912345678", "ORG1", "https://drive.google.com/file/d/ABC123/view", "ACTIVE", "6eme", "M", "Rue 1", "2012-05-01"],
    ["STU-002", "Pierre", "Alice", "+50911112222", "ORG1", "", "INACTIF", "5eme", "F", "Rue 2", "2013-01-01"],
    ["STU-003", "Autre", "École", "+50900000000", "OTHER_ORG", "", "ACTIVE", "4eme", "M", "Rue 3", "2011-01-01"],
  ];
}
