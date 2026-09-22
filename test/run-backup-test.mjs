import assert from 'node:assert/strict';
import { backupDatabaseToR2, runDatabaseBackup } from '../src/actions/backup.js';

class FakeStmt {
  constructor(db, sql){ this.db=db; this.sql=sql; }
  bind(){ return this; }
  async first(){
    if(this.sql.includes("FROM settings WHERE key")) return null;
    return null;
  }
  async run(){ return {success:true}; }
  async all(){
    if(this.sql.includes('sqlite_master')) return {results:[{name:'settings',sql:'CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)'},{name:'students',sql:'CREATE TABLE students (id TEXT)'}]};
    if(this.sql.includes('"settings"')) return {results:[{key:'schoolName',value:'Demo'}]};
    if(this.sql.includes('"students"')) return {results:[{id:'STU-1'}]};
    return {results:[]};
  }
}
class FakeDB {
  prepare(sql){ return new FakeStmt(this,sql); }
}
class FakeR2 {
  constructor(){this.objects=new Map();}
  async put(key,body,opts){ this.objects.set(key,{body,opts}); }
}
const db=new FakeDB();
const bucket=new FakeR2();
const env={DB:db,BACKUP_BUCKET:bucket,ORG_ID:'TEST'};
const viewer={id:'u1',is_master:1,isMaster:true,permissions:{}};
const auth={token:'t'};
// loadViewer is intentionally bypassed by the test through a tiny module-level
// replacement would be brittle; instead exercise the cron-only trusted path.
const result=await runDatabaseBackup(env);
assert.equal(result.success,true);
assert.equal(result.orgId,'TEST');
assert.equal(bucket.objects.size,1);
assert.match(result.key,/^backups\/TEST\/.*\.json\.gz$/);
console.log('backup tests passed');
