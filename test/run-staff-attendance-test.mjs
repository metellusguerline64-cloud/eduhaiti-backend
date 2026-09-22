import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { storeSessionToken } from "../src/lib/session.js";
import { clockInStaff, getStaffAttendance } from "../src/actions/attendance.js";

const DB_PATH="/tmp/eduhaiti-staff-attendance-test.sqlite";
try{fs.unlinkSync(DB_PATH);}catch{}
const db=makeD1(DB_PATH);
db._raw.exec(fs.readFileSync(new URL("../schema.sql",import.meta.url),"utf8"));
db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','ORG1')`).run();
db._raw.prepare(`INSERT INTO users(id,user_id,email,name,password_hash,role,permissions_json,is_teacher,assigned_subjects,is_master,is_god_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run("U1","U1","teacher@school.ht","Teacher One","x","Teacher",JSON.stringify({p_hr_attendance:true}),1,"[]",0,0);
const env={DB:db,ORG_ID:"ORG1"};
const token="staff-token";
await storeSessionToken(db,token,{userId:"U1",email:"teacher@school.ht",role:"Teacher"});
const auth={token};

console.log("=== staff attendance: unauthenticated ===");
console.assert((await clockInStaff({},null,env)).success===false);

console.log("=== staff attendance: first scan creates STAFF attendance row ===");
const first=await clockInStaff({email:"teacher@school.ht",status:"PRESENT"},auth,env);
console.assert(first.success===true && first.status==="CHECKED_IN",first);
const row1=db._raw.prepare(`SELECT * FROM attendance WHERE student_id='teacher@school.ht' AND grade_level_id='STAFF'`).get();
console.assert(row1 && row1.status==="PRESENT",row1);
const meta1=JSON.parse(row1.meta_json); console.assert(meta1.type==="STAFF" && meta1.checkIn,"checkIn metadata",meta1);

console.log("=== staff attendance: second scan closes the same punch ===");
const second=await clockInStaff({email:"teacher@school.ht"},auth,env);
console.assert(second.success===true && second.status==="CHECKED_OUT",second);
const rows=db._raw.prepare(`SELECT * FROM attendance WHERE student_id='teacher@school.ht' AND grade_level_id='STAFF'`).all();
console.assert(rows.length===1,"Second scan must not create another row",rows);
const meta2=JSON.parse(rows[0].meta_json); console.assert(meta2.checkOut,"checkOut metadata",meta2);

console.log("=== staff attendance: get own history ===");
const listed=await getStaffAttendance({email:"teacher@school.ht"},auth,env);
console.assert(listed.success===true && listed.data.length===1,listed);

console.log("=== staff attendance: cannot read another employee ===");
const denied=await getStaffAttendance({email:"other@school.ht"},auth,env);
console.assert(denied.success===true && denied.data.length===0,"Teacher must not receive another employee attendance",denied);

console.log("\nAll staff attendance assertions passed.");
