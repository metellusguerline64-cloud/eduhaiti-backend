import { canAccessStudent, filterStudents } from "../src/lib/accessScope.js";
const teacher={userId:"T01",email:"teacher@example.com",permissions:{pt_view_student_profile:true},accessScope:{classes:["6eme"],cycles:[],studentIds:[],selfOnly:false,restricted:true}};
console.assert(canAccessStudent(teacher,{StudentCode:"S1",CurrentLevel:"6EME",Section:"A"}).allowed,"class match");
console.assert(!canAccessStudent(teacher,{StudentCode:"S2",CurrentLevel:"NS1",Section:"A"}).allowed,"outside class rejected");
const scoped=filterStudents(teacher,[{StudentCode:"S1",CurrentLevel:"6EME"},{StudentCode:"S2",CurrentLevel:"NS1"}]);
console.assert(scoped.length===1 && scoped[0].StudentCode==="S1","list filtered");
console.log("access-scope tests passed");
