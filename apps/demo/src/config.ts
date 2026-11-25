import { Networks } from "@stellar/stellar-sdk";
import type { Policy } from "tambo-sdk";

/** Todo es testnet. Estos IDs son públicos; ninguna clave secreta vive en el repo. */
export const NETWORK = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: Networks.TESTNET,
  friendbot: "https://friendbot.stellar.org",
  explorer: "https://stellar.expert/explorer/testnet",
} as const;

export const IDS = {
  /** Contrato threat-registry: la lista compartida de amenazas. */
  registry: "CCDBZ54XFIG4TWC6GUGLAFCJDAKBHQ3ZQRIIR62XUEVI6GOHCN5RBDLH",
  /** Servicio legítimo cuyo WASM está verificado en el registro. */
  vendor: "CC5GY35LYAF6E7R7S4ECQYJK2OLA3OSPAZWAOY3D2OEGIXLY3Q6OAKCT",
  /** Contrato cuyo WASM NO está verificado. */
  rogue: "CBW3JSH35RBUE54EVJH7EKA2ROPY4RCGQPOJZ7XMMLBCMPK2VVAAU3T2",
  /** Contrato del activo nativo (XLM) en testnet. */
  nativeAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  /** Cuenta del proveedor que recibe pagos legítimos. */
  provider: "GBRPCZQEWOL6H43TWSSZRGU4O67V5ZNB5NCTQMHYSEV4SXVZEEWOKFL4",
  /** Destino reportado como estafa en el registro. */
  scammer: "GBQPPFGLANSWYAOK7WSLCOXPZM5NV2LXTQ7FCX26BYJKZ5FRVZ4B4MBL",
  /** Gastador reportado como drenador en el registro. */
  attacker: "GBKRSFTB3B27QFLOWFUNTMCVJPJCSI74ERDG5TXYGETN3TR6YLZFRYT2",
} as const;

/** Política del agente de la demo. */
export const POLICY: Policy = {
  maxPayment: { XLM: "100" },
  unverifiedContract: "block",
  blockAccountChanges: true,
};

export const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;
export const explorerTx = (hash: string) => `${NETWORK.explorer}/tx/${hash}`;
export const explorerContract = (id: string) => `${NETWORK.explorer}/contract/${id}`;
export const explorerAccount = (id: string) => `${NETWORK.explorer}/account/${id}`;
