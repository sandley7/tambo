import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { Tambo, TamboBlockedError, type Verdict } from "tambo-sdk";
import { IDS, NETWORK, POLICY } from "./config";
import type { Scenario } from "./scenarios";

export interface RunResult {
  /** "blocked": Tambo lo detuvo. "confirmed": firmado y confirmado en testnet. "signed": firmado sin revisión y no enviado. */
  status: "blocked" | "confirmed" | "signed" | "failed";
  verdict?: Verdict;
  hash?: string;
  error?: string;
}

export function makeServer() {
  return new rpc.Server(NETWORK.rpcUrl);
}

export function makeTambo() {
  return new Tambo({
    rpcUrl: NETWORK.rpcUrl,
    registryId: IDS.registry,
    networkPassphrase: NETWORK.passphrase,
    policy: POLICY,
  });
}

export async function fundAgent(address: string): Promise<void> {
  const res = await fetch(`${NETWORK.friendbot}/?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error(`Friendbot respondió ${res.status}`);
}

async function waitFor(server: rpc.Server, hash: string): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    const r = await server.getTransaction(hash);
    if (r.status === "SUCCESS") return true;
    if (r.status === "FAILED") return false;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error("La transacción no se confirmó a tiempo");
}

/**
 * Ejecuta un escenario. Con Tambo activado, la firma pasa por el firewall.
 * Sin Tambo, el agente firma lo que le pongan delante (y solo se envía si el escenario es legítimo).
 */
export async function runScenario(
  scenario: Scenario,
  opts: { keypair: Keypair; tamboEnabled: boolean },
): Promise<RunResult> {
  const server = makeServer();
  const tambo = makeTambo();
  try {
    let tx = await scenario.build({ server, agent: opts.keypair.publicKey() });
    try {
      // Las llamadas a contratos necesitan huella y autorizaciones: se preparan con la simulación.
      tx = await server.prepareTransaction(tx);
    } catch {
      // Si no se puede preparar, se deja tal cual: Tambo informará del fallo de simulación.
    }

    let signedXdr: string;
    let verdict: Verdict | undefined;
    if (opts.tamboEnabled) {
      const signer = tambo.guardSigner(opts.keypair);
      const out = await signer.signTransaction(tx.toXDR());
      signedXdr = out.signedTxXdr;
      verdict = out.verdict;
    } else {
      tx.sign(opts.keypair);
      signedXdr = tx.toXDR();
    }

    if (!opts.tamboEnabled && scenario.expected === "block") {
      return { status: "signed" };
    }

    const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase);
    const sent = await server.sendTransaction(signed);
    if (sent.status === "ERROR") return { status: "failed", verdict, error: "La red rechazó la transacción" };
    const ok = await waitFor(server, sent.hash);
    return { status: ok ? "confirmed" : "failed", verdict, hash: sent.hash };
  } catch (e) {
    if (e instanceof TamboBlockedError) return { status: "blocked", verdict: e.verdict };
    return { status: "failed", error: (e as Error).message };
  }
}
