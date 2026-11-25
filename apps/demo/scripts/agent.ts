/**
 * Agente de ejemplo en la terminal.
 *
 *   npm run agent            # con Tambo activado (por defecto)
 *   npm run agent -- --sin-tambo
 *
 * Crea una cuenta nueva de testnet (clave temporal, solo en memoria), la fondea con
 * Friendbot y ejecuta los mismos escenarios que la app web.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { NETWORK, explorerTx, short } from "../src/config";
import { fundAgent, runScenario } from "../src/runner";
import { SCENARIOS } from "../src/scenarios";

const tamboEnabled = !process.argv.includes("--sin-tambo");
const keypair = Keypair.random();

console.log(`\nTambo ${tamboEnabled ? "ACTIVADO" : "DESACTIVADO"} · red: testnet`);
console.log(`Agente: ${keypair.publicKey()}`);
console.log("Fondeando con Friendbot…");
await fundAgent(keypair.publicKey());
await new Promise((ok) => setTimeout(ok, 4000));

let correct = 0;
for (const s of SCENARIOS) {
  const r = await runScenario(s, { keypair, tamboEnabled });
  const label =
    r.status === "blocked" ? "BLOQUEADA" : r.status === "confirmed" ? "PERMITIDA " : r.status === "signed" ? "FIRMADA (sin revisión)" : "ERROR";
  const ok = tamboEnabled ? (r.status === "blocked") === (s.expected === "block") && r.status !== "failed" : undefined;
  if (ok) correct++;
  console.log(`\n▸ ${s.title}\n  ${s.story}\n  → ${label}${ok === false ? "  (no era lo esperado)" : ""}`);
  for (const f of r.verdict?.findings ?? []) {
    console.log(`    [${f.severity}] ${f.rule}${f.target ? ` (${short(f.target)})` : ""}: ${f.message}`);
  }
  if (r.hash) console.log(`    ${explorerTx(r.hash)}`);
  if (r.error) console.log(`    ${r.error}`);
}

if (tamboEnabled) console.log(`\nResultado: ${correct}/${SCENARIOS.length} escenarios resueltos como se esperaba.`);
console.log(`Cuenta del agente: ${NETWORK.explorer}/account/${keypair.publicKey()}\n`);
