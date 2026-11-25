import {
  Keypair,
  Networks,
  rpc,
  type FeeBumpTransaction,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { actionsFromAuth, decodeTransaction } from "./decode.js";
import { RegistryIntel } from "./registry.js";
import { evaluate } from "./rules.js";
import type { Action, Finding, Intel, Policy, Verdict } from "./types.js";

export interface TamboOptions {
  rpcUrl: string;
  /** ID del contrato threat-registry. Ignorado si pasas `intel`. */
  registryId?: string;
  networkPassphrase?: string;
  policy?: Policy;
  /** Fuente de inteligencia propia (por ejemplo, para pruebas). */
  intel?: Intel;
}

export class TamboBlockedError extends Error {
  constructor(readonly verdict: Verdict) {
    super(
      "Tambo bloqueó la transacción: " +
        verdict.findings
          .filter((f) => f.severity === "block")
          .map((f) => f.message)
          .join(" | "),
    );
    this.name = "TamboBlockedError";
  }
}

const key = (a: Action) => (a.kind === "invoke" ? `${a.contract}|${a.fn}|${JSON.stringify(a.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))}` : null);

export class Tambo {
  private readonly passphrase: string;
  private readonly server: rpc.Server;
  private readonly intel: Intel;
  readonly policy: Policy;

  constructor(opts: TamboOptions) {
    this.passphrase = opts.networkPassphrase ?? Networks.TESTNET;
    this.server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.rpcUrl.startsWith("http://") });
    this.policy = opts.policy ?? {};
    if (opts.intel) {
      this.intel = opts.intel;
    } else if (opts.registryId) {
      this.intel = new RegistryIntel({
        rpcUrl: opts.rpcUrl,
        registryId: opts.registryId,
        networkPassphrase: this.passphrase,
      });
    } else {
      throw new Error("Tambo necesita `registryId` o una fuente `intel`.");
    }
  }

  /** Decodifica, simula y evalúa una transacción. No firma nada. */
  async inspect(input: string | Transaction | FeeBumpTransaction): Promise<Verdict> {
    const { tx, actions, hasSoroban } = decodeTransaction(input, this.passphrase);
    const extra: Finding[] = [];
    let all = actions;

    if (hasSoroban) {
      // La simulación revela las autorizaciones reales, incluidas las llamadas anidadas
      // que una revisión del XDR por sí sola no ve.
      try {
        const sim = await this.server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) {
          extra.push({
            rule: "simulation-failed",
            severity: "block",
            message: `La simulación falló, así que no se puede verificar qué hace: ${sim.error}`,
          });
        } else if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
          const seen = new Set(actions.map(key).filter(Boolean));
          const fromAuth = actionsFromAuth(sim.result.auth).filter((a) => !seen.has(key(a)));
          all = [...actions, ...fromAuth];
        }
      } catch (e) {
        extra.push({
          rule: "simulation-unavailable",
          severity: "block",
          message: `No se pudo simular la transacción: ${(e as Error).message}`,
        });
      }
    }

    const verdict = await evaluate(all, this.intel, this.policy);
    const findings = [...extra, ...verdict.findings];
    const decision = findings.some((f) => f.severity === "block") ? "block" : "allow";
    return { decision, findings, actions: all };
  }

  /** Como `inspect`, pero lanza `TamboBlockedError` si la transacción es peligrosa. */
  async assertSafe(input: string | Transaction | FeeBumpTransaction): Promise<Verdict> {
    const verdict = await this.inspect(input);
    if (verdict.decision === "block") throw new TamboBlockedError(verdict);
    return verdict;
  }

  /**
   * Envuelve la clave del agente: firma solo si Tambo permite la transacción.
   * Úsalo en lugar de `tx.sign(keypair)`.
   */
  guardSigner(keypair: Keypair) {
    return {
      publicKey: () => keypair.publicKey(),
      signTransaction: async (xdrString: string) => {
        const verdict = await this.assertSafe(xdrString);
        const tx = TransactionBuilder.fromXDR(xdrString, this.passphrase);
        tx.sign(keypair);
        return { signedTxXdr: tx.toXDR(), signerAddress: keypair.publicKey(), verdict };
      },
    };
  }
}
