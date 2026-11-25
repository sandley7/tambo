# Tambo

**Firewall para agentes de IA en Stellar.** Tambo revisa cada transacción que un agente está por firmar y la detiene si es peligrosa, antes de que llegue a la red.

> En los caminos incas (Qhapaq Ñan), los *tambos* eran puestos de control: todo lo que pasaba por ahí era revisado. Tambo cumple ese papel entre un agente de IA y la red Stellar.

Proyecto para la buildathon **Stellar Codember Perú 2026**. 🚧 En construcción: el periodo de desarrollo va del 14 de noviembre al 4 de diciembre de 2026.

## Problema

Los agentes de IA ya pueden pagar solos, por ejemplo con x402 en Stellar. Pero un agente firma lo que le ponen delante. Si una instrucción maliciosa o un servicio comprometido le pasa una transacción que aprueba a un gastador desconocido, llama a un contrato no verificado o envía fondos a una dirección reportada como estafa, el agente la firma igual. Hoy en Stellar no existe una capa que revise esas transacciones antes de la firma.

## Solución (plan)

1. **Inspección antes de firmar:** un SDK y middleware que simula la transacción, decodifica sus autorizaciones y el contrato que invoca, y la bloquea si coincide con un patrón de riesgo (por ejemplo, un `approve` a un gastador desconocido, un contrato cuyo WASM no está verificado o un destino reportado).
2. **Lista compartida en Soroban:** un contrato en testnet donde se registran direcciones y contratos maliciosos, y que cualquier agente puede consultar.
3. **Demo:** un agente que intenta pagar y Tambo le permite o le bloquea cada transacción, explicando el motivo.

## Arquitectura

Por definir durante la buildathon.

## Cómo ejecutarlo

Por completar.

## Despliegue en testnet

Por completar con los IDs de contrato y los enlaces a [stellar.expert](https://stellar.expert/explorer/testnet).

## Integrantes

- Santiago Fabrizio Lindley Santivañez ([@sandley7](https://github.com/sandley7))

## Uso de IA y código previo

- **Proyecto nuevo:** Tambo empezó en Stellar Codember Perú 2026. Todo su código se escribe durante el periodo de la buildathon, y el historial de commits de este repositorio lo muestra.
- **Código previo:** ninguno. Si usamos librerías o código abierto de terceros, se listarán aquí.
- **IA:** usamos Claude Code como asistente de programación y documentación.

## Licencia

[MIT](LICENSE)
