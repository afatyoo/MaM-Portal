import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const ADMIN_FILE = process.env.ADMIN_FILE || path.join(DATA_DIR, "admin_users.json");

function ask(q){
  return new Promise(r=>{
    process.stdout.write(q);
    process.stdin.once("data",d=>r(String(d).trim()));
  });
}

async function main(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
  if(!fs.existsSync(ADMIN_FILE)) fs.writeFileSync(ADMIN_FILE, JSON.stringify({users:[]},null,2),"utf8");

  const db = JSON.parse(fs.readFileSync(ADMIN_FILE,"utf8"));
  db.users = db.users || [];

  const username = await ask("Admin username: ");
  const password = await ask("Admin password: ");

  if(!username || !password){ console.log("username/password wajib diisi"); process.exit(1); }
  if(db.users.some(u=>u.username===username)){ console.log("username sudah ada"); process.exit(1); }

  db.users.push({
    username,
    password_hash: await bcrypt.hash(password, 12),
    created_at: new Date().toISOString()
  });

  fs.writeFileSync(ADMIN_FILE, JSON.stringify(db,null,2), "utf8");
  console.log("OK. Admin user dibuat:", username);
}
main().catch(e=>{ console.error(e); process.exit(1); });
