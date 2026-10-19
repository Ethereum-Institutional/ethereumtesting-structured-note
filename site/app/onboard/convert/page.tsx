import { redirect } from "next/navigation";
import Link from "next/link";
import { currentRegistrant } from "@/lib/access";
import { balances, hasPool, tokens } from "@/lib/pool/convert";
import { poolStanding } from "@/lib/identity/onchain";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { conversionDoneAction, prepareConversionAction, quoteAction } from "../../actions";
import { ConvertPanel } from "../ConvertPanel";
import { accountOf, walletOf } from "../account";

export const dynamic = "force-dynamic";

/**
 * Converting in the pool from the client's own wallet, once the bank has admitted it:
 * the page says what the pool's gate says of the wallet.
 */
export default async function Convert() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  if (!hasPool()) {
    return (
      <>
        <h2 id="convert">Convert</h2>
        <section className="panel"><p className="muted" style={{ margin: 0 }}>This deployment has no conversion pool.</p></section>
      </>
    );
  }
  const { wallet, held } = await accountOf(who);
  const chain = chainParams(loadManifest().chainId);
  const t = tokens();
  const address = wallet ? walletOf(wallet) : null;
  const have = address ? await balances(address).catch(() => null) : null;
  const standing = address ? await poolStanding(address).catch(() => null) : null;
  const show = (v: bigint, decimals: number) => (Number(v) / 10 ** decimals).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: decimals });
  return (
    <>
      <h2 id="convert">Convert</h2>
      {address ? (
        <section className="panel">
          <dl className="facts">
            <dt>{t.payment.symbol}</dt><dd>{have ? show(have.payment, t.payment.decimals) : "–"}</dd>
            <dt>{t.deposit.symbol}</dt><dd>{have ? show(have.deposit, t.deposit.decimals) : "–"}</dd>
            <dt>ETH for fees</dt><dd>{have ? show(have.eth, 18) : "–"}</dd>
          </dl>
          {!have && <p className="muted">The wallet's balances could not be read just now.</p>}
          {chain.chainId === "0xaa36a7" && (
            <p className="muted">
              Test {t.payment.symbol}: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle's faucet</a>. Test ETH for fees: <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">an Ethereum Sepolia faucet</a>. {t.deposit.symbol} is credited by your bank.
            </p>
          )}
          <p className="pool-standing">
            {standing === "admitted"
              ? "The pool admits your wallet: your bank's pool-access claim stands on your identity.":
  `The pool does not admit your wallet yet: ${standing ?? "its gate could not be read"}. Your bank admits wallets to the pool.`}
          </p>
          {standing === "admitted" && <ConvertPanel
            wallet={address}
            chain={chain}
            symbols={{ payment: t.payment.symbol, deposit: t.deposit.symbol }}
            assets={[t.payment, t.deposit]}
            quote={quoteAction}
            prepare={prepareConversionAction}
            done={conversionDoneAction}
          />}
        </section>)
  : held ? (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Your bank holds your account in custody and converts in the pool on your instruction.</p></section>)
  : (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>Onboard a wallet first, under <Link href="/onboard">Account</Link>.</p></section>
      )}
    </>
  );
}
