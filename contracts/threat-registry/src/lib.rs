#![no_std]
//! Tambo threat registry.
//!
//! A shared, on-chain list of addresses (accounts or contracts) that AI agents
//! should refuse to interact with, plus a list of verified contract WASM hashes.
//! Reads are free (simulation), so any agent or wallet can query it before signing.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    String, Vec,
};

/// Roughly 30 days of ledgers (5 s each); entries are bumped when touched.
const TTL_THRESHOLD: u32 = 518_400;
const TTL_EXTEND_TO: u32 = 3_110_400;
const MAX_BATCH: u32 = 50;
const MAX_REASON_LEN: u32 = 200;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ThreatKind {
    /// Known scam destination.
    Scam = 1,
    /// Contract or account that drains approvals / balances.
    Drainer = 2,
    /// Impersonates a legitimate service.
    Phishing = 3,
    /// Malicious or compromised contract.
    MaliciousContract = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Threat {
    pub kind: ThreatKind,
    pub reason: String,
    pub reporter: Address,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Reporter(Address),
    Threat(Address),
    VerifiedWasm(BytesN<32>),
    Count,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    AlreadyFlagged = 2,
    NotFlagged = 3,
    ReasonTooLong = 4,
    BatchTooLarge = 5,
}

#[contractevent]
pub struct Flagged {
    #[topic]
    pub target: Address,
    pub kind: ThreatKind,
    pub reporter: Address,
}

#[contractevent]
pub struct Unflagged {
    #[topic]
    pub target: Address,
    pub by: Address,
}

#[contractevent]
pub struct WasmVerified {
    #[topic]
    pub wasm_hash: BytesN<32>,
    pub label: String,
}

#[contract]
pub struct ThreatRegistry;

#[contractimpl]
impl ThreatRegistry {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Count, &0u32);
    }

    // ---- administration -------------------------------------------------

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Lets `reporter` add and remove entries. Admin only.
    pub fn add_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        let key = DataKey::Reporter(reporter);
        env.storage().persistent().set(&key, &true);
        Self::bump(&env, &key);
    }

    pub fn remove_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        env.storage().persistent().remove(&DataKey::Reporter(reporter));
    }

    pub fn is_reporter(env: Env, who: Address) -> bool {
        who == Self::admin(env.clone())
            || env.storage().persistent().has(&DataKey::Reporter(who))
    }

    /// Marks a contract WASM hash as reviewed. Admin only.
    pub fn verify_wasm(env: Env, wasm_hash: BytesN<32>, label: String) {
        Self::require_admin(&env);
        let key = DataKey::VerifiedWasm(wasm_hash.clone());
        env.storage().persistent().set(&key, &label);
        Self::bump(&env, &key);
        WasmVerified { wasm_hash, label }.publish(&env);
    }

    pub fn unverify_wasm(env: Env, wasm_hash: BytesN<32>) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::VerifiedWasm(wasm_hash));
    }

    // ---- reporting ------------------------------------------------------

    /// Flags `target`. `reporter` must be the admin or an approved reporter.
    pub fn report(
        env: Env,
        reporter: Address,
        target: Address,
        kind: ThreatKind,
        reason: String,
    ) -> Result<(), Error> {
        reporter.require_auth();
        if !Self::is_reporter(env.clone(), reporter.clone()) {
            return Err(Error::NotAuthorized);
        }
        if reason.len() > MAX_REASON_LEN {
            return Err(Error::ReasonTooLong);
        }
        let key = DataKey::Threat(target.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyFlagged);
        }
        let threat = Threat {
            kind,
            reason,
            reporter: reporter.clone(),
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&key, &threat);
        Self::bump(&env, &key);
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        env.storage().instance().set(&DataKey::Count, &(count + 1));
        Flagged { target, kind, reporter }.publish(&env);
        Ok(())
    }

    /// Removes a flag (false positive). Admin, or the reporter who added it.
    pub fn unflag(env: Env, caller: Address, target: Address) -> Result<(), Error> {
        caller.require_auth();
        let key = DataKey::Threat(target.clone());
        let threat: Threat = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFlagged)?;
        if caller != Self::admin(env.clone()) && caller != threat.reporter {
            return Err(Error::NotAuthorized);
        }
        env.storage().persistent().remove(&key);
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Count, &count.saturating_sub(1));
        Unflagged { target, by: caller }.publish(&env);
        Ok(())
    }

    // ---- queries (free via simulation) ----------------------------------

    pub fn get(env: Env, target: Address) -> Option<Threat> {
        env.storage().persistent().get(&DataKey::Threat(target))
    }

    pub fn is_flagged(env: Env, target: Address) -> bool {
        env.storage().persistent().has(&DataKey::Threat(target))
    }

    /// Checks several addresses at once; the result is index-aligned with the input.
    pub fn check_many(env: Env, targets: Vec<Address>) -> Result<Vec<Option<Threat>>, Error> {
        if targets.len() > MAX_BATCH {
            return Err(Error::BatchTooLarge);
        }
        let mut out = Vec::new(&env);
        for t in targets.iter() {
            out.push_back(env.storage().persistent().get(&DataKey::Threat(t)));
        }
        Ok(out)
    }

    pub fn is_wasm_verified(env: Env, wasm_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::VerifiedWasm(wasm_hash))
    }

    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    // ---- internals ------------------------------------------------------

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn bump(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
