import type { Action, Finding, Intel, Policy, Verdict } from "./types.js";

const STROOPS = 10_000_000n;

/** Convierte un decimal de Stellar ("12.5000000") a stroops sin perder precisión. */
export function toStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS + BigInt(fracPadded || "0");
}

function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^[GC][A-Z2-7]{55}$/.test(v);
}

/** Direcciones que aparecen en una acción y que vale la pena consultar en la lista de amenazas. */
export function addressesOf(a: Action): string[] {
  switch (a.kind) {
    case "payment":
    case "account_merge":
      return [a.destination];
    case "invoke":
      return [a.contract, ...a.args.filter(isAddress)];
    default:
      return [];
  }
}

/**
 * Aplica las reglas de Tambo. No toca la red por sí misma: todo lo externo
 * (lista de amenazas, estado de contratos) entra por `intel`.
 */
export async function evaluate(
  actions: Action[],
  intel: Intel,
  policy: Policy = {},
): Promise<Verdict> {
  const findings: Finding[] = [];
  const allowedDest = policy.allowedDestinations ? new Set(policy.allowedDestinations) : null;
  const trustedContracts = new Set(policy.trustedContracts ?? []);
  const trustedSpenders = new Set(policy.trustedSpenders ?? []);
  const unverified = policy.unverifiedContract ?? "block";
  const blockAccountChanges = policy.blockAccountChanges ?? true;

  // 1) Lista de amenazas: una sola consulta para todas las direcciones.
  const all = [...new Set(actions.flatMap(addressesOf))];
  const threats = all.length ? await intel.threats(all) : new Map();
  for (const addr of all) {
    const t = threats.get(addr);
    if (t) {
      findings.push({
        rule: "reported-address",
        severity: "block",
        target: addr,
        message: `Dirección reportada como ${t.kind}: ${t.reason}`,
      });
    }
  }

  // 2) Reglas por acción.
  const checkedContracts = new Set<string>();
  for (const a of actions) {
    switch (a.kind) {
      case "payment": {
        if (allowedDest && !allowedDest.has(a.destination)) {
          findings.push({
            rule: "destination-not-allowed",
            severity: "block",
            target: a.destination,
            message: "El destino no está en la lista de destinos permitidos del agente.",
          });
        }
        const cap = policy.maxPayment?.[a.asset] ?? policy.maxPayment?.["*"];
        if (cap !== undefined && toStroops(a.amount) > toStroops(cap)) {
          findings.push({
            rule: "payment-over-limit",
            severity: "block",
            target: a.destination,
            message: `Pago de ${a.amount} ${a.asset} supera el tope de ${cap}.`,
          });
        }
        break;
      }
      case "account_merge": {
        if (!allowedDest || !allowedDest.has(a.destination)) {
          findings.push({
            rule: "account-merge",
            severity: "block",
            target: a.destination,
            message: "Fusionar la cuenta transfiere todos sus fondos y la cierra.",
          });
        }
        break;
      }
      case "set_options": {
        if (blockAccountChanges && a.changes.length > 0) {
          findings.push({
            rule: "account-takeover",
            severity: "block",
            message: `Cambia la seguridad de la cuenta (${a.changes.join(", ")}): puede dar el control a un tercero.`,
          });
        }
        break;
      }
      case "invoke": {
        if (!checkedContracts.has(a.contract)) {
          checkedContracts.add(a.contract);
          if (!trustedContracts.has(a.contract)) {
            const st = await intel.contractStatus(a.contract);
            if (st.kind !== "sac" && !st.verified && unverified !== "allow") {
              findings.push({
                rule: "unverified-contract",
                severity: unverified === "block" ? "block" : "warn",
                target: a.contract,
                message:
                  st.kind === "unknown"
                    ? "No se pudo identificar el contrato (no existe o no se pudo leer)."
                    : `El WASM del contrato (${st.wasmHash?.slice(0, 12)}…) no está en la lista de verificados.`,
              });
            }
          }
        }
        if (a.fn === "approve" && a.args.length >= 2) {
          const spender = a.args[1];
          if (isAddress(spender) && !trustedSpenders.has(spender)) {
            findings.push({
              rule: "unknown-spender",
              severity: "block",
              target: spender,
              message: "Aprueba a un gastador desconocido para mover fondos del agente.",
            });
          }
        }
        if ((a.fn === "transfer" || a.fn === "transfer_from") && allowedDest) {
          const dest = a.fn === "transfer" ? a.args[1] : a.args[2];
          if (isAddress(dest) && !allowedDest.has(dest)) {
            findings.push({
              rule: "destination-not-allowed",
              severity: "block",
              target: dest,
              message: "La transferencia va a un destino que el agente no tiene permitido.",
            });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const decision = findings.some((f) => f.severity === "block") ? "block" : "allow";
  return { decision, findings, actions };
}
