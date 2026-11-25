#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, String};

fn setup() -> (Env, ThreatRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ThreatRegistry, (&admin,));
    (env.clone(), ThreatRegistryClient::new(&env, &id), admin)
}

#[test]
fn admin_can_flag_and_query() {
    let (env, c, admin) = setup();
    let bad = Address::generate(&env);
    let good = Address::generate(&env);
    assert!(!c.is_flagged(&bad));
    c.report(&admin, &bad, &ThreatKind::Drainer, &String::from_str(&env, "drains approvals"));
    assert!(c.is_flagged(&bad));
    assert!(!c.is_flagged(&good));
    assert_eq!(c.count(), 1);
    let t = c.get(&bad).unwrap();
    assert_eq!(t.kind, ThreatKind::Drainer);
    assert_eq!(t.reporter, admin);
}

#[test]
fn check_many_is_index_aligned() {
    let (env, c, admin) = setup();
    let bad = Address::generate(&env);
    let good = Address::generate(&env);
    c.report(&admin, &bad, &ThreatKind::Scam, &String::from_str(&env, "x"));
    let r = c.check_many(&vec![&env, good.clone(), bad.clone()]);
    assert!(r.get(0).unwrap().is_none());
    assert!(r.get(1).unwrap().is_some());
}

#[test]
fn only_approved_reporters_can_report() {
    let (env, c, _admin) = setup();
    let rep = Address::generate(&env);
    let target = Address::generate(&env);
    let reason = String::from_str(&env, "r");
    assert_eq!(
        c.try_report(&rep, &target, &ThreatKind::Scam, &reason),
        Err(Ok(Error::NotAuthorized))
    );
    c.add_reporter(&rep);
    assert!(c.is_reporter(&rep));
    c.report(&rep, &target, &ThreatKind::Scam, &reason);
    c.remove_reporter(&rep);
    assert!(!c.is_reporter(&rep));
}

#[test]
fn cannot_flag_twice_and_reason_is_bounded() {
    let (env, c, admin) = setup();
    let t = Address::generate(&env);
    c.report(&admin, &t, &ThreatKind::Phishing, &String::from_str(&env, "a"));
    assert_eq!(
        c.try_report(&admin, &t, &ThreatKind::Phishing, &String::from_str(&env, "b")),
        Err(Ok(Error::AlreadyFlagged))
    );
    let long = String::from_str(&env, &"x".repeat(201));
    let t2 = Address::generate(&env);
    assert_eq!(
        c.try_report(&admin, &t2, &ThreatKind::Scam, &long),
        Err(Ok(Error::ReasonTooLong))
    );
}

#[test]
fn unflag_by_admin_or_original_reporter_only() {
    let (env, c, _admin) = setup();
    let rep = Address::generate(&env);
    let other = Address::generate(&env);
    c.add_reporter(&rep);
    c.add_reporter(&other);
    let t = Address::generate(&env);
    c.report(&rep, &t, &ThreatKind::Scam, &String::from_str(&env, "a"));
    assert_eq!(c.try_unflag(&other, &t), Err(Ok(Error::NotAuthorized)));
    c.unflag(&rep, &t);
    assert!(!c.is_flagged(&t));
    assert_eq!(c.count(), 0);
    assert_eq!(c.try_unflag(&rep, &t), Err(Ok(Error::NotFlagged)));
}

#[test]
fn verified_wasm_hashes() {
    let (env, c, _admin) = setup();
    let h = BytesN::from_array(&env, &[7u8; 32]);
    assert!(!c.is_wasm_verified(&h));
    c.verify_wasm(&h, &String::from_str(&env, "token v1"));
    assert!(c.is_wasm_verified(&h));
    c.unverify_wasm(&h);
    assert!(!c.is_wasm_verified(&h));
}

#[test]
fn batch_size_is_limited() {
    let (env, c, _admin) = setup();
    let mut v = Vec::new(&env);
    for _ in 0..51 {
        v.push_back(Address::generate(&env));
    }
    assert_eq!(c.try_check_many(&v), Err(Ok(Error::BatchTooLarge)));
}
