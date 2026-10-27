// NONCE Genesis: ONE free mint attempt on BNB Smart Chain (56) with the Binance Agentic Wallet (baw CLI).
// Asks you to type "yes" before every signature and before the mint transaction. Never asks for keys.
// Usage: node nonce.mjs            (state is kept in state.json so an interrupted run recovers the same attempt)
import { ethers } from "ethers";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import readline from "node:readline/promises";
import crypto from "node:crypto";

const CHAIN = 56;
const MCP = "https://mcp.nonceprotocol.xyz/mcp";
const AUTH = "https://mcp.nonceprotocol.xyz/auth";
const PROMPT_URL = "https://nonceprotocol.xyz/api/mint-prompt";
const EXPECT = {
  freeMint: "0x7538ba8C1A82E9706dB6d2463C15f69ADc01a17e",
  nft: "0x053259A3D30E63d9447E3d90813C6a494bcB398a",
  agentGate: "0xc8D8EebAd7Fdd590edA6d23164B1eC014913Ce8f",
  agentRegistry: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
};
const SCAN = "https://bscscan.com";
const RPCS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.binance.org"];
const UA = { "User-Agent": "curl/8.5.0" };
const STATE = "state.json";
const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 1), { mode: 0o600 });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function die(msg) { console.error("\nSTOP: " + msg); rl.close(); process.exit(1); }
function need(cond, msg) { if (!cond) die(msg); else console.log("  ok  " + msg); }
async function confirm(q, key) {
  if (process.env.APPROVAL_DIR) {
    const f = `${process.env.APPROVAL_DIR}/${key}`;
    if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`  approved (${key}): ${q}`); return; }
    console.log(`\nNEEDS_APPROVAL ${key}: ${q}`); rl.close(); process.exit(3);
  }
  const a = (await rl.question(`\n>>> ${q}\nType "yes" to approve, anything else to stop: `)).trim().toLowerCase();
  if (!["yes", "y", "confirm", "go ahead"].includes(a)) die("Not confirmed. Nothing was signed.");
}
function redact(o) { return JSON.stringify(o, (k, v) => (/capability|token|signature$/i.test(k) && typeof v === "string" ? "<hidden>" : v), 1); }

// ---------- baw ----------
function baw(...args) {
  let out;
  try { out = execFileSync("baw", [...args, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 }); }
  catch (e) { out = e.stdout || ""; if (!out) die("baw failed: " + (e.stderr || e.message)); }
  const j = JSON.parse(out);
  if (!j.success) die("baw error (verbatim): " + JSON.stringify(j.error || j));
  return j.data;
}

// ---------- HTTP / MCP ----------
async function postJSON(url, body, headers = {}) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(url, { method: "POST", headers: { ...UA, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const t = await r.text();
    if (r.status === 429 || r.status >= 502 || /busy/i.test(t)) { await sleep(3000 + Math.random() * 6000); continue; }
    let j; try { j = JSON.parse(t); } catch { die(`Bad response from ${url}: ${r.status} ${t.slice(0, 200)}`); }
    if (!r.ok) die(`${url} -> ${r.status}: ${t.slice(0, 300)}`);
    return j;
  }
  die("Server stayed busy: " + url);
}
let sid = null;
async function mcpRaw(payload) {
  const h = { ...UA, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (st.token) h.Authorization = "Bearer " + st.token;
  if (sid) h["Mcp-Session-Id"] = sid;
  const r = await fetch(MCP, { method: "POST", headers: h, body: JSON.stringify(payload) });
  if (r.headers.get("mcp-session-id")) sid = r.headers.get("mcp-session-id");
  let t = await r.text();
  if (t.includes("data:")) t = t.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  return { status: r.status, body: t };
}
async function mcpInit() {
  sid = null;
  await mcpRaw({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "nonce-kit", version: "1" } } });
  await mcpRaw({ jsonrpc: "2.0", method: "notifications/initialized" });
}
async function tool(name, args, { allowError = false } = {}) {
  for (let i = 0; i < 40; i++) {
    if (!sid) await mcpInit();
    const { status, body } = await mcpRaw({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } });
    if (status === 404 || (status === 400 && /session/i.test(body))) { sid = null; continue; }
    if (status === 429 || status >= 502) { await sleep(3000 + Math.random() * 6000); continue; }
    let j; try { j = JSON.parse(body); } catch { die(`${name}: bad MCP response ${status} ${body.slice(0, 200)}`); }
    if (j.error) die(`${name}: MCP error ${JSON.stringify(j.error)}`);
    const txt = (j.result.content || []).map((c) => c.text || "").join("");
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    if (j.result.isError) {
      if (/busy|rate/i.test(JSON.stringify(data)) && i < 39) { await sleep(4000 + Math.random() * 6000); continue; }
      if (allowError) return { __error: data };
      die(`${name} returned isError: ${JSON.stringify(data)}`);
    }
    return data;
  }
  die(name + ": retries exhausted");
}

