import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { useEffect, useMemo, useState } from "react";
import { RegistryIntel, type ThreatInfo } from "tambo-sdk";
import { IDS, NETWORK, explorerAccount, explorerContract, explorerTx, short } from "./config";
import { fundAgent, runScenario, type RunResult } from "./runner";
import { SCENARIOS, type Scenario } from "./scenarios";

const STORAGE_KEY = "tambo-demo-agent";

/** Clave temporal de testnet: vive solo en esta pestaña y nunca se muestra. */
function loadAgent(): Keypair {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return Keypair.fromSecret(saved);
  } catch {
    /* sin sessionStorage: se usa una clave en memoria */
  }
  const kp = Keypair.random();
  try {
    sessionStorage.setItem(STORAGE_KEY, kp.secret());
  } catch {
    /* ignorar */
  }
  return kp;
}

type Status = "idle" | "running" | RunResult["status"];

export function App() {
  const agent = useMemo(loadAgent, []);
  const [funded, setFunded] = useState<"no" | "working" | "yes" | "error">("no");
  const [tamboOn, setTamboOn] = useState(true);
  const [results, setResults] = useState<Record<string, { status: Status; result?: RunResult }>>({});
  const [count, setCount] = useState<number | null>(null);

  const intel = useMemo(() => new RegistryIntel({ rpcUrl: NETWORK.rpcUrl, registryId: IDS.registry }), []);

  useEffect(() => {
    intel.count().then(setCount).catch(() => setCount(null));
  }, [intel]);

  async function fund() {
    setFunded("working");
    try {
      await fundAgent(agent.publicKey());
      await new Promise((ok) => setTimeout(ok, 4000));
      setFunded("yes");
    } catch {
      setFunded("error");
    }
  }

  async function run(s: Scenario) {
    setResults((r) => ({ ...r, [s.id]: { status: "running" } }));
    const result = await runScenario(s, { keypair: agent, tamboEnabled: tamboOn });
    setResults((r) => ({ ...r, [s.id]: { status: result.status, result } }));
  }

  async function runAll() {
    for (const s of SCENARIOS) await run(s);
  }

  const canRun = funded === "yes";

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="brand">
            <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#c8553d" />
              <path d="M7 24V12l9-6 9 6v12z" fill="#f4e9d8" />
              <path d="M13 24v-6h6v6z" fill="#c8553d" />
            </svg>
            <span>Tambo</span>
          </div>
          <h1>Un firewall para los agentes de IA que pagan en Stellar.</h1>
          <p className="lead">
            Los agentes ya firman pagos por su cuenta, pero firman lo que les ponen delante. Tambo simula y decodifica
            cada transacción <strong>antes</strong> de la firma y la detiene si es peligrosa. En los caminos incas, los
            tambos eran puestos de control: nada pasaba sin ser revisado.
          </p>
          <p className="net">Todo ocurre en la red de pruebas (testnet) de Stellar. No hay dinero real.</p>
        </div>
      </header>

      <main className="wrap">
        <section className="panel">
          <h2>1 · El agente</h2>
          <div className="agent-row">
            <div>
              <div className="label">Cuenta del agente (clave temporal en esta pestaña)</div>
              <a href={explorerAccount(agent.publicKey())} target="_blank" rel="noreferrer" className="mono">
                {short(agent.publicKey())}
              </a>
            </div>
            <button className="btn" onClick={fund} disabled={funded === "working" || funded === "yes"}>
              {funded === "yes" ? "Fondeado ✓" : funded === "working" ? "Fondeando…" : "Fondear con Friendbot"}
            </button>
            <label className="switch">
              <input type="checkbox" checked={tamboOn} onChange={(e) => setTamboOn(e.target.checked)} />
              <span className="track" />
              <span>Tambo {tamboOn ? "activado" : "desactivado"}</span>
            </label>
          </div>
          {funded === "error" && <p className="warn">No se pudo fondear. Reintenta en unos segundos.</p>}
          {!tamboOn && (
            <p className="warn">
              Sin Tambo el agente firma todo lo que le ponen delante. Las transacciones peligrosas se firman pero esta
              demo no las envía.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="row-between">
            <h2>2 · Lo que le piden hacer</h2>
            <button className="btn primary" onClick={runAll} disabled={!canRun}>
              Ejecutar todos
            </button>
          </div>
          {!canRun && <p className="hint">Fondea al agente primero para poder ejecutar los escenarios.</p>}
          <div className="grid">
            {SCENARIOS.map((s) => (
              <ScenarioCard key={s.id} s={s} state={results[s.id]} onRun={() => run(s)} disabled={!canRun} />
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>3 · Lista compartida de amenazas (contrato de Soroban)</h2>
          <p>
            Contrato{" "}
            <a className="mono" href={explorerContract(IDS.registry)} target="_blank" rel="noreferrer">
              {short(IDS.registry)}
            </a>{" "}
            · {count === null ? "…" : count} direcciones reportadas. Cualquier agente puede consultarla gratis, sin
            firmar nada.
          </p>
          <Lookup intel={intel} />
        </section>
      </main>

      <footer className="wrap foot">
        <a href="https://github.com/sandley7/tambo" target="_blank" rel="noreferrer">
          Código en GitHub
        </a>
        <span>·</span>
        <a href={explorerContract(IDS.registry)} target="_blank" rel="noreferrer">
          Contrato en stellar.expert
        </a>
        <span>·</span>
        <span>Stellar Codember Perú 2026</span>
      </footer>
    </>
  );
}

function ScenarioCard(props: {
  s: Scenario;
  state?: { status: Status; result?: RunResult };
  onRun: () => void;
  disabled: boolean;
}) {
  const { s, state } = props;
  const status = state?.status ?? "idle";
  const r = state?.result;
  return (
    <article className={`card ${status}`}>
      <h3>{s.title}</h3>
      <p>{s.story}</p>
      <button className="btn" onClick={props.onRun} disabled={props.disabled || status === "running"}>
        {status === "running" ? "Revisando…" : "Ejecutar"}
      </button>
      {status !== "idle" && status !== "running" && (
        <div className="result">
          <span className={`badge ${status}`}>
            {status === "blocked" && "Bloqueada por Tambo"}
            {status === "confirmed" && "Permitida y confirmada"}
            {status === "signed" && "Firmada sin revisión"}
            {status === "failed" && "Error"}
          </span>
          <ul>
            {r?.verdict?.findings.map((f, i) => (
              <li key={i} className={f.severity}>
                <strong>{f.rule}</strong>
                {f.target && <span className="mono"> {short(f.target)}</span>} — {f.message}
              </li>
            ))}
          </ul>
          {r?.hash && (
            <a href={explorerTx(r.hash)} target="_blank" rel="noreferrer">
              Ver transacción en stellar.expert →
            </a>
          )}
          {r?.error && <p className="warn">{r.error}</p>}
        </div>
      )}
    </article>
  );
}

function Lookup({ intel }: { intel: RegistryIntel }) {
  const [value, setValue] = useState("");
  const [out, setOut] = useState<{ addr: string; threat?: ThreatInfo; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(addr: string) {
    setValue(addr);
    const a = addr.trim();
    if (!StrKey.isValidEd25519PublicKey(a) && !StrKey.isValidContract(a)) {
      setOut({ addr: a, error: "No es una dirección válida de Stellar (G… o C…)." });
      return;
    }
    setBusy(true);
    try {
      const res = await intel.threats([a]);
      setOut({ addr: a, threat: res.get(a) });
    } catch (e) {
      setOut({ addr: a, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lookup">
      <div className="lookup-row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Pega una dirección G… o C…"
          spellCheck={false}
          aria-label="Dirección a consultar"
        />
        <button className="btn" onClick={() => check(value)} disabled={busy || !value.trim()}>
          {busy ? "Consultando…" : "Consultar"}
        </button>
      </div>
      <div className="examples">
        Ejemplos:{" "}
        <button className="link" onClick={() => check(IDS.scammer)}>
          destino reportado
        </button>{" "}
        ·{" "}
        <button className="link" onClick={() => check(IDS.attacker)}>
          gastador reportado
        </button>{" "}
        ·{" "}
        <button className="link" onClick={() => check(IDS.provider)}>
          cuenta limpia
        </button>
      </div>
      {out && (
        <div className={`lookup-out ${out.error ? "warn" : out.threat ? "bad" : "ok"}`}>
          {out.error ? out.error : out.threat ? `⚠ Reportada como ${out.threat.kind}: ${out.threat.reason}` : "✓ No figura en la lista de amenazas."}
        </div>
      )}
    </div>
  );
}
