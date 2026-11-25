#![no_std]
//! Servicio de ejemplo para la demo de Tambo.
//!
//! Hace de "proveedor legítimo" cuyo WASM el administrador marca como verificado
//! en el registro, para mostrar que Tambo deja pasar llamadas a contratos conocidos.

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

#[contract]
pub struct DemoVendor;

#[contractimpl]
impl DemoVendor {
    /// Registra que `buyer` consultó el servicio y devuelve un recibo.
    pub fn ping(env: Env, buyer: Address) -> Symbol {
        buyer.require_auth();
        env.storage().persistent().set(&buyer, &env.ledger().sequence());
        symbol_short!("ok")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn ping_returns_receipt() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(DemoVendor, ());
        let c = DemoVendorClient::new(&env, &id);
        assert_eq!(c.ping(&Address::generate(&env)), symbol_short!("ok"));
    }
}
