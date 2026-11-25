# Tambo

**Firewall para agentes de IA en Stellar.** Tambo revisa cada transacción que un agente está por firmar y la detiene si es peligrosa, antes de que llegue a la red.

> En los caminos incas (Qhapaq Ñan), los *tambos* eran puestos de control: todo lo que pasaba por ahí era revisado. Tambo cumple ese papel entre un agente de IA y la red Stellar.

Proyecto para la buildathon **Stellar Codember Perú 2026** (14 de noviembre al 4 de diciembre de 2026).

- **App de demo:** https://sandley7.github.io/tambo/
- **Contrato en testnet:** [`CCDBZ54X…CN5RBDLH`](https://stellar.expert/explorer/testnet/contract/CCDBZ54XFIG4TWC6GUGLAFCJDAKBHQ3ZQRIIR62XUEVI6GOHCN5RBDLH) en stellar.expert

## Problema

Los agentes de IA ya pueden pagar solos, por ejemplo con x402 en Stellar. Pero un agente firma lo que le ponen delante. Si una instrucción maliciosa (prompt injection) o un servicio comprometido le pasa una transacción que aprueba a un gastador desconocido, llama a un contrato no verificado, cambia los firmantes de su cuenta o envía fondos a una dirección reportada como estafa, el agente la firma igual. Hoy en Stellar no existe una capa que revise esas transacciones antes de la firma, y cada agente tendría que construir la suya y mantener su propia lista de direcciones peligrosas.

## Solución

1. **Inspección antes de firmar.** El SDK `tambo-sdk` decodifica la transacción, la **simula** en el RPC de Soroban para ver las autorizaciones reales (incluidas las llamadas anidadas, que no se ven en el XDR) y aplica reglas. Devuelve `allow` o `block` con los motivos.
2. **Lista compartida en Soroban.** El contrato `threat-registry` guarda direcciones y contratos reportados, y los hashes de WASM verificados. Cualquier agente o wallet lo consulta gratis, por simulación, sin firmar nada.
3. **Un firmante que no firma lo peligroso.** `tambo.guardSigner(keypair)` envuelve la clave del agente: si el veredicto es `block`, lanza un error y la firma nunca ocurre.

### Reglas incluidas

| Regla | Qué detecta |
|---|---|
| `reported-address` | Destino, contrato o argumento que figura en la lista compartida de amenazas. |
| `unverified-contract` | Contrato cuyo WASM no está en la lista de verificados (los contratos de activos de Stellar se consideran verificados). |
| `unknown-spender` | `approve` a un gastador que el agente no tiene como de confianza. |
| `account-takeover` | `setOptions` que cambia firmantes, umbrales o el peso de la clave maestra. |
| `account-merge` | Fusionar la cuenta, que transfiere todos sus fondos. |
| `payment-over-limit` | Pago por encima del tope configurado. |
| `destination-not-allowed` | Pago o transferencia fuera de la lista de destinos permitidos. |
| `simulation-failed` | La simulación falla: si no se puede verificar qué hace, no se firma. |

## Arquitectura

```
 Agente de IA ──► tambo.guardSigner(keypair).signTransaction(xdr)
                         │
                         ▼
        ┌─────────────────────────────────────────┐
        │ tambo-sdk (TypeScript)                  │
        │  1. decodifica el XDR (pagos, setOptions,│
        │     invokeHostFunction, merge…)          │
        │  2. simula en el RPC de Soroban ───────────► Stellar testnet (RPC)
        │     → autorizaciones y llamadas anidadas │
        │  3. consulta la lista compartida ──────────► threat-registry (Soroban)
        │  4. aplica reglas y política del agente  │
        └──────────────┬──────────────────────────┘
                       │ allow → firma        block → TamboBlockedError (no firma)
                       ▼
                 Red Stellar
```

| Pieza | Ruta | Descripción |
|---|---|---|
| Contrato de amenazas | [`contracts/threat-registry`](contracts/threat-registry) | Soroban (Rust). Admin, *reporters* autorizados, `report`, `unflag`, `get`, `is_flagged`, `check_many`, `verify_wasm`, `is_wasm_verified`, eventos. |
| Contrato de ejemplo | [`contracts/demo-vendor`](contracts/demo-vendor) | Servicio legítimo cuyo WASM se marca como verificado, para la demo. |
| SDK | [`packages/sdk`](packages/sdk) | TypeScript. `Tambo.inspect`, `assertSafe`, `guardSigner`, reglas y cliente del registro. |
| Demo | [`apps/demo`](apps/demo) | App web (Vite + React) y agente de terminal con 7 escenarios reales en testnet. |

## Cómo ejecutarlo

Requisitos: Node 22 o superior; para el contrato, Rust con el target `wasm32v1-none` y [stellar-cli](https://developers.stellar.org/docs/tools/cli).

```bash
git clone https://github.com/sandley7/tambo && cd tambo
npm install

npm test                 # pruebas del SDK (reglas y decodificación)
npm run agent            # agente de terminal con Tambo activado, contra testnet
npm run agent -- --sin-tambo   # el mismo agente sin firewall, para comparar
npm run demo:dev         # app web en http://localhost:5173

cargo test               # pruebas de los contratos
stellar contract build   # compila los contratos a WASM
```

### Usar Tambo en tu propio agente

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { Tambo } from "tambo-sdk";

const tambo = new Tambo({
  rpcUrl: "https://soroban-testnet.stellar.org",
  registryId: "CCDBZ54XFIG4TWC6GUGLAFCJDAKBHQ3ZQRIIR62XUEVI6GOHCN5RBDLH",
  policy: { maxPayment: { XLM: "100" }, trustedSpenders: [] },
});

const signer = tambo.guardSigner(Keypair.fromSecret(process.env.AGENT_SECRET!));
const { signedTxXdr } = await signer.signTransaction(txXdr); // lanza TamboBlockedError si es peligrosa
```

## Despliegue en testnet

Red: Stellar testnet. Todo es público y verificable en [stellar.expert](https://stellar.expert/explorer/testnet).

| Qué | ID / enlace |
|---|---|
| `threat-registry` | [`CCDBZ54XFIG4TWC6GUGLAFCJDAKBHQ3ZQRIIR62XUEVI6GOHCN5RBDLH`](https://stellar.expert/explorer/testnet/contract/CCDBZ54XFIG4TWC6GUGLAFCJDAKBHQ3ZQRIIR62XUEVI6GOHCN5RBDLH) |
| `demo-vendor` (WASM verificado) | [`CC5GY35LYAF6E7R7S4ECQYJK2OLA3OSPAZWAOY3D2OEGIXLY3Q6OAKCT`](https://stellar.expert/explorer/testnet/contract/CC5GY35LYAF6E7R7S4ECQYJK2OLA3OSPAZWAOY3D2OEGIXLY3Q6OAKCT) |
| Contrato no verificado (para la demo) | [`CBW3JSH35RBUE54EVJH7EKA2ROPY4RCGQPOJZ7XMMLBCMPK2VVAAU3T2`](https://stellar.expert/explorer/testnet/contract/CBW3JSH35RBUE54EVJH7EKA2ROPY4RCGQPOJZ7XMMLBCMPK2VVAAU3T2) |
| Cuenta administradora | [`GBRPCZQEWOL6H43TWSSZRGU4O67V5ZNB5NCTQMHYSEV4SXVZEEWOKFL4`](https://stellar.expert/explorer/testnet/account/GBRPCZQEWOL6H43TWSSZRGU4O67V5ZNB5NCTQMHYSEV4SXVZEEWOKFL4) |
| Despliegue del registro | [transacción](https://stellar.expert/explorer/testnet/tx/e5ed8276dca56d2f01d8b9626fdaf444d3a999c0c275654bc202b9c3d0d7e978) |
| WASM de `demo-vendor` verificado | [transacción](https://stellar.expert/explorer/testnet/tx/5122af77bb7de5bd99e7d1c91d542b41f5135d5df86fea1fc4b0dc624dfdfa5f) |
| Destino reportado como estafa | [transacción](https://stellar.expert/explorer/testnet/tx/026b0665296a809c57b414d10c7ec18aa45f46fb859b858cc654c7cb4d27ea1d) |
| Gastador reportado como drenador | [transacción](https://stellar.expert/explorer/testnet/tx/5dc47066f6d2a9f657ca8b541ab48a94352b8226c1ad3b500569201d8973bc21) |

Las claves de testnet viven fuera del repositorio (en la configuración local de `stellar-cli`) y están en `.gitignore`.

## Alcance y límites

- Es un proyecto de buildathon: la lista de amenazas la administra una cuenta y sus *reporters*; no hay todavía un mecanismo de gobernanza ni de reputación para aceptar reportes de terceros.
- Tambo no entiende el **significado** de un contrato arbitrario: solo sabe si es un activo de Stellar, si su WASM fue verificado y qué autorizaciones y llamadas anidadas produce la simulación.
- Los montos de llamadas a contratos (por ejemplo `transfer`) no se comparan con topes, porque dependen de los decimales de cada token; los topes aplican a pagos clásicos.
- Un firewall no reemplaza límites de gasto on-chain ni buenas prácticas de custodia de claves; es una capa adicional.

## Integrantes

- Santiago Fabrizio Lindley Santivañez ([@sandley7](https://github.com/sandley7))
- José Fernando Escajadillo Gaspar ([@JoseEscajadillo](https://github.com/JoseEscajadillo))

## Uso de IA y código previo

- **Proyecto nuevo:** Tambo empezó en Stellar Codember Perú 2026. Todo su código se escribe durante el periodo de la buildathon, y el historial de commits de este repositorio lo muestra.
- **Código previo:** ninguno. Se usan librerías de código abierto de terceros: `@stellar/stellar-sdk`, `soroban-sdk`, React, Vite y Vitest.
- **IA:** usamos Claude Code como asistente de programación y documentación. Revisamos y probamos lo que genera.

## Licencia

[MIT](LICENSE)
