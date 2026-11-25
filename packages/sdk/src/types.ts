/** Qué hace una transacción, ya decodificado y sin depender de la red. */
export type Action =
  | { kind: "payment"; destination: string; asset: string; amount: string }
  | {
      kind: "invoke";
      contract: string;
      fn: string;
      /** Argumentos convertidos a valores nativos (direcciones como string). */
      args: unknown[];
      /** "tx" si la llamada va directo en la transacción; "auth" si salió de la simulación (sub-llamadas). */
      source: "tx" | "auth";
      depth: number;
    }
  | {
      kind: "set_options";
      /** Qué campos de seguridad de la cuenta intenta cambiar. */
      changes: string[];
    }
  | { kind: "account_merge"; destination: string }
  | { kind: "change_trust"; asset: string }
  | { kind: "other"; type: string };

export type Severity = "block" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Dirección o contrato involucrado, si aplica. */
  target?: string;
}

export interface Verdict {
  decision: "allow" | "block";
  findings: Finding[];
  actions: Action[];
}

export interface ThreatInfo {
  kind: string;
  reason: string;
}

export interface ContractStatus {
  /** "sac" = contrato de activo de Stellar (incorporado en la red); "wasm" = contrato propio. */
  kind: "sac" | "wasm" | "unknown";
  wasmHash?: string;
  verified: boolean;
}

/** Fuente de inteligencia de amenazas. La implementación real lee el contrato de Soroban. */
export interface Intel {
  threats(addresses: string[]): Promise<Map<string, ThreatInfo>>;
  contractStatus(contractId: string): Promise<ContractStatus>;
}

export interface Policy {
  /** Si se define, los pagos y transferencias solo pueden ir a estas direcciones. */
  allowedDestinations?: string[];
  /** Contratos que el agente puede invocar sin verificación de WASM. */
  trustedContracts?: string[];
  /** Gastadores permitidos en `approve`. Cualquier otro se bloquea. */
  trustedSpenders?: string[];
  /** Tope por pago nativo (XLM u otro asset de classic), en decimal. Clave: "XLM", "CODE:ISSUER" o "*". */
  maxPayment?: Record<string, string>;
  /** Qué hacer con contratos cuyo WASM no está verificado. Por defecto: "block". */
  unverifiedContract?: "block" | "warn" | "allow";
  /** Bloquear cambios de firmantes, umbrales o peso de la clave maestra. Por defecto: true. */
  blockAccountChanges?: boolean;
}
