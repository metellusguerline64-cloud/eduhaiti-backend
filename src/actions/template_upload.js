// EduHaïti — R2 replacement for Code.gs handleTemplateUpload_.
// Stores bulletin templates in the tenant MEDIA_BUCKET and records metadata in media_library.
import { loadViewer } from '../lib/accessScope.js';
import { resolveOrgId } from '../lib/org.js';
import { writeAudit } from '../lib/audit.js';

const now=()=>new Date().toISOString();
const safe=s=>String(s||'Bulletin_Meigens').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,140);
const decode=s=>{let x=String(s||'');const i=x.indexOf(',');if(i>=0)x=x.slice(i+1);x=x.replace(/\s/g,'');const b=atob(x),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};

export async function handleTemplateUpload(data={},auth,env){
  try{
    const v=auth?.token?await loadViewer(env,auth):null;
    if(!v)return {success:false,error:'Session invalide.'};
    if(!(v.isMaster||v.isGodMode||v.permissions?.p_settings||v.permissions?.pa_save_settings))return {success:false,error:'Droits insuffisants.'};
    if(!env.MEDIA_BUCKET)return {success:false,error:'Stockage média non configuré : ajoutez le binding R2 MEDIA_BUCKET.'};
    if(!data.base64)return {success:false,error:'base64 requis'};
    const org=await resolveOrgId(env), mime=String(data.type||'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const original=safe(String(data.name||'Bulletin_Meigens')).replace(/\.[^/.]+$/,'');
    const ext=mime.includes('wordprocessingml')?'.docx':mime==='application/pdf'?'.pdf':'';
    const key=`${org}/templates/${Date.now()}-${original}${ext}`;
    const bytes=decode(data.base64);
    await env.MEDIA_BUCKET.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'private, max-age=0'}});
    const id=`TPL_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    const ts=now();
    await env.DB.prepare(`INSERT INTO media_library(id,org_id,title,type,source,url,file_id,mime,size_bytes,thumbnail,cycle,level,classes_csv,subject,description,tags_csv,uploaded_by,created_at,updated_at,version,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)`).bind(id,org,original,'DOCUMENT','R2',`/media/${encodeURIComponent(key)}`,key,mime,bytes.byteLength,'','','','','','Modèle de bulletin','template',String(v.email||v.userId||''),ts,ts).run();
    await writeAudit(env.DB,{table:'media_library',rowId:id,userId:v.id,op:'insert',diff:{templateUpload:true,key,name:original,mime,size:bytes.byteLength}});
    return {success:true,ok:true,docId:key,fileId:key,id,url:`/media/${encodeURIComponent(key)}`,viewUrl:`/media/${encodeURIComponent(key)}`,message:'Modèle créé.'};
  }catch(e){return {success:false,error:e?.message||String(e)}}
}
