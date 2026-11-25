import {
  Contract,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  Asset,
  type Transaction,
  type rpc,
} from "@stellar/stellar-sdk";
import { IDS, NETWORK } from "./config";

export interface ScenarioContext {
  server: rpc.Server;
  agent: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** Lo que "pasó" desde el punto de vista del agente. */
  story: string;
  expected: "allow" | "block";
  build(ctx: ScenarioContext): Promise<Transaction>;
}

async function base(ctx: ScenarioContext) {
  const account = await ctx.server.getAccount(ctx.agent);
  return new TransactionBuilder(account, { fee: "100000", networkPassphrase: NETWORK.passphrase }).setTimeout(120);
}

const addr = (a: string) => nativeToScVal(a, { type: "address" });

export const SCENARIOS: Scenario[] = [
  {
    id: "pay-provider",
    title: "Pagar 5 XLM al proveedor",
    story: "El agente paga una factura normal a una cuenta conocida.",
    expected: "allow",
    async build(ctx) {
      return (await base(ctx))
        .addOperation(Operation.payment({ destination: IDS.provider, asset: Asset.native(), amount: "5" }))
        .build();
    },
  },
  {
    id: "call-vendor",
    title: "Llamar al servicio verificado",
    story: "El agente consume un servicio cuyo contrato está en la lista de verificados.",
    expected: "allow",
    async build(ctx) {
      return (await base(ctx)).addOperation(new Contract(IDS.vendor).call("ping", addr(ctx.agent))).build();
    },
  },
  {
    id: "pay-scammer",
    title: "Pagar a un destino reportado",
    story: "Una instrucción inyectada le pide pagar a una cuenta marcada como estafa en la lista compartida.",
    expected: "block",
    async build(ctx) {
      return (await base(ctx))
        .addOperation(Operation.payment({ destination: IDS.scammer, asset: Asset.native(), amount: "5" }))
        .build();
    },
  },
  {
    id: "approve-attacker",
    title: "Aprobar a un gastador desconocido",
    story: "Le piden aprobar que otra cuenta gaste hasta 1.000 XLM de los fondos del agente.",
    expected: "block",
    async build(ctx) {
      const { sequence } = await ctx.server.getLatestLedger();
      return (await base(ctx))
        .addOperation(
          new Contract(IDS.nativeAsset).call(
            "approve",
            addr(ctx.agent),
            addr(IDS.attacker),
            nativeToScVal(10_000_000_000n, { type: "i128" }),
            nativeToScVal(sequence + 5000, { type: "u32" }),
          ),
        )
        .build();
    },
  },
  {
    id: "call-rogue",
    title: "Llamar a un contrato no verificado",
    story: "El agente es dirigido a un contrato nuevo cuyo código nadie ha revisado.",
    expected: "block",
    async build(ctx) {
      return (await base(ctx)).addOperation(new Contract(IDS.rogue).call("count")).build();
    },
  },
  {
    id: "add-signer",
    title: "Añadir un firmante a la cuenta",
    story: "Intentan darle a un tercero control de la cuenta del agente.",
    expected: "block",
    async build(ctx) {
      return (await base(ctx))
        .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: IDS.attacker, weight: 1 } }))
        .build();
    },
  },
  {
    id: "pay-too-much",
    title: "Pagar 5.000 XLM de golpe",
    story: "Un pago legítimo en apariencia, pero 50 veces por encima del tope del agente.",
    expected: "block",
    async build(ctx) {
      return (await base(ctx))
        .addOperation(Operation.payment({ destination: IDS.provider, asset: Asset.native(), amount: "5000" }))
        .build();
    },
  },
];
