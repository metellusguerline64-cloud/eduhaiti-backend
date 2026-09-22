// Haiti's 10 départements and their communes, for the signup form's
// department/town dropdowns (src/signupPage.js) and server-side validation
// (registerAccount, src/actions/accounts.js). Communes are grouped under
// each département's arrondissements per the standard administrative
// division of Haiti (10 départements, 42 arrondissements, ~146 communes).
//
// This list favors the commonly-used commune names; if a specific commune
// is missing or misspelled for your area, add it here — both the signup
// form and the server-side check read from this single source, so one
// edit here fixes both.

export const DEPARTMENTS = [
  "Artibonite",
  "Centre",
  "Grand'Anse",
  "Nippes",
  "Nord",
  "Nord-Est",
  "Nord-Ouest",
  "Ouest",
  "Sud",
  "Sud-Est",
];

export const TOWNS_BY_DEPARTMENT = {
  "Artibonite": [
    "Gonaïves", "Ennery", "L'Estère", "Gros-Morne", "Anse-Rouge", "Terre-Neuve",
    "Dessalines", "Grande-Saline", "Petite-Rivière-de-l'Artibonite", "Verrettes",
    "La Chapelle", "Saint-Marc", "Saint-Michel-de-l'Attalaye", "Marmelade", "Desdunes",
  ],
  "Centre": [
    "Hinche", "Maïssade", "Thomassique", "Cerca-Carvajal", "Mirebalais", "Saut-d'Eau",
    "Boucan-Carré", "Lascahobas", "Belladère", "Baptiste", "Savanette", "Thomonde",
    "Cerca-la-Source",
  ],
  "Grand'Anse": [
    "Jérémie", "Abricots", "Bonbon", "Corail", "Moron", "Pestel", "Beaumont",
    "Anse-d'Hainault", "Dame-Marie", "Les Irois", "Chambellan", "Roseaux",
  ],
  "Nippes": [
    "Miragoâne", "Petite-Rivière-de-Nippes", "Petit-Trou-de-Nippes", "Anse-à-Veau",
    "L'Asile", "Fonds-des-Nègres", "Plaisance-du-Sud", "Baradères", "Paillant",
  ],
  "Nord": [
    "Cap-Haïtien", "Quartier-Morin", "Limonade", "Plaine-du-Nord", "Milot",
    "Acul-du-Nord", "Grande-Rivière-du-Nord", "Bahon", "La Victoire", "Saint-Raphaël",
    "Dondon", "Pignon", "Ranquitte", "Borgne", "Port-Margot", "Limbé", "Bas-Limbé",
    "Plaisance", "Pilate",
  ],
  "Nord-Est": [
    "Fort-Liberté", "Ferrier", "Perches", "Ouanaminthe", "Capotille", "Mont-Organisé",
    "Trou-du-Nord", "Terrier-Rouge", "Caracol", "Sainte-Suzanne", "Vallières",
    "Carice", "Mombin-Crochu",
  ],
  "Nord-Ouest": [
    "Port-de-Paix", "La Tortue", "Bassin-Bleu", "Chansolme", "Saint-Louis-du-Nord",
    "Anse-à-Foleur", "Môle-Saint-Nicolas", "Bombardopolis", "Baie-de-Henne", "Jean-Rabel",
  ],
  "Ouest": [
    "Port-au-Prince", "Delmas", "Pétion-Ville", "Carrefour", "Tabarre", "Cité Soleil",
    "Kenscoff", "Gressier", "Léogâne", "Grand-Goâve", "Petit-Goâve", "Croix-des-Bouquets",
    "Cornillon", "Thomazeau", "Ganthier", "Fonds-Verrettes", "Arcahaie", "Cabaret",
    "Anse-à-Galets", "Pointe-à-Raquette",
  ],
  "Sud": [
    "Les Cayes", "Torbeck", "Île-à-Vache", "Camp-Perrin", "Maniche", "Chantal",
    "Cavaillon", "Saint-Louis-du-Sud", "Aquin", "Saint-Jean-du-Sud", "Port-à-Piment",
    "Roche-à-Bateau", "Coteaux", "Port-Salut", "Arniquet", "Chardonnières",
    "Les Anglais", "Tiburon",
  ],
  "Sud-Est": [
    "Jacmel", "Cayes-Jacmel", "Marigot", "Bainet", "Côtes-de-Fer", "Belle-Anse",
    "Thiotte", "Grand-Gosier", "Anse-à-Pitres", "La Vallée",
  ],
};

export function isValidDepartment(department) {
  return DEPARTMENTS.includes(String(department || ""));
}

export function isValidTown(department, town) {
  const towns = TOWNS_BY_DEPARTMENT[String(department || "")];
  return Array.isArray(towns) && towns.includes(String(town || ""));
}
