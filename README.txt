NONCE Genesis solver kit: one free mint attempt, BNB Smart Chain

What it does
- Runs exactly ONE attempt with your Binance Agentic Wallet (baw CLI). No retries.
- Before anything else it checks admission, the contracts, your Agent ID and your quota.
- Asks you to type "yes" before each signature (sign-in, then challenge start) and before the mint transaction.
- Solves the puzzle with every CPU core (kissat + probSAT) and checks every clause before submitting.
- It never asks for private keys or seed phrases.

Steps (in a GitHub Codespace)
1. Go to github.com and sign in (free account).
2. Create any repo (or open one), then click Code > Codespaces > the "..." menu > New with options.
   Under Machine type, pick 16-core. This uses about 16 of your 120 free hours each hour, so stop it when you're done.
3. In the Codespace terminal, upload this zip (drag it into the file explorer), then run:
     unzip nonce-kit.zip && cd nonce-kit && bash setup.sh
4. Sign in to your wallet:
     baw auth signin --json
   Open the urlForWeb link and approve in the Binance app (check that the pairing code matches), then run:
     baw auth verify --qrCodeId <the qrCodeId it printed> --json
     baw wallet status --json        (should say CONNECTED)
5. Make sure Developer Mode is on in the Binance app (Agentic Wallet > Settings > Developer Mode).
6. Run:
     node nonce.mjs
   Type yes at each prompt you agree with. The 15-minute clock starts at the second signature.
7. When it's finished, stop the Codespace (Codespaces menu > Stop) so it stops using your free hours.

Notes
- A wrong or expired challenge costs nothing. You only pay BNB gas if you win and confirm the mint.
- If the run gets cut off, run node nonce.mjs again. It picks up the same attempt from state.json and won't start a new one.
- state.json holds your private session details. Don't share it, and delete it when you're done.
