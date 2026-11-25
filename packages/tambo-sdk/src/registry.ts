import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { ContractStatus, Intel, ThreatInfo } from "./types.js";

/** Cuenta "nula" válida: sirve como fuente en simulaciones de solo lectura. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const THREAT_KINDS: Record<number, string> = {
  1: "estafa",
  2: "drenador",
  3: "phishing",
  4: "contrato malicioso",
};

export interface RegistryOptions {
  rpcUrl: string;
  registryId: string;
  networkPassphrase?: string;
  allowHttp?: boolean;
}

/** Lee la lista de amenazas del contrato de Soroban, solo con simulaciones (gratis). */
export class RegistryIntel implements Intel {
  readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly passphrase: string;
  private readonly statusCache = new Map<string, ContractStatus>();

  constructor(opts: RegistryOptions) {
    this.server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.allowHttp ?? opts.rpcUrl.startsWith("http://") });
    this.contract = new Contract(opts.registryId);
    this.passphrase = opts.networkPassphrase ?? Networks.TESTNET;
  }

  private async read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "100",
      networkPassphrase: this.passphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`El contrato de amenazas respondió con error en ${method}: ${sim.error}`);
    }
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`Simulación sin resultado en ${method}`);
    }
    return scValToNative(sim.result.retval);
  }

  async threats(addresses: string[]): Promise<Map<string, ThreatInfo>> {
    const out = new Map<string, ThreatInfo>();
    for (let i = 0; i < addresses.length; i += 50) {
      const chunk = addresses.slice(i, i + 50);
      const arg = nativeToScVal(
        chunk.map((a) => new Address(a)),
        { type: "vec" } as never,
      );
      const res = (await this.read("check_many", arg)) as Array<
        { kind: number; reason: string } | null | undefined
      >;
      res.forEach((t, idx) => {
        if (t) out.set(chunk[idx]!, { kind: THREAT_KINDS[Number(t.kind)] ?? "amenaza", reason: t.reason });
      });
    }
    return out;
  }

  async isWasmVerified(hashHex: string): Promise<boolean> {
    const arg = nativeToScVal(Buffer.from(hashHex, "hex"), { type: "bytes" });
    return (await this.read("is_wasm_verified", arg)) === true;
  }

  async contractStatus(contractId: string): Promise<ContractStatus> {
    const cached = this.statusCache.get(contractId);
    if (cached) return cached;
    let status: ContractStatus = { kind: "unknown", verified: false };
    try {
      const key = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: new Address(contractId).toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent,
        }),
      );
      const res = await this.server.getLedgerEntries(key);
      const entry = res.entries[0];
      if (entry) {
        const data = entry.val as unknown as { contractData: xdr.ContractDataEntry };
        const inst = data.contractData.val as unknown as { instance: { executable: { type: string; wasmHash?: Uint8Array } } };
        const exec = inst.instance.executable;
        if (exec.type === "contractExecutableStellarAsset") {
          status = { kind: "sac", verified: true };
        } else {
          const hash = Buffer.from(exec.wasmHash as Uint8Array).toString("hex");
          status = { kind: "wasm", wasmHash: hash, verified: await this.isWasmVerified(hash) };
        }
      }
    } catch {
      // Si no se puede leer, queda "unknown" y la política decide (por defecto, bloquea).
    }
    this.statusCache.set(contractId, status);
    return status;
  }
}
