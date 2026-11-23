// Reset manual do banco de demonstração: npm run reset-db
import fs from "node:fs";
import { env } from "../config/env.js";
import { abrirBanco, fecharBanco } from "./conexao.js";
import { popularSeeds } from "./seed.js";

for (const sufixo of ["", "-wal", "-shm"]) {
  const f = env.DB_PATH + sufixo;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
abrirBanco();
popularSeeds();
fecharBanco();
console.log("Banco recriado com seeds de demonstração:", env.DB_PATH);
