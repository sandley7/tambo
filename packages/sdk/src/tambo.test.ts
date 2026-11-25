import { Account, Asset, Contract, Keypair, Networks, Operation, StrKey, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { decodeTransaction } from "./decode.js";
import { evaluate, toStroops } from "./rules.js";
import type { Action, Intel } from "./types.js";

const GOOD = Keypair.random().publicKey();
const BAD = Keypair.random().publicKey();
const SPENDER = Keypair.random().publicKey();
const VERIFIED_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1));
const ROGUE_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2));

const intel: Intel = {
  async threats(addrs) {
    const m = new Map();
    for (const a of addrs) if (a === BAD) m.set(a, { kind: "estafa", reason: "reportado" });
    return m;
  },
  async contractStatus(id) {
    if (id === VERIFIED_CONTRACT) return { kind: "wasm", wasmHash: "aa".repeat(32), verified: true };
    return { kind: "wasm", wasmHash: "bb".repeat(32), verified: false };
  },
};

const pay = (destination: string, amount = "10"): Action => ({ kind: "payment", destination, asset: "XLM", amount });
const invoke = (contract: string, fn: string, args: unknown[] = []): Action => ({ kind: "invoke", contract, fn, args, source: "tx", depth: 0 });

describe("evaluate", () => {
  it("permite un pago normal", async () => {
    const v = await evaluate([pay(GOOD)], intel);
    expect(v.decision).toBe("allow");
  });

  it("bloquea un destino reportado", async () => {
    const v = await evaluate([pay(BAD)], intel);
    expect(v.decision).toBe("block");
    expect(v.findings[0]?.rule).toBe("reported-address");
  });

  it("bloquea pagos sobre el tope y respeta el tope exacto", async () => {
    const policy = { maxPayment: { XLM: "100" } };
    expect((await evaluate([pay(GOOD, "100")], intel, policy)).decision).toBe("allow");
    expect((await evaluate([pay(GOOD, "100.0000001")], intel, policy)).decision).toBe("block");
  });

  it("bloquea destinos fuera de la lista permitida", async () => {
    const v = await evaluate([pay(GOOD)], intel, { allowedDestinations: [SPENDER] });
    expect(v.findings.map((f) => f.rule)).toContain("destination-not-allowed");
  });

  it("bloquea contratos con WASM no verificado, pero no los verificados", async () => {
    expect((await evaluate([invoke(ROGUE_CONTRACT, "hello")], intel)).findings[0]?.rule).toBe("unverified-contract");
    expect((await evaluate([invoke(VERIFIED_CONTRACT, "hello")], intel)).decision).toBe("allow");
  });

  it("la política puede degradar contratos no verificados a advertencia", async () => {
    const v = await evaluate([invoke(ROGUE_CONTRACT, "hello")], intel, { unverifiedContract: "warn" });
    expect(v.decision).toBe("allow");
    expect(v.findings[0]?.severity).toBe("warn");
  });

  it("bloquea approve a un gastador desconocido y permite uno de confianza", async () => {
    const call = invoke(VERIFIED_CONTRACT, "approve", [GOOD, SPENDER, 1000n, 99999]);
    expect((await evaluate([call], intel)).findings.map((f) => f.rule)).toContain("unknown-spender");
    expect((await evaluate([call], intel, { trustedSpenders: [SPENDER] })).decision).toBe("allow");
  });

  it("bloquea un approve a una dirección reportada aunque sea de confianza el contrato", async () => {
    const call = invoke(VERIFIED_CONTRACT, "approve", [GOOD, BAD, 1n, 1]);
    const v = await evaluate([call], intel, { trustedSpenders: [BAD] });
    expect(v.decision).toBe("block");
    expect(v.findings.some((f) => f.rule === "reported-address")).toBe(true);
  });

  it("bloquea cambios de firmantes y fusión de cuenta", async () => {
    expect((await evaluate([{ kind: "set_options", changes: ["firmante"] }], intel)).decision).toBe("block");
    expect((await evaluate([{ kind: "account_merge", destination: GOOD }], intel)).decision).toBe("block");
    expect((await evaluate([{ kind: "set_options", changes: ["firmante"] }], intel, { blockAccountChanges: false })).decision).toBe("allow");
  });
});

describe("toStroops", () => {
  it("convierte decimales sin perder precisión", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("12.5000000")).toBe(125_000_000n);
  });
});

describe("decodeTransaction", () => {
  const source = new Account(Keypair.random().publicKey(), "1");
  const build = (...ops: any[]) => {
    let b = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET }).setTimeout(60);
    for (const op of ops) b = b.addOperation(op);
    return b.build().toXDR();
  };

  it("decodifica pagos, setOptions y llamadas a contratos desde el XDR", () => {
    const xdr = build(
      Operation.payment({ destination: GOOD, asset: Asset.native(), amount: "5" }),
      Operation.setOptions({ signer: { ed25519PublicKey: BAD, weight: 1 } }),
      new Contract(VERIFIED_CONTRACT).call("approve", nativeToScVal(GOOD, { type: "address" }), nativeToScVal(SPENDER, { type: "address" }), nativeToScVal(10n, { type: "i128" }), nativeToScVal(100, { type: "u32" })),
    );
    // Una operación Soroban no se mezcla con otras en la red real, pero para decodificar basta.
    const d = decodeTransaction(xdr, Networks.TESTNET);
    expect(d.hasSoroban).toBe(true);
    const kinds = d.actions.map((a) => a.kind);
    expect(kinds).toEqual(["payment", "set_options", "invoke"]);
    const inv = d.actions[2] as Extract<Action, { kind: "invoke" }>;
    expect(inv.fn).toBe("approve");
    expect(inv.contract).toBe(VERIFIED_CONTRACT);
    expect(inv.args[1]).toBe(SPENDER);
  });
});