// ---------- typed-data signing via baw ----------
async function signTyped(walletRequest, label, key) {
  const msg = typeof walletRequest === "string" ? walletRequest : JSON.stringify(walletRequest);
  const pv = baw("sign-message", "preview", "--binanceChainId", String(CHAIN), "--signType", "EIP712", "--message", msg);
  console.log(`\n[${label}] wallet preview:`);
  console.log("  parsed message:", pv.parsedMessage?.message);
  console.log("  risks:", JSON.stringify(pv.risks));
  await confirm(`Sign "${label}"?`, key);
  let ex = baw("sign-message", "execute", "--requestId", pv.requestId);
  while (ex.status === "PENDING_CONFIRMATION") {
    console.log("  Approve it in your Binance app... waiting");
    await sleep(5000);
    ex = baw("sign-message", "result", "--order-id", ex.orderId);
  }
  if (!ex.signature) die(`${label}: no signature (status ${ex.status})`);
  return { signature: ex.signature, signatureRecovery: ex.signatureRecovery || undefined };
}

// ---------- solver portfolio ----------
function verifyAssign(clauses, a) { return clauses.every((c) => c.some((l) => (l > 0) === (a[Math.abs(l) - 1] === "1"))); }
function solve(clauses, nVars, msLeft) {
  fs.writeFileSync("f.cnf", `p cnf ${nVars} ${clauses.length}\n` + clauses.map((c) => c.join(" ") + " 0").join("\n") + "\n");
  const cores = os.cpus().length, procs = [];
  const nk = Math.max(1, Math.floor(cores / 2)), np = Math.max(1, cores - nk);
  return new Promise((resolve) => {
    let done = false;
    const finish = (a) => { if (done) return; done = true; procs.forEach((p) => { try { p.kill("SIGKILL"); } catch {} }); resolve(a); };
    const timer = setTimeout(() => finish(null), msLeft);
    const run = (cmd, args, parse) => {
      const p = spawn(cmd, args); procs.push(p); let out = ""; p.on("error", () => {});
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => { const a = parse(out); if (a && a.length === nVars && verifyAssign(clauses, a)) { clearTimeout(timer); finish(a); } });
    };
    for (let i = 0; i < nk; i++) run("./kissat", [`--seed=${i + 1}`, "f.cnf"], (o) => {
      if (!/^s SATISFIABLE/m.test(o)) return null;
      const a = Array(nVars).fill("0");
      for (const l of o.split("\n")) if (l.startsWith("v ")) for (const x of l.slice(2).trim().split(/\s+/).map(Number)) if (x > 0 && x <= nVars) a[x - 1] = "1";
      return a.join("");
    });
    const cbs = [2.8, 3.0, 3.2, 3.4, 3.6, 2.9, 3.1, 3.3];
    for (let i = 0; i < np; i++) run("./probsat", ["f.cnf", String(cbs[i % cbs.length]), String(1000 + i)], (o) => o.trim().split("\n").pop());
    console.log(`  solving with ${nk} kissat + ${np} probSAT processes on ${cores} cores`);
  });
}

