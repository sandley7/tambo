import {
  Address,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Asset,
  type OperationRecord,
} from "@stellar/stellar-sdk";
import type { Action } from "./types.js";

export function assetName(asset: Asset): string {
  return asset.isNative() ? "XLM" : `${asset.getCode()}:${asset.getIssuer()}`;
}

function nativeArg(v: xdr.ScVal): unknown {
  try {
    const n = scValToNative(v);
    // Address, Buffer, bigint… se normalizan a algo imprimible.
    if (n instanceof Address) return n.toString();
    return n;
  } catch {
    return `<${v.type}>`;
  }
}

function invokeToAction(
  args: xdr.InvokeContractArgs,
  source: "tx" | "auth",
  depth: number,
): Action {
  return {
    kind: "invoke",
    contract: Address.fromScAddress(args.contractAddress).toString(),
    fn: args.functionName.toString(),
    args: args.args.map(nativeArg),
    source,
    depth,
  };
}

/** Recorre el árbol de autorizaciones (llamadas anidadas) que devuelve la simulación. */
export function actionsFromAuth(auth: xdr.SorobanAuthorizationEntry[]): Action[] {
  const out: Action[] = [];
  const walk = (inv: xdr.SorobanAuthorizedInvocation, depth: number) => {
    const fn = inv.function;
    if (fn.type === "sorobanAuthorizedFunctionTypeContractFn") {
      out.push(invokeToAction(fn.contractFn, "auth", depth));
    }
    for (const sub of inv.subInvocations) walk(sub, depth + 1);
  };
  for (const entry of auth) walk(entry.rootInvocation, 0);
  return out;
}

function operationToActions(op: OperationRecord): Action[] {
  switch (op.type) {
    case "payment":
      return [
        {
          kind: "payment",
          destination: op.destination,
          asset: assetName(op.asset),
          amount: op.amount,
        },
      ];
    case "pathPaymentStrictSend":
    case "pathPaymentStrictReceive":
      return [
        {
          kind: "payment",
          destination: op.destination,
          asset: assetName(op.destAsset),
          amount: op.type === "pathPaymentStrictSend" ? op.destMin : op.destAmount,
        },
      ];
    case "accountMerge":
      return [{ kind: "account_merge", destination: op.destination }];
    case "changeTrust":
      return [
        {
          kind: "change_trust",
          asset: "line" in op && op.line && "code" in op.line ? `${op.line.code}:${op.line.issuer}` : "pool",
        },
      ];
    case "setOptions": {
      const changes: string[] = [];
      if (op.signer) changes.push("firmante");
      if (op.masterWeight !== undefined) changes.push("peso de la clave maestra");
      if (op.lowThreshold !== undefined || op.medThreshold !== undefined || op.highThreshold !== undefined)
        changes.push("umbrales");
      return [{ kind: "set_options", changes }];
    }
    case "invokeHostFunction": {
      const func = op.func;
      if (func.type === "hostFunctionTypeInvokeContract") {
        return [invokeToAction(func.invokeContract, "tx", 0)];
      }
      // Subir o crear contratos desde un agente es inusual: lo marcamos para revisión.
      return [{ kind: "other", type: `invokeHostFunction:${func.type}` }];
    }
    default:
      return [{ kind: "other", type: op.type }];
  }
}

export interface Decoded {
  tx: Transaction;
  actions: Action[];
  hasSoroban: boolean;
}

/** Decodifica un XDR (o una transacción) en acciones legibles. */
export function decodeTransaction(
  input: string | Transaction | FeeBumpTransaction,
  networkPassphrase: string,
): Decoded {
  let parsed: Transaction | FeeBumpTransaction =
    typeof input === "string" ? TransactionBuilder.fromXDR(input, networkPassphrase) : input;
  const tx: Transaction = "innerTransaction" in parsed ? parsed.innerTransaction : parsed;
  const actions = tx.operations.flatMap(operationToActions);
  const hasSoroban = tx.operations.some((o) => o.type === "invokeHostFunction");
  return { tx, actions, hasSoroban };
}
