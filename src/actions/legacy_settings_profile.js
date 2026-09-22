// Legacy Settings/profile/file-upload actions ported from Code.gs.
// Drive/Register dependencies are replaced by tenant D1 settings and R2.
import { loadViewer } from '../lib/accessScope.js';
import { resolveOrgId } from '../lib/org.js';
import { writeAudit } from '../lib/audit.js';

const now = () => new Date().toISOString();
const safeKey = s => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);

async function viewer(env, auth) { return auth?.token ? loadViewer(env, auth) : null; }
function canSettings(v) { return !!(v && (v.isMaster || v.isGodMode || v.permissions?.p_settings || v.permissions?.pa_save_settings)); }
function denied() { return { success:false, error:'Droits insuffisants.' }; }
function decodeBase64(raw) {
  let s = String(raw || '');
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(comma + 1);
  s = s.replace(/\s/g, '');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function putSetting(env, key, value) {
  await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .bind(key, String(value ?? ''), now()).run();
}

export async function updateStudentPortalUrl(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return {success:false,error:'Session invalide.'};
  if (!canSettings(v)) return denied();
  const url = String(data?.url || data?.link || '').trim();
  if (!url) return {success:false,error:'Lien du portail étudiant manquant.'};
  try {
    await putSetting(env, 'STUDENT_PORTAL_URL', url);
    await writeAudit(env.DB,{table:'settings',rowId:'STUDENT_PORTAL_URL',userId:v.id,op:'UPDATE_SETTING',diff:{new:url}});
    return {success:true,message:'Lien portail étudiant mis à jour.'};
  } catch(e) { return {success:false,error:e.message}; }
}

export async function saveUserTheme(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return {success:false,error:'Session invalide.'};
  try {
    const theme = data?.themeData ?? data?.theme ?? data;
    const value = typeof theme === 'object' ? JSON.stringify(theme) : String(theme ?? '');
    await putSetting(env, 'ThemeJSON', value);
    await writeAudit(env.DB,{table:'settings',rowId:'ThemeJSON',userId:v.id,op:'UPDATE_SETTING',diff:{updated:true}});
    return {success:true,message:'Thème utilisateur sauvegardé.'};
  } catch(e) { return {success:false,error:e.message}; }
}

export async function updateMyProfilePhoto(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return {success:false,error:'Session invalide.'};
  const photo = String((data && (data.photo || data.photoUrl || data.avatarUrl || data.PhotoURL)) || '').trim();
  if (!photo) return {success:false,error:'Photo manquante.'};
  if (!/^(data:image\/|https?:\/\/|blob:|\/)/i.test(photo)) return {success:false,error:'Format de photo non valide (requis: data:image/, http, ou URL).'};
  const MAX_CHARS=48000;
  // The legacy D1 fallback keeps the old 48 KiB contract. When R2 is
  // available, data-URL photos are validated by decoded byte size below
  // instead, allowing normal high-resolution profile images to migrate.
  if(!env.MEDIA_BUCKET && photo.length>MAX_CHARS) return {success:false,error:`Photo trop volumineuse (${Math.round(photo.length/1024)} Ko). Maximum: ${Math.round(MAX_CHARS/1024)} Ko. Compressez l'image avant d'envoyer.`};
  try {
    const userId = String(v.id || v.userId || '').trim();
    const email = String(v.email || '').toLowerCase().trim();

    // Phase 4 file migration: profile photos belong in R2, not in D1.
    // Keep the old data-URL fallback when MEDIA_BUCKET is unavailable so
    // local development and staged deployments remain backward-compatible.
    let storedPhoto = photo;
    let storage = 'legacy-url';
    if (env.MEDIA_BUCKET && /^data:image\//i.test(photo)) {
      const bytes = decodeBase64(photo);
      if (bytes.byteLength > 5 * 1024 * 1024) {
        return {success:false,error:'Photo trop volumineuse. Maximum: 5 Mo.'};
      }
      const mime = (photo.match(/^data:([^;,]+)[;,]/i)?.[1] || 'image/png').toLowerCase();
      if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) {
        return {success:false,error:'Type de photo non pris en charge.'};
      }
      const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : mime.slice(6);
      const org = await resolveOrgId(env);
      const key = `profile-photos/${org}/${safeKey(userId || email || 'user')}-${Date.now()}.${ext}`;
      await env.MEDIA_BUCKET.put(key, bytes, {
        httpMetadata: {
          contentType: mime,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      storedPhoto = env.PUBLIC_BASE_URL
        ? `${String(env.PUBLIC_BASE_URL).replace(/\/$/,'')}/media/${key}`
        : `/media/${key}`;
      storage = 'r2';
    }

    const r = await env.DB.prepare(`UPDATE users SET photo_url=?, updated_at=? WHERE deleted_at IS NULL AND (id=? OR user_id=? OR lower(email)=?)`)
      .bind(storedPhoto,now(),userId,userId,email).run();
    if(!r.meta?.changes) return {success:false,error:'Compte introuvable pour mise à jour de photo.'};
    await writeAudit(env.DB,{table:'users',rowId:userId||email,userId:v.id,op:'PHOTO_UPDATE',diff:{size:photo.length,storage}});
    return {success:true,message:'Photo de profil mise à jour avec succès.',photo:storedPhoto,storage};
  } catch(e) {
    return {success:false,error:/limit|max|too large|too long|string/i.test(String(e.message)) ? 'Photo trop volumineuse. Réduisez sa taille (< 48 Ko) et réessayez.' : 'Échec mise à jour photo: '+e.message};
  }
}

export async function clearMeigensConfiguration(_data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return {success:false,error:'Session invalide.'};
  if (!canSettings(v)) return denied();
  const keys=['SCHOOL_NAME','SCHOOL_ADDR','ACADEMIC_YEAR','TOTAL_TERMS','MIN_PASSING_AVG','PROMOTION_MIN_AVG','MIN_ADJOURN_AVG','BOT_SETUP_STATE'];
  try {
    const placeholders=keys.map(()=>'?').join(',');
    const r=await env.DB.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).bind(...keys).run();
    await writeAudit(env.DB,{table:'settings',rowId:'SYSTEM',userId:v.id,op:'RESET_CONFIG',diff:{keys,removed:r.meta?.changes||0}});
    return {success:true,message:'Système prêt pour nouvelle configuration.'};
  } catch(e){return {success:false,error:e.message};}
}

async function uploadAsset(data, auth, env, kind) {
  const v=await viewer(env,auth);
  if(!v)return {success:false,error:'Session invalide.'};
  if(!canSettings(v))return denied();
  if(!env.MEDIA_BUCKET)return {success:false,error:'Stockage média non configuré : ajoutez le binding R2 MEDIA_BUCKET.'};
  if(!data?.base64Data)return {success:false,error:'Aucune donnée image.'};
  try {
    const bytes=decodeBase64(data.base64Data);
    if(bytes.byteLength>5*1024*1024)return {success:false,error:'Image trop volumineuse. Maximum: 5 Mo.'};
    const mime=String(data.mimeType||'image/png').split(';')[0].trim() || 'image/png';
    if(!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(mime))return {success:false,error:'Type d’image non pris en charge.'};
    const org=await resolveOrgId(env);
    const suffix=kind==='logo'?'logo':`pwa_${String(data.formFactor||'narrow').toLowerCase()==='wide'?'wide':'narrow'}`;
    const key=`assets/${org}/${suffix}/${Date.now()}-${safeKey(data.fileName||suffix)}`;
    await env.MEDIA_BUCKET.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'public, max-age=31536000, immutable'}});
    const publicUrl=env.PUBLIC_BASE_URL ? `${String(env.PUBLIC_BASE_URL).replace(/\/$/,'')}/media/${key}` : `/media/${key}`;
    if(kind==='logo') await putSetting(env,'SCHOOL_LOGO',publicUrl);
    else {
      const wide=String(data.formFactor||'').toLowerCase()==='wide';
      const size=(Number(data.width)>0&&Number(data.height)>0)?`${Number(data.width)}x${Number(data.height)}`:(wide?'1280x800':'750x1334');
      await putSetting(env,wide?'PWA_SCREENSHOT_WIDE_URL':'PWA_SCREENSHOT_NARROW_URL',publicUrl);
      await putSetting(env,wide?'PWA_SCREENSHOT_WIDE_SIZE':'PWA_SCREENSHOT_NARROW_SIZE',size);
    }
    await writeAudit(env.DB,{table:'settings',rowId:key,userId:v.id,op:'ASSET_UPLOAD',diff:{kind,mime,size:bytes.byteLength}});
    const out={success:true,fileUrl:publicUrl,fileId:key};
    if(kind==='pwa'){out.formFactor=String(data.formFactor||'').toLowerCase()==='wide'?'wide':'narrow';out.sizes=(Number(data.width)>0&&Number(data.height)>0)?`${Number(data.width)}x${Number(data.height)}`:(out.formFactor==='wide'?'1280x800':'750x1334');}
    return out;
  }catch(e){return {success:false,error:e.message};}
}
export async function uploadLogoToDriveSecure(data,auth,env){return uploadAsset(data,auth,env,'logo');}
export async function uploadPwaScreenshotToDriveSecure(data,auth,env){return uploadAsset(data,auth,env,'pwa');}