// ============================ main ============================
(async () => {
  console.log("== 1. Admission ==");
  const info = await tool("protocol_info", {});
  need(info.admission === "open", `admission is open (got ${info.admission})`);

  const status = baw("wallet", "status");
  need(status.status === "CONNECTED", "baw wallet is CONNECTED (run baw auth signin / verify first if not)");
  const addrs = baw("wallet", "address").addresses;
  const W = ethers.getAddress(addrs.find((x) => String(x.binanceChainId) === "56").address);
  console.log("  wallet:", W);
  if (st.wallet && !eq(st.wallet, W)) die("state.json belongs to another wallet");
  st.wallet = W; save();

  console.log("== 2. Deployment & quota ==");
  let cfg;
  for (let i = 0; i < 8 && !cfg; i++) { try { const r = await fetch(PROMPT_URL, { headers: UA }); if (r.ok) cfg = await r.json(); } catch {} if (!cfg) await sleep(4000); }
  if (!cfg) die("could not read the official /api/mint-prompt");
  const C = cfg.context.contracts;
  for (const k of Object.keys(EXPECT)) need(eq(C[k], EXPECT[k]), `published ${k} matches ${EXPECT[k]}`);
  need(cfg.context.chainId === CHAIN && info.chainId === CHAIN, "chain id 56");
  need(info.mintPrice === "0" && info.failureFee === "0", "mintPrice 0 and failureFee 0");
  need(info.maxMintsPerWallet === 2 && info.supplyCap === 7777, "maxMintsPerWallet 2, supplyCap 7777");
  let p; for (const u of RPCS) { try { p = new ethers.JsonRpcProvider(u, CHAIN, { staticNetwork: true }); await p.getBlockNumber(); break; } catch { p = null; } }
  if (!p) die("no BSC RPC reachable");
  const fm = new ethers.Contract(EXPECT.freeMint, cfg.abi.freeMint, p), nft = new ethers.Contract(EXPECT.nft, cfg.abi.nft, p);
  const gate = new ethers.Contract(EXPECT.agentGate, cfg.abi.gate, p), reg = new ethers.Contract(EXPECT.agentRegistry, cfg.abi.registry, p);
  for (const [n, a] of Object.entries(EXPECT)) need((await p.getCode(a)).length > 2, `${n} has code`);
  need(eq(await fm.nft(), EXPECT.nft), "FreeMint.nft() = NFT");
  need(eq(await nft.minter(), EXPECT.freeMint), "NFT.minter() = FreeMint");
  need(eq(await fm.agentGate(), EXPECT.agentGate), "FreeMint.agentGate() = AgentGate");
  const signerAddr = await fm.signer();
  need(eq(signerAddr, info.signer), "FreeMint.signer() = protocol_info.signer");
  need((await fm.paused()) === false, "FreeMint not paused");
  need((await nft.MAX_PER_WALLET()) === 2n && (await nft.MAX_SUPPLY()) === 7777n, "NFT limits 2 / 7777");
  need(eq(await gate.registry(), EXPECT.agentRegistry), "AgentGate.registry() = published registry");
  need((await gate.identityPolicy()) === ethers.keccak256(ethers.toUtf8Bytes("NONCE_BINANCE_AI_HANDLE_V1")), "identityPolicy matches");
  const handle = await reg.handleOf(W);
  if (!handle) die("No Agent ID on this wallet. Register your .ai Agent ID in the Binance App first.");
  const agentId = BigInt(ethers.keccak256(ethers.toUtf8Bytes(handle)));
  need(eq(await reg.ownerOf(agentId), W), `Agent ID "${handle}" owned by wallet`);
  need(await gate.isAuthorized(agentId, W), "AgentGate.isAuthorized(agentId, wallet)");
  const minted = await nft.mintedByWallet(W), supply = await nft.totalSupply();
  need(minted < 2n, `wallet has a mint left (used ${minted}/2)`);
  need(supply < 7777n, `supply available (${supply}/7777)`);
  const sett = baw("wallet", "settings");
  if (!sett.devMode?.enabled) die("Developer Mode is off. Enable it in the Binance App: Agentic Wallet > Settings > Developer Mode.");

  console.log("== MCP sign-in ==");
  if (!st.token || Date.now() > (st.tokenExp || 0) - 21 * 60e3) {
    const ch = await postJSON(`${AUTH}/challenge`, { wallet: W });
    const td = ch.typedData, m = td.message;
    need(td.domain.name === "NONCE MCP Sign In" && td.domain.version === "1" && Number(td.domain.chainId) === CHAIN, "sign-in domain");
    need(td.primaryType === "SignIn" && eq(m.wallet, W) && m.audience === "mcp.nonceprotocol.xyz", "SignIn for this wallet / audience");
    need(m.challenge === ch.challenge && Number(m.expiresAt) * 1000 > Date.now(), "challenge matches and not expired");
    need(/sign in only/i.test(m.statement) && !/permit/i.test(JSON.stringify(td.types)), "sign-in-only statement, not a Permit");
    const s = await signTyped(ch.walletRequest, "NONCE MCP sign-in", "signin");
    const v = await postJSON(`${AUTH}/verify`, { wallet: W, challenge: ch.challenge, ...s });
    if (!v.token) die("auth/verify returned no token");
    st.token = v.token; st.tokenExp = Date.now() + 55 * 60e3; save(); sid = null;
  }
  const ident = await tool("agent_identity", { wallet: W });
  need(ident.identities?.some((x) => x.agentId === agentId.toString() && eq(x.authorizedWallet, W)), "agent_identity confirms Agent ID");
  const ws = await tool("wallet_status", { wallet: W });
  need(ws.remainingMints >= 1, `wallet_status remainingMints ${ws.remainingMints}, BNB ${ws.nativeBalance}`);

  console.log("== 3. Prepare & start ONE attempt ==");
  st.idem ||= crypto.randomUUID(); save();
  let prep = await tool("prepare_attempt", { wallet: W, beneficiary: W, agentId: agentId.toString(), idempotencyKey: st.idem });
  st.attemptId = prep.attemptId; save();
  const A = prep.attemptId, aHash = ethers.keccak256(ethers.toUtf8Bytes(A));
  console.log("  attempt", A, "version", prep.version, "state", prep.state);
  const bm = prep.benchmark;
  need(/logic/.test(bm.version) && bm.variables > 0 && bm.fragmentCount > 0, `benchmark ${bm.version}: ${bm.variables} vars, ${bm.clauses} clauses, ${bm.fragmentCount} fragments, ${bm.toolBudget} reads, ${bm.deadlineSeconds}s`);
  if (!st.capability && process.env.SKIP_BALANCED === "1" && /balanced/.test(bm.version)) {
    delete st.idem; delete st.attemptId; save();
    console.log("  SKIP: balanced version, not signing start. Prepare will expire with no fee; run again later for a new version.");
    process.exit(3);
  }
  if (!st.capability) {
    const sa = prep.startAuthorization;
    need(sa.domain.name === "NONCE Free Mint" && sa.domain.version === "1" && Number(sa.domain.chainId) === CHAIN && eq(sa.domain.verifyingContract, EXPECT.freeMint), "StartAuthorization domain");
    need(sa.primaryType === "StartAuthorization" && eq(sa.message.wallet, W) && sa.message.attemptId === aHash, "StartAuthorization for this wallet + attemptId hash");
    const s = await signTyped(prep.startWalletRequest, "Start challenge (starts the clock)", "start");
    const started = await tool("start_attempt", { attemptId: A, ...s });
    if (!started.capability) die("start_attempt gave no capability: " + redact(started));
    st.capability = started.capability; st.deadline = Date.now() + bm.deadlineSeconds * 1000; save();
    console.log("  ACTIVE. Deadline", started.deadline);
  }

  console.log("== 4. Collect fragments, solve, submit once ==");
  const frags = await Promise.all([...Array(bm.fragmentCount).keys()].map((i) => tool("inspect_fragment", { attemptId: A, capability: st.capability, fragmentId: i })));
  const clauses = frags.flatMap((f) => f.fragment.clauses);
  need(clauses.length === bm.clauses, `collected ${clauses.length} clauses from ${frags.length} fragments`);
  const msLeft = st.deadline - Date.now() - 25e3;
  if (msLeft < 10e3) die("too little time left");
  const t0 = Date.now();
  const assignment = await solve(clauses, bm.variables, msLeft);
  if (!assignment) die(`No solution found before the deadline (${Math.round((Date.now() - t0) / 1000)}s). Nothing submitted. No fee charged.`);
  need(assignment.length === bm.variables && verifyAssign(clauses, assignment), `local check: all ${clauses.length} clauses satisfied (${Math.round((Date.now() - t0) / 1000)}s)`);
  const res = await tool("submit_artifact", { attemptId: A, capability: st.capability, artifact: { assignment }, nonce: "0" });
  console.log("  result:", redact(res));
  st.submitted = true; save();
  if (!/VERIFIED_WIN/.test(JSON.stringify(res))) {
    const s2 = await tool("attempt_status", { attemptId: A }, { allowError: true });
    console.log("  attempt_status:", redact(s2));
    if (!/VERIFIED_WIN/.test(JSON.stringify(s2))) die("Not a verified win. Stopping (one attempt only).");
  }

  console.log("== 5. Mint ==");
  const mt = await tool("mint_transaction", { attemptId: A });
  console.log("  mint_transaction:", redact(mt));
  const auth = mt.authorization || mt.mintAuthorization || mt.message, sig = mt.signature || mt.authorizationSignature, receipt = mt.receipt, tx = mt.transaction || mt.tx;
  if (!auth || !sig || !receipt || !tx) die("mint_transaction response is missing authorization/signature/receipt/transaction; check it manually above.");
  need(auth.attemptId === aHash && eq(auth.wallet, W) && BigInt(auth.agentId) === agentId, "authorization: attemptId hash, wallet, agentId");
  const canon = JSON.stringify(Object.fromEntries(Object.keys(receipt).sort().map((k) => [k, receipt[k]])));
  need(receipt.valid === true && receipt.attemptId === A && /^0x[0-9a-fA-F]{64}$/.test(receipt.mintEntropy || ""), "receipt valid, same attempt, mintEntropy 32 bytes");
  need(auth.receiptHash === ethers.keccak256(ethers.toUtf8Bytes(canon)), "receiptHash = keccak(canonical receipt JSON)");
  need(BigInt(auth.expiry) * 1000n > BigInt(Date.now()), "authorization not expired");
  const domain = { name: "NONCE Free Mint", version: "1", chainId: CHAIN, verifyingContract: EXPECT.freeMint };
  const types = { MintAuthorization: [{ name: "attemptId", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "agentId", type: "uint256" }, { name: "receiptHash", type: "bytes32" }, { name: "expiry", type: "uint256" }] };
  need(eq(ethers.verifyTypedData(domain, types, auth, sig), signerAddr), "MintAuthorization signed by FreeMint.signer()");
  const iface = new ethers.Interface(cfg.abi.freeMint);
  const dec = iface.parseTransaction({ data: tx.data, value: tx.value || 0 });
  need(dec?.name === "mint" && eq(tx.to, EXPECT.freeMint) && (!tx.from || eq(tx.from, W)) && BigInt(tx.value || 0) === 0n, "tx = FreeMint.mint(...), from wallet, value 0");
  need(dec.args[0].attemptId === aHash && dec.args[1].toLowerCase() === sig.toLowerCase(), "calldata carries this authorization");
  if (await fm.usedAttempts(aHash)) die("usedAttempts already true: this attempt was minted; find the original tx instead of sending another.");
  need((await nft.mintedByWallet(W)) < 2n && (await nft.totalSupply()) < 7777n && !(await fm.paused()), "still eligible and available");
  need((await p.getBalance(W)) > 0n, "wallet has BNB for gas");
  const pv = baw("contract-call", "preview", "--binanceChainId", String(CHAIN), "--from", W, "--to", EXPECT.freeMint, "--value", "0", "--inputData", tx.data);
  console.log("  preview:", JSON.stringify({ parsedTx: pv.parsedTx, simulation: pv.simulationResult, risks: pv.risks }, null, 1));
  await confirm(`Send mint tx: FreeMint ${EXPECT.freeMint}.mint(...) from ${W}, value 0 BNB, you pay gas only.`, "mint");
  const ex = baw("contract-call", "execute", "--requestId", pv.requestId);
  console.log("  execute:", ex.status, ex.txHash || "");
  if (ex.status === "PENDING_CONFIRMATION") console.log("  Approve in your Binance app. Watching the chain for this attempt's mint...");
  let hash = ex.txHash;
  const fmEvents = new ethers.Contract(EXPECT.freeMint, cfg.abi.freeMint, p);
  for (let i = 0; !hash && i < 120; i++) {
    await sleep(5000);
    if (await fm.usedAttempts(aHash)) { const ev = await fmEvents.queryFilter(fmEvents.filters.Minted(aHash), -2000); if (ev.length) hash = ev[0].transactionHash; }
  }
  if (!hash) die("No tx hash yet. Do NOT resend. Check the Binance app / bscscan for the pending order.");
  console.log(`  tx: ${SCAN}/tx/${hash}  (waiting for 12 confirmations)`);
  const rc = await p.waitForTransaction(hash, 12);
  need(rc.status === 1, "receipt success with 12 confirmations");

  console.log("== 6. Verify ==");
  const nIf = new ethers.Interface(cfg.abi.nft);
  const mintedEv = rc.logs.filter((l) => eq(l.address, EXPECT.freeMint)).map((l) => { try { return iface.parseLog(l); } catch { return null; } }).filter((e) => e?.name === "Minted" && e.args.attemptId === aHash);
  const xfers = rc.logs.filter((l) => eq(l.address, EXPECT.nft)).map((l) => { try { return nIf.parseLog(l); } catch { return null; } }).filter((e) => e?.name === "Transfer" && e.args.from === ethers.ZeroAddress && eq(e.args.to, W));
  need(mintedEv.length === 1 && xfers.length === 1 && mintedEv[0].args.tokenId === xfers[0].args.tokenId, "one Minted + one Transfer, same tokenId");
  const tokenId = xfers[0].args.tokenId;
  need(eq(await nft.ownerOf(tokenId), W), "ownerOf(tokenId) = wallet");
  const used = await nft.mintedByWallet(W);
  const gas = ethers.formatEther(rc.gasUsed * (rc.gasPrice ?? rc.effectiveGasPrice ?? 0n));
  const uri = await nft.tokenURI(tokenId);
  console.log(`\nMINTED NONCE Genesis #${tokenId}\n  collection ${SCAN}/address/${EXPECT.nft}\n  token ${SCAN}/token/${EXPECT.nft}?a=${tokenId}\n  tx ${SCAN}/tx/${hash}\n  gas ${gas} BNB, mint price 0\n  lifetime mints used ${used}/2\n  tokenURI ${uri}`);
  rl.close();
})().catch((e) => die(e.stack || String(e)));
