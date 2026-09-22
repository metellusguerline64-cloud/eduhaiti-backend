// Thin Sheets API v4 REST wrapper — the Worker equivalent of
// SpreadsheetApp.openById(...).getSheetByName(...).getDataRange().getValues()
// for the one sheet (Generated_IDs) that isn't being ported into D1 as
// part of this piece of work (see README).

import { getGoogleAccessToken } from "./googleAuth.js";

export async function fetchSheetValues(env, spreadsheetId, sheetName) {
  const token = await getGoogleAccessToken(env);
  const range = encodeURIComponent(`${sheetName}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API error reading '${sheetName}' (${res.status}): ${body}`);
  }
  const json = await res.json();
  // Same shape as Code.gs's getDataRange().getValues(): array of rows,
  // row 0 is the header row, each row is an array of cell values.
  return json.values || [];
}
